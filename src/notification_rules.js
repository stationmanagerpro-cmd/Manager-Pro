'use strict';
/**
 * Règles de notification sur rapports :
 * nom, déclencheur, modèle e-mail, 1–5 rapports, priorité, périodicité.
 */
const express = require('express');
const { z } = require('zod');
const { pool, wrap, body, need, audit, HttpError } = require('./core');
const { swallow } = require('./safe');
const { loadContractForUser, featureOn } = require('./contracts');
const { sendMail } = require('./mailer');

const r = express.Router();

const REPORT_CATALOG = [
  { key: 'direction_digest', label: 'Digest direction (KPI du jour)' },
  { key: 'eod', label: 'Fin de journée' },
  { key: 'reconciliation', label: 'Rapprochement pompes / ventes / caisse' },
  { key: 'sales', label: 'Rapport des ventes' },
  { key: 'stock', label: 'Rapport des stocks' },
  { key: 'expenses', label: 'Rapport des dépenses' },
  { key: 'financial_summary', label: 'Situation financière' },
  { key: 'operational_alerts', label: 'Alertes opérationnelles' },
  { key: 'stock_summary', label: 'Synthèse des stocks' },
  { key: 'hr_summary', label: 'Synthèse du personnel' },
  { key: 'shifts', label: 'Quarts de service' },
  { key: 'invoices', label: 'Facturation clients' },
  { key: 'audit', label: 'Journal d’audit' }
];
const REPORT_KEYS = new Set(REPORT_CATALOG.map(x => x.key));

function channelAvailability() {
  // Source unique : notify_channels.channelState (SMS et WhatsApp restent désactivés tant que .env ne les active pas).
  const st = require('./notify_channels').channelState();
  const label = { app: 'Application (interne)', email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp' };
  return ['app', 'email', 'sms', 'whatsapp'].map(id => ({ id, label: label[id], available: st[id].available, reason: st[id].reason }));
}


const TRIGGERS = [
  { id: 'on_report_create', label: 'Sur création de rapport' },
  { id: 'on_report_update', label: 'Sur modification de rapport' },
  { id: 'on_report_approve', label: 'Sur approbation du rapport' },
  { id: 'on_schedule', label: 'Sur planification (envoi automatique)' }
];

async function clientIdOf(userId) {
  const { rows: [u] } = await pool.query(
    'SELECT client_id FROM users WHERE id=$1 AND active AND deleted_at IS NULL', [userId]
  );
  if (!u?.client_id) throw new HttpError(403, 'Compte client indisponible.');
  return Number(u.client_id);
}

async function requireClientAdmin(req) {
  if (req.user.is_global) throw new HttpError(403, 'Réservé aux administrateurs du compte client.');
  const contract = await loadContractForUser(req.user.id, false);
  if (contract?.suspended) throw new HttpError(403, 'Contrat suspendu.');
  if (contract && contract.features && contract.features.can_use_auto_alerts === false) {
    throw new HttpError(403, 'Notifications automatiques non autorisées par le contrat.', {
      code: 'FEATURE_DISABLED', feature: 'can_use_auto_alerts'
    });
  }
  return clientIdOf(req.user.id);
}

function computeNextRun({ frequency, scheduled_date, send_time }, after = new Date()) {
  if (!frequency) return null;
  const m = /^(\d{2}):(\d{2})$/.exec(String(send_time || '08:00').slice(0, 5));
  const hh = m ? +m[1] : 8;
  const mm = m ? +m[2] : 0;
  const atDay = (y, mo, d) => new Date(Date.UTC(y, mo, d, hh, mm, 0, 0));

  if (frequency === 'once') {
    if (!scheduled_date) throw new HttpError(400, 'Date précise obligatoire pour une envoi unique.');
    const [y, mo, d] = String(scheduled_date).slice(0, 10).split('-').map(Number);
    const dt = atDay(y, mo - 1, d);
    if (dt <= after) throw new HttpError(400, 'La date d’envoi doit être dans le futur.');
    return dt;
  }

  let day = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate()));
  for (let i = 0; i < 800; i++, day.setUTCDate(day.getUTCDate() + 1)) {
    const y = day.getUTCFullYear();
    const mo = day.getUTCMonth();
    const d = day.getUTCDate();
    let match = false;
    if (frequency === 'daily') match = true;
    else if (frequency === 'weekly') match = day.getUTCDay() === 1; // lundi
    else if (frequency === 'quarterly') match = d === 1 && [0, 3, 6, 9].includes(mo);
    else if (frequency === 'semester') match = d === 1 && [0, 6].includes(mo);
    else if (frequency === 'annual') match = d === 1 && mo === 0;
    if (!match) continue;
    const candidate = atDay(y, mo, d);
    if (candidate > after) return candidate;
  }
  throw new HttpError(400, 'Impossible de calculer la prochaine exécution.');
}

r.get('/notification-rules/meta', need('settings.edit', 'user.manage', 'report.view'), wrap(async (req, res) => {
  res.json({
    reports: REPORT_CATALOG,
    triggers: TRIGGERS,
    priorities: [
      { id: 'faible', label: 'Faible' },
      { id: 'important', label: 'Important' },
      { id: 'urgent', label: 'Urgent' }
    ],
    frequencies: [
      { id: 'daily', label: 'Quotidien' },
      { id: 'weekly', label: 'Hebdomadaire' },
      { id: 'quarterly', label: 'Trimestriel' },
      { id: 'semester', label: 'Semestriel' },
      { id: 'annual', label: 'Annuel' },
      { id: 'once', label: 'Date précise' }
    ],
    email_modes: [
      { id: 'system_default', label: 'Utiliser le système par défaut' },
      { id: 'custom', label: 'Personnalisé' }
    ],
    email_configured: !!process.env.SMTP_HOST,
    channels: channelAvailability()
  });
}));

r.get('/notification-rules', need('settings.edit', 'user.manage', 'report.view'), wrap(async (req, res) => {
  const clientId = await requireClientAdmin(req);
  const { rows } = await pool.query(
    `SELECT * FROM notification_rules WHERE client_id=$1 ORDER BY id DESC`, [clientId]
  );
  const { rows: users } = await pool.query(
    `SELECT u.id, u.login, u.full_name, (SELECT e.email FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1) AS email FROM users u
     WHERE u.client_id=$1 AND u.active AND u.deleted_at IS NULL ORDER BY COALESCE(u.full_name, u.login)`, [clientId]
  );
  res.json({ rules: rows, users, reports: REPORT_CATALOG });
}));

const ruleBody = z.object({
  name: z.string().trim().min(2).max(120),
  trigger_event: z.enum(['on_report_create', 'on_report_update', 'on_report_approve', 'on_schedule']),
  email_mode: z.enum(['system_default', 'custom']).default('system_default'),
  subject_default: z.string().max(200).nullable().optional(),
  body_default: z.string().max(5000).nullable().optional(),
  include_attachments: z.boolean().default(false),
  report_keys: z.array(z.string()).min(1).max(5),
  priority: z.enum(['faible', 'important', 'urgent']).default('important'),
  frequency: z.enum(['daily', 'weekly', 'quarterly', 'semester', 'annual', 'once']).nullable().optional(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  send_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  recipient_user_ids: z.array(z.number().int().positive()).max(50).default([]),
  email_recipients: z.array(z.string().email()).max(20).default([]),
  delivery_channels: z.array(z.enum(['app','email','sms','whatsapp'])).min(1).max(4).default(['app']),
  station_id: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true)
});

function validateRule(b) {
  for (const k of b.report_keys) {
    if (!REPORT_KEYS.has(k)) throw new HttpError(400, 'Rapport inconnu : ' + k);
  }
  if (b.email_mode === 'custom') {
    if (!b.subject_default || !String(b.subject_default).trim()) {
      throw new HttpError(400, 'Sujet obligatoire pour un modèle personnalisé.');
    }
    if (!b.body_default || !String(b.body_default).trim()) {
      throw new HttpError(400, 'Corps obligatoire pour un modèle personnalisé.');
    }
  }
  if (b.trigger_event === 'on_schedule') {
    if (!b.frequency) throw new HttpError(400, 'Choisissez une périodicité d’envoi.');
  }
  if (!b.recipient_user_ids.length && !b.email_recipients.length) {
    throw new HttpError(400, 'Indiquez au moins un destinataire (utilisateur ou e-mail).');
  }
  const chans = channelAvailability();
  const byId = Object.fromEntries(chans.map(c => [c.id, c]));
  const channels = b.delivery_channels || ['app'];
  if (!channels.length) throw new HttpError(400, 'Choisissez au moins un canal d\'envoi.');
  for (const ch of channels) {
    if (!byId[ch]) throw new HttpError(400, 'Canal inconnu : ' + ch);
    if (!byId[ch].available) {
      throw new HttpError(400, 'Le canal « ' + byId[ch].label + ' » n\'est pas disponible : ' + (byId[ch].reason || 'pas dispo'));
    }
  }
  b.delivery_channels = channels;
}

r.post('/notification-rules', need('settings.edit', 'user.manage'), body(ruleBody), wrap(async (req, res) => {
  const clientId = await requireClientAdmin(req);
  const b = req.body;
  validateRule(b);
  let nextRun = null;
  if (b.trigger_event === 'on_schedule') {
    nextRun = computeNextRun({ frequency: b.frequency, scheduled_date: b.scheduled_date, send_time: b.send_time || '08:00' });
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO notification_rules(
      client_id, station_id, name, trigger_event, email_mode, subject_default, body_default,
      include_attachments, report_keys, priority, frequency, scheduled_date, send_time,
      recipient_user_ids, email_recipients, delivery_channels, active, next_run_at, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    RETURNING *`,
    [
      clientId, b.station_id ?? null, b.name, b.trigger_event, b.email_mode,
      b.subject_default || null, b.body_default || null, !!b.include_attachments,
      b.report_keys, b.priority, b.frequency || null, b.scheduled_date || null,
      b.send_time || '08:00', b.recipient_user_ids, b.email_recipients,
      b.delivery_channels || ['app'], b.active, nextRun, req.user.id
    ]
  );
  await audit(pool, req, 'notifications', `Règle de notification créée : ${b.name}`, 'notification_rules', row.id);
  res.status(201).json(row);
}));

r.put('/notification-rules/:id', need('settings.edit', 'user.manage'), body(ruleBody), wrap(async (req, res) => {
  const clientId = await requireClientAdmin(req);
  const id = +req.params.id;
  const b = req.body;
  validateRule(b);
  let nextRun = null;
  if (b.trigger_event === 'on_schedule') {
    nextRun = computeNextRun({ frequency: b.frequency, scheduled_date: b.scheduled_date, send_time: b.send_time || '08:00' });
  }
  const { rows: [row] } = await pool.query(
    `UPDATE notification_rules SET
      station_id=$3, name=$4, trigger_event=$5, email_mode=$6, subject_default=$7, body_default=$8,
      include_attachments=$9, report_keys=$10, priority=$11, frequency=$12, scheduled_date=$13, send_time=$14,
      recipient_user_ids=$15, email_recipients=$16, delivery_channels=$17, active=$18, next_run_at=$19, updated_at=now()
     WHERE id=$1 AND client_id=$2 RETURNING *`,
    [
      id, clientId, b.station_id ?? null, b.name, b.trigger_event, b.email_mode,
      b.subject_default || null, b.body_default || null, !!b.include_attachments,
      b.report_keys, b.priority, b.frequency || null, b.scheduled_date || null,
      b.send_time || '08:00', b.recipient_user_ids, b.email_recipients,
      b.delivery_channels || ['app'], b.active, nextRun
    ]
  );
  if (!row) throw new HttpError(404, 'Règle introuvable');
  await audit(pool, req, 'notifications', `Règle de notification modifiée : ${b.name}`, 'notification_rules', id);
  res.json(row);
}));

r.patch('/notification-rules/:id/active', need('settings.edit', 'user.manage'), body(z.object({
  active: z.boolean()
})), wrap(async (req, res) => {
  const clientId = await requireClientAdmin(req);
  const id = +req.params.id;
  // Réactivation d'une règle planifiée : la prochaine exécution est recalculée (sinon elle ne partirait jamais ou partirait aussitôt en retard).
  let nextRun = null;
  if (req.body.active) {
    const { rows: [cur] } = await pool.query('SELECT trigger_event, frequency, scheduled_date, send_time FROM notification_rules WHERE id=$1 AND client_id=$2', [id, clientId]);
    if (cur && cur.trigger_event === 'on_schedule') nextRun = computeNextRun({ frequency: cur.frequency, scheduled_date: cur.scheduled_date, send_time: cur.send_time || '08:00' });
  }
  const { rows: [row] } = await pool.query(
    `UPDATE notification_rules SET active=$3, next_run_at=COALESCE($4::timestamptz, next_run_at), updated_at=now() WHERE id=$1 AND client_id=$2 RETURNING *`,
    [id, clientId, req.body.active, nextRun]
  );
  if (!row) throw new HttpError(404, 'Règle introuvable');
  res.json(row);
}));

r.delete('/notification-rules/:id', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  const clientId = await requireClientAdmin(req);
  const id = +req.params.id;
  const { rowCount } = await pool.query(
    `DELETE FROM notification_rules WHERE id=$1 AND client_id=$2`, [id, clientId]
  );
  if (!rowCount) throw new HttpError(404, 'Règle introuvable');
  await audit(pool, req, 'notifications', `Règle de notification supprimée #${id}`, 'notification_rules', id);
  res.json({ ok: true });
}));

// Synthèse chiffrée du jour jointe aux notifications programmées (ventes, quarts ouverts, stocks sous le minimum).
async function buildDigest(rule) {
  const params = [rule.client_id]; let stationFilter = '';
  if (rule.station_id) { params.push(rule.station_id); stationFilter = ` AND s.id = $${params.length}`; }
  const { rows: [d] } = await pool.query(
    `WITH st AS (SELECT s.id FROM stations s WHERE s.client_id = $1 AND s.active${stationFilter})
     SELECT
       COALESCE((SELECT SUM(total) FROM sales WHERE station_id IN (SELECT id FROM st) AND status = 'valide' AND sold_at::date = current_date), 0) AS sales_today,
       (SELECT COUNT(*) FROM shifts WHERE station_id IN (SELECT id FROM st) AND status = 'ouvert') AS open_shifts,
       (SELECT COUNT(*) FROM products p JOIN stock k ON k.product_id = p.id
         WHERE p.station_id IN (SELECT id FROM st) AND p.deleted_at IS NULL AND p.min_stock > 0 AND k.quantity <= p.min_stock) AS low_stock`, params
  ).catch(swallow('notification_rules:lecture-regle', { rows: [null] }));
  if (!d) return '';
  return `\n\nSynthèse du jour :\n- Ventes enregistrées : ${Math.round(Number(d.sales_today))} FCFA\n- Quarts ouverts : ${d.open_shifts}\n- Produits sous le stock minimum : ${d.low_stock}`;
}

async function contractAllows(rule) {
  const uid = rule.created_by;
  if (!uid) return true;
  const contract = await loadContractForUser(uid, false).catch(swallow('notification_rules:contrat', null));
  if (!contract) return true;
  if (contract.suspended) return false;
  return !(contract.features && contract.features.can_use_auto_alerts === false);
}

/** Diffuse une règle : application (messagerie interne) et/ou e-mail, selon les canaux choisis. Retourne un résultat détaillé. */
async function deliverRule(rule, { trigger, extra = {} }) {
  const channels = Array.isArray(rule.delivery_channels) && rule.delivery_channels.length ? rule.delivery_channels : ['app'];
  const labels = (rule.report_keys || []).map(k => (REPORT_CATALOG.find(x => x.key === k) || { label: k }).label).join(', ');
  const prio = String(rule.priority || 'important').toUpperCase();
  const subject = rule.email_mode === 'custom' && rule.subject_default ? rule.subject_default : `[${prio}] ${rule.name}`;
  const digest = trigger === 'on_schedule' ? await buildDigest(rule) : '';
  const text = (rule.email_mode === 'custom' && rule.body_default
    ? rule.body_default
    : `Règle : ${rule.name}\nPriorité : ${rule.priority}\nRapports : ${labels || '—'}\nDéclencheur : ${(TRIGGERS.find(t => t.id === trigger) || { label: trigger }).label}`) + (extra.note ? `\n\n${extra.note}` : '') + digest;
  const result = { app: 0, email: 0, errors: [] };

  if (channels.includes('app')) {
    try {
      const { deliverSystemMessage } = require('./messaging');
      const r2 = await deliverSystemMessage({ clientId: rule.client_id, userIds: rule.recipient_user_ids || [], title: `${rule.priority === 'urgent' ? '🔴 ' : ''}${rule.name}`, body: text, kind: 'notification_rule', refTable: 'notification_rules', refId: rule.id });
      if (r2.sent) result.app = r2.recipients; else result.errors.push('Application : aucun destinataire valide');
    } catch (e) { result.errors.push('Application : ' + e.message); }
  }
  if (channels.includes('email')) {
    const emails = [...(rule.email_recipients || [])];
    if ((rule.recipient_user_ids || []).length) {
      const { rows: us } = await pool.query(
        `SELECT e.email FROM users u JOIN employees e ON e.user_id = u.id AND e.deleted_at IS NULL
          WHERE u.id = ANY($1::bigint[]) AND e.email IS NOT NULL AND e.email <> ''`, [rule.recipient_user_ids]);
      for (const u of us) emails.push(u.email);
    }
    const unique = [...new Set(emails.map(e => String(e).trim().toLowerCase()).filter(Boolean))];
    if (!unique.length) result.errors.push('E-mail : aucune adresse (ajoutez une adresse ou renseignez l’e-mail des employés)');
    else if (!process.env.SMTP_HOST) result.errors.push('E-mail : serveur SMTP non configuré');
    else for (const to of unique) {
      try { await sendMail({ to, subject, text: 'Notification Manager PRO\n\n' + text }); result.email++; }
      catch (e) { result.errors.push(`E-mail ${to} : ${e.message}`); }
    }
  }
  const delivered = result.app + result.email;
  await pool.query(
    `UPDATE notification_rules SET last_sent_at = CASE WHEN $2 > 0 THEN now() ELSE last_sent_at END, last_error = $3, last_result = $4::jsonb WHERE id = $1`,
    [rule.id, delivered, result.errors.length ? result.errors.join(' | ').slice(0, 500) : null, JSON.stringify({ app: result.app, email: result.email, at: new Date().toISOString() })]
  ).catch(swallow('notification_rules:maj-statut-envoi', undefined));
  return result;
}

/** Événement métier (ex. création d'un rapport) : déclenche les règles actives correspondantes. */
async function fireNotificationRules({ clientId, trigger, reportKey, actorUserId, extra = {} }) {
  const { rows } = await pool.query(
    `SELECT * FROM notification_rules WHERE client_id = $1 AND active = TRUE AND trigger_event = $2 AND $3 = ANY(report_keys)`,
    [clientId, trigger, reportKey]);
  let sent = 0;
  for (const rule of rows) {
    if (!(await contractAllows(rule))) continue;
    const r2 = await deliverRule(rule, { trigger, extra });
    sent += r2.app + r2.email;
  }
  return { matched: rows.length, sent };
}

/** Exécute les règles « sur planification » arrivées à échéance. Chaque règle est réservée atomiquement (pas de double envoi multi-instance). */
let dispatching = false;
async function dispatchDueNotificationRules() {
  if (dispatching) return { skipped: true };
  dispatching = true;
  // RG-08 / ANO-07 : verrou consultatif (une seule instance traite l'échéance) en plus de la réservation atomique de chaque règle.
  try { return await require('./task_lock').withTaskLock(require('./task_lock').TASK_LOCKS.NOTIFICATIONS, dispatchDueRules); }
  finally { dispatching = false; }
}
async function dispatchDueRules() {
  {
    const { rows: due } = await pool.query(
      `SELECT * FROM notification_rules WHERE active = TRUE AND trigger_event = 'on_schedule' AND next_run_at IS NOT NULL AND next_run_at <= now() ORDER BY next_run_at LIMIT 50`);
    let fired = 0;
    for (const rule of due) {
      let next = null;
      if (rule.frequency && rule.frequency !== 'once') {
        try { next = computeNextRun({ frequency: rule.frequency, scheduled_date: rule.scheduled_date, send_time: rule.send_time || '08:00' }, new Date()); } catch (e) { next = null; }
      }
      // Réservation : une seule instance obtient la ligne ; un envoi unique est désactivé après exécution.
      const { rowCount } = await pool.query(
        `UPDATE notification_rules SET next_run_at = $2::timestamptz, active = CASE WHEN $2::timestamptz IS NULL THEN FALSE ELSE active END
          WHERE id = $1 AND active = TRUE AND next_run_at IS NOT NULL AND next_run_at <= now()`, [rule.id, next]);
      if (!rowCount) continue;
      if (!(await contractAllows(rule))) { await pool.query(`UPDATE notification_rules SET last_error = $2 WHERE id = $1`, [rule.id, 'Notifications automatiques non autorisées par le contrat']).catch(() => {}); continue; }
      try { await deliverRule(rule, { trigger: 'on_schedule' }); fired++; }
      catch (e) { console.warn(`[notification-rules] règle ${rule.id} :`, e.message); await pool.query(`UPDATE notification_rules SET last_error = $2 WHERE id = $1`, [rule.id, e.message.slice(0, 500)]).catch(() => {}); }
    }
    return { due: due.length, fired };
  }
}
function startNotificationScheduler() {
  if (process.env.ALERTS_AUTO === '0') return null;
  const tick = () => dispatchDueNotificationRules().catch(e => console.warn('[notification-rules] planificateur :', e.message));
  const first = setTimeout(tick, 15000); if (first.unref) first.unref();
  const timer = setInterval(tick, 60 * 1000); if (timer.unref) timer.unref();
  console.log('[notification-rules] Planificateur des règles de notification activé (vérification chaque minute)');
  return timer;
}

// Envoi de test immédiat d'une règle (bouton « Tester »).
r.post('/notification-rules/:id/test', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  const clientId = await requireClientAdmin(req);
  const { rows: [rule] } = await pool.query('SELECT * FROM notification_rules WHERE id = $1 AND client_id = $2', [+req.params.id, clientId]);
  if (!rule) throw new HttpError(404, 'Règle introuvable');
  const out = await deliverRule(rule, { trigger: rule.trigger_event, extra: { note: 'Ceci est un envoi de test.' } });
  res.json({ ok: out.errors.length === 0 && (out.app + out.email) > 0, ...out });
}));

module.exports = { r, fireNotificationRules, dispatchDueNotificationRules, startNotificationScheduler, computeNextRun, REPORT_CATALOG };
