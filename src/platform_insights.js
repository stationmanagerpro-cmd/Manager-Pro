'use strict';
/** Superadmin : santé des clients, comparaison des stations, journal des erreurs, relances automatiques de licence.
 *  Réservé à l'administrateur principal. Ne lit que des AGRÉGATS (comptes, totaux) : aucune vente, aucun client final, aucun employé n'est exposé. */
const express = require('express');
const { z } = require('zod');
const { pool, HttpError, wrap, body } = require('./core');
const { swallow } = require('./safe');
const { needPrincipal, licenseStatusOf, daysRemaining, getWarningThresholds } = require('./contracts');
const { healthScore } = require('./client_health');
const { dueBand, reminderText } = require('./license_reminders');
const r = express.Router();
const daysParam = (q, def = 30) => Math.min(Math.max(parseInt(q, 10) || def, 7), 365);

// ---------- 1. Santé des clients ----------
r.get('/admin/platform/health', needPrincipal, wrap(async (req, res) => {
  const days = daysParam(req.query.days);
  const [clients, act, sh] = await Promise.all([
    pool.query(`SELECT c.id, c.name, c.status AS client_status, ct.status AS contract_status, ct.expires_at, ct.is_indefinite, ct.end_date
                  FROM clients c LEFT JOIN client_contracts ct ON ct.client_id = c.id WHERE c.status <> 'archive' ORDER BY c.name`),
    // Jours d'activité = jours avec une connexion (user_sessions) OU un temps d'utilisation mesuré (user_usage).
    pool.query(`SELECT x.client_id, COUNT(DISTINCT x.day)::int AS active_days FROM (
                   SELECT u.client_id, uu.day FROM user_usage uu JOIN users u ON u.id = uu.user_id
                    WHERE uu.day >= CURRENT_DATE - $1::int AND u.client_id IS NOT NULL
                   UNION
                   SELECT u.client_id, ss.created_at::date AS day FROM user_sessions ss JOIN users u ON u.id = ss.user_id
                    WHERE ss.created_at >= CURRENT_DATE - $1::int AND u.client_id IS NOT NULL
                 ) x GROUP BY x.client_id`, [days]),
    pool.query(`SELECT s.client_id,
                       COUNT(*) FILTER (WHERE sh.status IN ('ouvert','ferme'))::int AS opened,
                       COUNT(*) FILTER (WHERE sh.status = 'ferme')::int AS closed,
                       COUNT(*) FILTER (WHERE sh.status = 'ouvert' AND sh.opened_at < now() - interval '24 hours')::int AS stale,
                       COUNT(*) FILTER (WHERE sh.status = 'ferme' AND COALESCE(ABS(sh.cash_gap), 0) > 0)::int AS gaps
                  FROM shifts sh JOIN stations s ON s.id = sh.station_id
                 WHERE sh.opened_at >= now() - ($1::int * interval '1 day') AND s.client_id IS NOT NULL GROUP BY s.client_id`, [days])
  ]);
  const A = Object.fromEntries(act.rows.map(x => [x.client_id, x.active_days])), S = Object.fromEntries(sh.rows.map(x => [x.client_id, x]));
  const now = new Date();
  const items = clients.rows.map(c => {
    const exp = c.expires_at || (c.end_date ? c.end_date + 'T23:59:59Z' : null);
    const status = licenseStatusOf({ ...c, expires_at: c.expires_at }, now), s = S[c.id] || {};
    const h = healthScore({ activeDays: A[c.id] || 0, windowDays: days, shiftsOpened: s.opened || 0, shiftsClosed: s.closed || 0, staleOpenShifts: s.stale || 0, gapShifts: s.gaps || 0,
      license: { status, daysRemaining: c.is_indefinite ? null : daysRemaining(exp, now), indefinite: !!c.is_indefinite } });
    return { client_id: c.id, name: c.name, license_status: status, ...h, active_days: A[c.id] || 0, shifts_closed: s.closed || 0, shifts_opened: s.opened || 0 };
  }).sort((a, b) => a.score - b.score);
  res.json({ days, clients: items, at_risk: items.filter(i => i.level === 'a_risque').length, watch: items.filter(i => i.level === 'a_surveiller').length });
}));


// ---------- 3. Journal des erreurs ----------
const clip = (s, n) => (s == null ? null : String(s).slice(0, n));
/** Enregistre une erreur sans jamais lever (le journal ne doit pas casser l'appli). Dédoublonne : même erreur dans la minute = 1 ligne. */
async function logError(e) {
  try {
    await pool.query(
      `INSERT INTO error_log(source, method, path, status, code, message, stack, view, user_id, client_id, user_agent)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11
        WHERE NOT EXISTS (SELECT 1 FROM error_log WHERE source = $1 AND message = $6 AND COALESCE(path,'') = COALESCE($3,'') AND occurred_at > now() - interval '1 minute')`,
      [e.source, clip(e.method, 10), clip(e.path, 300), e.status || null, clip(e.code, 20), clip(e.message, 500) || 'Erreur', clip(e.stack, 4000), clip(e.view, 60), e.user_id || null, e.client_id || null, clip(e.user_agent, 200)]);
  } catch (_) { /* journal facultatif */ }
}
const rate = new Map();
r.post('/errors/client', body(z.object({ message: z.string().min(1).max(500), stack: z.string().max(4000).optional().nullable(), view: z.string().max(60).optional().nullable(), path: z.string().max(300).optional().nullable() })), wrap(async (req, res) => {
  const k = req.user && req.user.id; const now = Date.now(); const w = (rate.get(k) || []).filter(t => now - t < 60000);
  if (w.length >= 10) return res.json({ ok: true, dropped: true });
  w.push(now); rate.set(k, w);
  if (!req.user || req.user.is_global) return res.json({ ok: true });
  await logError({ source: 'client', path: req.body.path, message: req.body.message, stack: req.body.stack, view: req.body.view, user_id: req.user.id, client_id: req.user.client_id, user_agent: req.get('user-agent') });
  res.json({ ok: true });
}));
r.get('/admin/platform/errors', needPrincipal, wrap(async (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours, 10) || 72, 1), 720);
  const { rows } = await pool.query(
    `SELECT e.source, e.method, e.path, e.status, e.code, e.message, e.view, MAX(e.occurred_at) AS last_at, MIN(e.occurred_at) AS first_at, COUNT(*)::int AS occurrences,
            COUNT(DISTINCT e.client_id)::int AS clients, (array_agg(e.stack ORDER BY e.occurred_at DESC))[1] AS stack
       FROM error_log e WHERE e.occurred_at >= now() - ($1::int * interval '1 hour')
      GROUP BY e.source, e.method, e.path, e.status, e.code, e.message, e.view ORDER BY MAX(e.occurred_at) DESC LIMIT 200`, [hours]);
  res.json({ hours, errors: rows, total: rows.reduce((a, x) => a + x.occurrences, 0) });
}));

// ---------- 2. Relances automatiques de licence ----------
/** Envoie les relances dues (une par client, échéance et palier). Retourne le nombre de relances créées. */
async function sendLicenseReminders(now = new Date()) {
  const { rows: cs } = await pool.query(
    `SELECT c.id, c.name, ct.expires_at, ct.end_date, ct.is_indefinite, ct.status AS contract_status, c.status AS client_status
       FROM clients c JOIN client_contracts ct ON ct.client_id = c.id WHERE c.status = 'actif' AND COALESCE(ct.is_indefinite, FALSE) = FALSE`).catch(swallow('platform_insights:licences', { rows: [] }));
  let bands; try { bands = (await getWarningThresholds()).filter(t => [30, 15, 7].includes(t)); } catch (_) { bands = null; }
  let sent = 0;
  for (const c of cs) {
    const exp = c.expires_at || (c.end_date ? c.end_date + 'T23:59:59Z' : null); if (!exp) continue;
    if (c.contract_status === 'suspendu') continue;
    const days = daysRemaining(exp, now), band = dueBand(days, bands && bands.length ? bands : undefined);
    if (band == null) continue;
    const expiresOn = new Date(exp).toISOString().slice(0, 10);
    const { rowCount } = await pool.query('INSERT INTO license_reminders(client_id, expires_on, band) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [c.id, expiresOn, band]);
    if (!rowCount) continue;
    const { rows: sts } = await pool.query('SELECT id FROM stations WHERE client_id = $1 AND active = TRUE', [c.id]);
    const text = reminderText({ clientName: c.name, band, days, expiresOn });
    for (const s of sts) await pool.query("INSERT INTO notifications(station_id, level, kind, message, ref_table, ref_id) VALUES ($1,$2,'licence_expiration',$3,'clients',$4)", [s.id, days <= 7 ? 'critical' : 'warning', text, c.id]);
    await pool.query('UPDATE license_reminders SET stations = $3 WHERE client_id = $1 AND expires_on = $2 AND band = $4', [c.id, expiresOn, sts.length, band]);
    sent++;
  }
  return sent;
}
function startScheduler() {
  const tick = () => { sendLicenseReminders().catch(e => console.warn('[relance-licence]', e.message)); pool.query("DELETE FROM error_log WHERE occurred_at < now() - interval '30 days'").catch(() => {}); pool.query("DELETE FROM usage_detail WHERE day < CURRENT_DATE - 400").catch(() => {}); };
  const t0 = setTimeout(tick, 2 * 60 * 1000), t1 = setInterval(tick, 6 * 3600 * 1000);
  if (t0.unref) t0.unref(); if (t1.unref) t1.unref();
}
r.post('/admin/platform/license-reminders/run', needPrincipal, wrap(async (req, res) => res.json({ sent: await sendLicenseReminders() })));
r.get('/admin/platform/license-reminders', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT lr.client_id, c.name, lr.expires_on, lr.band, lr.sent_at, lr.stations FROM license_reminders lr JOIN clients c ON c.id = lr.client_id ORDER BY lr.sent_at DESC LIMIT 100`);
  res.json(rows);
}));

module.exports = { r, logError, sendLicenseReminders, startScheduler };
