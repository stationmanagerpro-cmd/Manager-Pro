'use strict';
/** Superadmin : règles d'alerte de la PLATEFORME (Centre de contrôle > Pilotage > Règle des notification).
 *  Stockage séparé des règles client (table platform_alert_rules, une ligne par type). Réservé à l'administrateur principal.
 *  Ne lit que des agrégats et des noms de clients / stations : aucune vente, aucun employé, aucun contenu de message.
 *  Envoi par e-mail uniquement (les stations n'existent pas au niveau plateforme). Anti-doublon : 24 h pour les situations
 *  (état persistant), une seule fois par événement pour les événements (rien ne se répète). */
const express = require('express');
const { z } = require('zod');
const { pool, HttpError, wrap, body, audit } = require('./core');
const { needPrincipal, daysRemaining } = require('./contracts');
const { withTaskLock, TASK_LOCKS } = require('./task_lock');
const r = express.Router();

const HOUR = 3600e3, COOLDOWN_MS = 24 * HOUR, SCAN_MS = 15 * 60e3, MAX_LINES = 50;
const fmtDate = d => new Date(d).toLocaleString('fr-FR');

/** Types d'alerte disponibles. type 'event' = déclenché par des faits nouveaux depuis la dernière vérification ;
 *  type 'state' = déclenché tant que la situation dure (rappel au plus toutes les 24 h). */
const KINDS = {
  licence_reminder_sent: {
    label: 'Relances de licence envoyées', type: 'event',
    help: 'Vous prévient quand la plateforme a envoyé des relances de licence (30, 15 ou 7 jours) aux stations.',
    async run({ since }) {
      const { rows } = await pool.query(
        `SELECT c.name, lr.expires_on, lr.band, lr.stations FROM license_reminders lr JOIN clients c ON c.id = lr.client_id
          WHERE lr.sent_at > $1 ORDER BY lr.sent_at`, [since]);
      return { count: rows.length, lines: rows.map(x => `${x.name} : échéance le ${String(x.expires_on).slice(0, 10)}, palier ${x.band} j, ${x.stations} station(s) notifiée(s)`) };
    }
  },
  client_licence_expiring: {
    label: 'Licence client bientôt expirée', type: 'state',
    threshold: { label: 'Alerter si l’échéance tombe dans moins de (jours)', min: 1, max: 90, default: 15 },
    help: 'Vous prévient quand la licence d’un client active expire dans le délai choisi (les licences à durée indéfinie sont ignorées).',
    async run({ now, thr }) {
      const { rows } = await pool.query(
        `SELECT c.name, ct.expires_at, ct.end_date FROM clients c JOIN client_contracts ct ON ct.client_id = c.id
          WHERE c.status = 'actif' AND COALESCE(ct.is_indefinite, FALSE) = FALSE`);
      const lines = [];
      for (const c of rows) {
        const exp = c.expires_at || (c.end_date ? c.end_date + 'T23:59:59Z' : null); if (!exp) continue;
        const d = daysRemaining(exp, now);
        if (d != null && d >= 0 && d <= thr) lines.push(`${c.name} : expire dans ${d} j (${new Date(exp).toLocaleDateString('fr-FR')})`);
      }
      return { count: lines.length, lines };
    },
    hit: count => count > 0
  },
  server_errors_500: {
    label: 'Erreurs serveur 500', type: 'state',
    threshold: { label: 'Seuil d’erreurs 500 sur 24 h', min: 1, max: 10000, default: 10 },
    help: 'Vous prévient quand le nombre d’erreurs serveur (HTTP 500) des dernières 24 h atteint le seuil.',
    async run() {
      const { rows } = await pool.query(
        `SELECT message, COUNT(*)::int AS n FROM error_log
          WHERE source = 'server' AND status >= 500 AND occurred_at >= now() - interval '24 hours'
          GROUP BY message ORDER BY n DESC LIMIT 5`);
      return { count: rows.reduce((a, x) => a + x.n, 0), lines: rows.map(x => `${x.n} × ${x.message}`) };
    },
    hit: (count, thr) => count >= thr
  },
  backup_failed: {
    label: 'Sauvegarde en échec', type: 'event',
    help: 'Vous prévient à chaque sauvegarde (automatique ou manuelle) qui échoue.',
    async run({ since }) {
      const { rows } = await pool.query(
        `SELECT kind, started_at, file_name, error_message FROM backup_logs
          WHERE status <> 'ok' AND started_at > $1 ORDER BY started_at`, [since]);
      return { count: rows.length, lines: rows.map(x => `${fmtDate(x.started_at)} (${x.kind}) : ${x.error_message || x.file_name || 'erreur inconnue'}`) };
    }
  },
  station_without_client: {
    label: 'Station sans client', type: 'state',
    help: 'Vous prévient tant qu’une station n’est rattachée à aucun client (à régler dans Pilotage > Synthèse).',
    async run() {
      const { rows } = await pool.query('SELECT name FROM stations WHERE client_id IS NULL ORDER BY name');
      return { count: rows.length, lines: rows.map(x => `Station « ${x.name} » non rattachée`) };
    },
    hit: count => count > 0
  },
  client_created: {
    label: 'Nouveau client créé', type: 'event',
    help: 'Vous prévient à chaque création d’un compte client.',
    async run({ since }) {
      const { rows } = await pool.query('SELECT name, created_at FROM clients WHERE created_at > $1 ORDER BY created_at', [since]);
      return { count: rows.length, lines: rows.map(x => `${x.name} (créé le ${fmtDate(x.created_at)})`) };
    }
  }
};

async function evaluateRule(kind, rule, now) {
  const def = KINDS[kind];
  const thr = def.threshold ? rule.threshold_value : null;
  const since = rule.last_checked_at ? new Date(rule.last_checked_at) : new Date(now.getTime() - 24 * HOUR);
  const { count, lines } = await def.run({ since, thr, now });
  const hit = def.type === 'event' ? count > 0 : def.hit(count, thr);
  const cooling = def.type === 'state' && !!rule.last_fired_at && now - new Date(rule.last_fired_at) < COOLDOWN_MS;
  let sent = false, error = null;
  if (hit && !cooling) {
    try {
      await require('./mailer').sendMail({
        to: rule.email,
        subject: `Manager PRO — ${def.label} (${count})`,
        text: `${def.label} : ${count} élément(s).\n\n${lines.slice(0, MAX_LINES).join('\n')}\n\n` +
          'Message automatique de la règle de notification du Superadmin (Centre de contrôle > Pilotage > Règle des notification).'
      });
      sent = true;
    } catch (e) { error = e.message || String(e); }
  }
  // Un échec d'envoi ne consomme pas l'événement : il sera renvoyé à la vérification suivante.
  const advance = !(hit && !cooling && !sent);
  await pool.query(
    `UPDATE platform_alert_rules SET last_value = $2, last_error = $3,
            last_checked_at = CASE WHEN $4 THEN $5::timestamptz ELSE last_checked_at END,
            last_fired_at  = CASE WHEN $6 THEN $5::timestamptz ELSE last_fired_at END
      WHERE alert_kind = $1`, [kind, count, error, advance, now, sent]);
  return { kind, count, hit, sent, cooling, error };
}

/** Évalue toutes les règles actives. Ne lève pas : une règle en erreur n'empêche pas les autres. */
async function runPlatformAlerts(now = new Date()) {
  const { rows } = await pool.query('SELECT * FROM platform_alert_rules WHERE active = TRUE');
  const out = [];
  for (const rule of rows) {
    if (!KINDS[rule.alert_kind] || !rule.email) continue;
    try { out.push(await evaluateRule(rule.alert_kind, rule, now)); }
    catch (e) {
      out.push({ kind: rule.alert_kind, error: e.message });
      await pool.query('UPDATE platform_alert_rules SET last_error = $2 WHERE alert_kind = $1', [rule.alert_kind, String(e.message).slice(0, 500)]).catch(() => {});
    }
  }
  return out;
}

r.get('/admin/platform/alert-rules', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM platform_alert_rules');
  const map = Object.fromEntries(rows.map(x => [x.alert_kind, x]));
  const { channelState } = require('./notify_channels');
  const rules = Object.entries(KINDS).map(([k, def]) => {
    const x = map[k] || {};
    return {
      alert_kind: k, label: def.label, help: def.help, type: def.type, threshold: def.threshold || null,
      active: !!x.active, threshold_value: x.threshold_value ?? (def.threshold ? def.threshold.default : null), email: x.email || '',
      last_checked_at: x.last_checked_at || null, last_fired_at: x.last_fired_at || null, last_value: x.last_value ?? null, last_error: x.last_error || null
    };
  });
  res.json({ rules, email_available: channelState().email.available });
}));

r.put('/admin/platform/alert-rules/:kind', needPrincipal, body(z.object({
  active: z.boolean(),
  threshold_value: z.number().int().nullable().optional(),
  email: z.string().max(200)
})), wrap(async (req, res) => {
  const kind = req.params.kind;
  const def = KINDS[kind];
  if (!def) throw new HttpError(404, 'Type d’alerte inconnu.');
  const b = req.body, email = (b.email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (b.active && !email) throw new HttpError(400, 'Indiquez une adresse e-mail pour activer cette alerte.');
  let thr = null;
  if (def.threshold) {
    thr = b.threshold_value ?? def.threshold.default;
    if (!Number.isInteger(thr) || thr < def.threshold.min || thr > def.threshold.max) {
      throw new HttpError(400, `${def.threshold.label} : valeur entre ${def.threshold.min} et ${def.threshold.max}.`);
    }
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO platform_alert_rules (alert_kind, active, threshold_value, email, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (alert_kind) DO UPDATE SET active = EXCLUDED.active, threshold_value = EXCLUDED.threshold_value,
       email = EXCLUDED.email, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING alert_kind, active, threshold_value, email`,
    [kind, b.active, thr, email, req.user.id]);
  await audit(pool, req, 'alertes', `Règle plateforme ${kind} ${b.active ? 'activée' : 'désactivée'}`, 'platform_alert_rules', null, null,
    { alert_kind: kind, active: b.active, threshold_value: thr });
  res.json(row);
}));

r.post('/admin/platform/alert-rules/run', needPrincipal, wrap(async (req, res) => {
  const out = await withTaskLock(TASK_LOCKS.PLATFORM_ALERTS, () => runPlatformAlerts());
  res.json({ results: Array.isArray(out) ? out : [], skipped: out && out.skipped ? out.skipped : null });
}));

/** Vérification périodique (15 min), sous verrou : une seule instance du serveur évalue les règles. */
function startScheduler() {
  if (process.env.ALERTS_AUTO === '0') return null;
  const tick = () => withTaskLock(TASK_LOCKS.PLATFORM_ALERTS, () => runPlatformAlerts()).catch(e => console.warn('[alertes-plateforme]', e.message));
  const timer = setInterval(tick, SCAN_MS); if (timer.unref) timer.unref();
  const first = setTimeout(tick, 90 * 1000); if (first.unref) first.unref();
  return timer;
}

module.exports = { r, KINDS, runPlatformAlerts, startScheduler };
