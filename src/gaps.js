'use strict';
/** Fonctions qui avaient des tables ou des écrans manquants (audit 2026-11-12) :
 *  transferts de stock entre stations · historique des compteurs · remboursements de prêts · test SMTP ·
 *  avertissements de licence · préférences personnelles du tableau de bord · catalogue de compétences. */
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit, stockMove } = require('./core');
const { swallow } = require('./safe');

const r = express.Router();
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const D = c => `to_char(${c},'YYYY-MM-DD')`;

// ───────────────────────── Transferts de stock entre stations ─────────────────────────
// Envoi : sortie du stock de la station source (mouvement « transfert »). Réception dans la station destination : entrée.
// Annulation possible tant que rien n'est reçu : le stock source est restitué.
r.get('/stock/transfers/stations', need('transfer.manage', 'stock.adjust'), wrap(async (req, res) => {
  const rows = await q(`SELECT s.id, s.name FROM stations s JOIN user_stations us ON us.station_id = s.id
      WHERE us.user_id = $1 AND s.id <> $2 AND s.client_id = (SELECT client_id FROM stations WHERE id = $2) ORDER BY s.name`, [req.user.id, req.sid]);
  res.json(rows);
}));
r.get('/stock/transfers', need('transfer.manage', 'stock.adjust', 'report.view'), wrap(async (req, res) => {
  const rows = await q(`SELECT t.id, t.status, t.comment, t.sent_at, t.received_at, t.from_station_id, t.to_station_id, fs.name AS from_station, ts.name AS to_station,
        (t.from_station_id = $1) AS outgoing,
        COALESCE((SELECT json_agg(json_build_object('product', p.name, 'quantity', i.quantity::float8, 'to_product_id', i.to_product_id) ORDER BY i.id)
                    FROM stock_transfer_items i JOIN products p ON p.id = i.from_product_id WHERE i.transfer_id = t.id), '[]') AS items
      FROM stock_transfers t JOIN stations fs ON fs.id = t.from_station_id JOIN stations ts ON ts.id = t.to_station_id
     WHERE t.from_station_id = $1 OR t.to_station_id = $1 ORDER BY t.id DESC LIMIT 100`, [req.sid]);
  res.json(rows);
}));
r.post('/stock/transfers', need('transfer.manage'), body(z.object({
  to_station_id: z.number().int().positive(),
  items: z.array(z.object({ product_id: z.number().int().positive(), quantity: z.number().positive().max(1e9) })).min(1).max(40),
  comment: z.string().trim().max(300).optional().nullable()
}).strict()), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [ok] } = await c.query(`SELECT 1 FROM user_stations us JOIN stations d ON d.id = us.station_id JOIN stations s ON s.id = $3
        WHERE us.user_id = $1 AND us.station_id = $2 AND d.client_id = s.client_id AND d.id <> s.id`, [req.user.id, req.body.to_station_id, req.sid]);
    if (!ok && !req.user.is_global) throw new HttpError(403, 'Station de destination non autorisée (même compte client et accès requis)');
    const { rows: [t] } = await c.query(`INSERT INTO stock_transfers(from_station_id, to_station_id, status, comment, sent_by) VALUES ($1,$2,'envoye',$3,$4) RETURNING id`,
      [req.sid, req.body.to_station_id, req.body.comment || null, req.user.id]);
    for (const it of req.body.items) {
      const { rows: [p] } = await c.query('SELECT id, name FROM products WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [it.product_id, req.sid]);
      if (!p) throw new HttpError(404, 'Produit introuvable dans cette station');
      const { rows: [dst] } = await c.query('SELECT id FROM products WHERE station_id=$1 AND lower(name)=lower($2) AND deleted_at IS NULL AND active ORDER BY id LIMIT 1', [req.body.to_station_id, p.name]);
      if (!dst) throw new HttpError(409, `La station de destination n'a pas de produit « ${p.name} » : créez-le d'abord (même nom).`);
      await c.query('INSERT INTO stock_transfer_items(transfer_id, from_product_id, to_product_id, quantity) VALUES ($1,$2,$3,$4)', [t.id, p.id, dst.id, it.quantity]);
      await stockMove(c, { station: req.sid, product: p.id, kind: 'transfert', qty: -it.quantity, ref: ['stock_transfers', t.id], comment: 'Transfert N° ' + t.id + ' envoyé', by: req.user.id });
    }
    await audit(c, req, 'stock', `Transfert N° ${t.id} envoyé vers la station ${req.body.to_station_id}`, 'stock_transfers', t.id, null, req.body);
    return t;
  });
  res.status(201).json(out);
}));
r.post('/stock/transfers/:id/receive', need('transfer.manage'), wrap(async (req, res) => {
  await tx(async c => {
    const { rows: [t] } = await c.query('SELECT * FROM stock_transfers WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!t || t.to_station_id !== Number(req.sid)) throw new HttpError(404, 'Transfert introuvable pour cette station (changez de station si besoin)');
    if (t.status !== 'envoye') throw new HttpError(409, 'Ce transfert est déjà ' + (t.status === 'recu' ? 'reçu' : 'annulé'));
    const { rows: items } = await c.query('SELECT * FROM stock_transfer_items WHERE transfer_id=$1', [t.id]);
    for (const it of items) await stockMove(c, { station: req.sid, product: it.to_product_id, kind: 'transfert', qty: Number(it.quantity), ref: ['stock_transfers', t.id], comment: 'Transfert N° ' + t.id + ' reçu', by: req.user.id });
    await c.query(`UPDATE stock_transfers SET status='recu', received_by=$2, received_at=now() WHERE id=$1`, [t.id, req.user.id]);
    await audit(c, req, 'stock', `Transfert N° ${t.id} reçu`, 'stock_transfers', t.id, { status: 'envoye' }, { status: 'recu' });
  });
  res.json({ ok: true });
}));
r.post('/stock/transfers/:id/cancel', need('transfer.manage'), wrap(async (req, res) => {
  await tx(async c => {
    const { rows: [t] } = await c.query('SELECT * FROM stock_transfers WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!t || t.from_station_id !== Number(req.sid)) throw new HttpError(404, 'Transfert introuvable pour cette station');
    if (t.status !== 'envoye') throw new HttpError(409, 'Seul un transfert envoyé et non reçu peut être annulé');
    const { rows: items } = await c.query('SELECT * FROM stock_transfer_items WHERE transfer_id=$1', [t.id]);
    for (const it of items) await stockMove(c, { station: req.sid, product: it.from_product_id, kind: 'transfert', qty: Number(it.quantity), ref: ['stock_transfers', t.id], comment: 'Transfert N° ' + t.id + ' annulé : stock restitué', by: req.user.id });
    await c.query(`UPDATE stock_transfers SET status='annule' WHERE id=$1`, [t.id]);
    await audit(c, req, 'stock', `Transfert N° ${t.id} annulé`, 'stock_transfers', t.id, { status: 'envoye' }, { status: 'annule' });
  });
  res.json({ ok: true });
}));

// ───────────────────────── Historique des compteurs ─────────────────────────
// Fusionne : changements de produit d'un compteur (pump_counter_history) et corrections d'index (counter_events).
r.get('/pumps/counter-history', need('settings.edit', 'shift.open', 'report.view'), wrap(async (req, res) => {
  const rows = await q(`
    SELECT * FROM (
      SELECT 'produit' AS kind, h.valid_from AS at, pu.name AS pump, pc.counter_number, pr.name AS detail, NULL::float8 AS index_before, NULL::float8 AS index_after, NULL AS reason, u.login
        FROM pump_counter_history h JOIN pump_counters pc ON pc.id = h.counter_id JOIN pumps pu ON pu.id = pc.pump_id JOIN products pr ON pr.id = h.product_id
        LEFT JOIN users u ON u.id = h.changed_by WHERE pu.station_id = $1
      UNION ALL
      SELECT e.event_type, e.occurred_at, pu.name, pc.counter_number, NULL, e.index_before::float8, e.index_after::float8, e.reason, u.login
        FROM counter_events e JOIN pump_counters pc ON pc.id = e.counter_id JOIN pumps pu ON pu.id = pc.pump_id
        LEFT JOIN users u ON u.id = e.performed_by WHERE e.station_id = $1
    ) x ORDER BY at DESC LIMIT $2`, [req.sid, Math.min(+req.query.limit || 150, 400)]);
  res.json(rows);
}));

// ───────────────────────── Prêts : historique des remboursements ─────────────────────────
r.get('/finance/loans/:id/payments', need('money.manage', 'cash.manage', 'finance.view', 'report.view'), wrap(async (req, res) => {
  const rows = await q(`SELECT p.id, p.amount::float8 AS amount, p.paid_at, p.method, p.notes, u.login
      FROM personal_loan_payments p JOIN personal_loans l ON l.id = p.loan_id AND l.station_id = $2 LEFT JOIN users u ON u.id = p.created_by
     WHERE p.loan_id = $1 ORDER BY p.id DESC`, [req.params.id, req.sid]);
  res.json(rows);
}));

// ───────────────────────── Test SMTP (e-mails de paie, rapports) ─────────────────────────
r.post('/admin/smtp/test', need('settings.edit', 'hr.settings'), body(z.object({ to: z.string().trim().email().max(200) }).strict()), wrap(async (req, res) => {
  const t0 = Date.now(); let ok = false, diag = '';
  try {
    const mode = process.env.MAIL_MODE === 'json' ? 'simulation (MAIL_MODE=json : aucun e-mail réel)' : (process.env.SMTP_HOST ? 'SMTP ' + process.env.SMTP_HOST : 'aucun serveur SMTP configuré (SMTP_HOST)');
    if (!process.env.SMTP_HOST && process.env.MAIL_MODE !== 'json') throw new Error(mode);
    await Promise.race([require('./mailer').sendMail({ to: req.body.to, subject: 'Test e-mail Manager PRO', text: 'Ce message confirme que l\'envoi d\'e-mails fonctionne.' }), new Promise((_, rej) => setTimeout(() => rej(new Error('Délai dépassé (15 s)')), 15000))]);
    ok = true; diag = `Envoyé à ${req.body.to} en ${Date.now() - t0} ms — ${mode}`;
  } catch (e) { diag = String(e.message || e).slice(0, 400); }
  await pool.query('INSERT INTO smtp_diagnostics(station_id, tested_by, success, diagnostic) VALUES ($1,$2,$3,$4)', [req.sid, req.user.id, ok, diag]);
  res.json({ success: ok, diagnostic: diag });
}));
r.get('/admin/smtp/diagnostics', need('settings.edit', 'hr.settings'), wrap(async (req, res) => {
  res.json(await q(`SELECT d.id, d.success, d.diagnostic, d.created_at, u.login FROM smtp_diagnostics d LEFT JOIN users u ON u.id = d.tested_by WHERE d.station_id = $1 ORDER BY d.id DESC LIMIT 20`, [req.sid]));
}));

// ───────────────────────── Avertissements de licence (journal) ─────────────────────────
r.get('/license/warnings', need('settings.edit', 'user.manage'), wrap(async (req, res) => {
  const [st] = await q('SELECT client_id FROM stations WHERE id=$1', [req.sid]);
  if (!st || !st.client_id) return res.json({ contract: null, warnings: [] });
  const [contract] = await q(`SELECT id, status, ${D('end_date')} AS end_date, (end_date - CURRENT_DATE) AS days_left FROM client_contracts WHERE client_id=$1 ORDER BY (status='actif') DESC, id DESC LIMIT 1`, [st.client_id]);
  const warnings = await q('SELECT threshold_days, warned_at, channel FROM license_warning_log WHERE client_id=$1 ORDER BY warned_at DESC LIMIT 30', [st.client_id]);
  res.json({ contract: contract || null, warnings });
}));
/** Appelé par le planificateur d'alertes : une trace par seuil (30, 15, 7, 3, 1 j) et par échéance. Retourne true si c'est un nouvel avertissement. */
async function logLicenseWarning(clientId, daysLeft, channel = 'messagerie') {
  try {
    const thresholds = [30, 15, 7, 3, 1].filter(t => daysLeft <= t);
    if (!thresholds.length) return false;
    const th = Math.min(...thresholds);
    const ins = await pool.query(`INSERT INTO license_warning_log(client_id, threshold_days, channel) VALUES ($1,$2,$3)
      ON CONFLICT (client_id, threshold_days, channel) DO UPDATE SET warned_at = now() WHERE license_warning_log.warned_at < now() - interval '90 days' RETURNING id`, [clientId, th, channel]);
    return ins.rowCount > 0;
  } catch (e) { swallow('gaps:licence', false)(e); return false; }
}

// ───────────────────────── Tableau de bord : préférences personnelles ─────────────────────────
// Un utilisateur peut MASQUER des éléments que la configuration du compte client affiche ; il ne peut rien afficher de plus.
r.get('/dashboard/my-prefs', wrap(async (req, res) => {
  const [p] = await q('SELECT config FROM dashboard_widget_prefs WHERE user_id=$1 AND station_id IS NOT DISTINCT FROM $2', [req.user.id, req.sid]);
  res.json(p ? p.config : { cards: {}, charts: {}, sections: {} });
}));
r.put('/dashboard/my-prefs', wrap(async (req, res) => {
  const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => /^[a-z_]{1,40}$/.test(k) && v === false).slice(0, 60));
  const cfg = { cards: clean(req.body.cards), charts: clean(req.body.charts), sections: clean(req.body.sections) };
  const [st] = await q('SELECT client_id FROM stations WHERE id=$1', [req.sid]);
  await pool.query(`INSERT INTO dashboard_widget_prefs(client_id, station_id, user_id, config) VALUES ($1,$2,$3,$4::jsonb)
    ON CONFLICT (user_id, station_id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`, [st ? st.client_id : null, req.sid, req.user.id, JSON.stringify(cfg)]);
  res.json(cfg);
}));
async function userDashboardPrefs(userId, sid) {
  try { const { rows: [p] } = await pool.query('SELECT config FROM dashboard_widget_prefs WHERE user_id=$1 AND station_id IS NOT DISTINCT FROM $2', [userId, sid]); return p ? p.config : null; }
  catch (e) { return swallow('gaps:prefs', null)(e); }
}

// ───────────────────────── Compétences : ajout au catalogue ─────────────────────────
r.post('/hr/v2/skills', need('hr.skills.manage', 'hr.manage'), body(z.object({ label: z.string().trim().min(2).max(80) }).strict()), wrap(async (req, res) => {
  const code = req.body.label.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'SKILL';
  const { rows: [x] } = await pool.query(`INSERT INTO hr_skills(station_id, code, label) VALUES ($1,$2,$3) RETURNING id`, [req.sid, code + '_' + Date.now().toString(36).slice(-4), req.body.label]);
  res.status(201).json({ id: x.id });
}));
// Participants d'une formation (avec résultat)
r.get('/hr/v2/trainings/:id/participants', need('hr.training.view', 'hr.view', 'hr.manage'), wrap(async (req, res) => {
  res.json(await q(`SELECT p.id, p.employee_id, e.first_name || ' ' || e.last_name AS employee, p.result, ${D('p.expires_on')} AS expires_on
      FROM hr_training_participants p JOIN hr_trainings t ON t.id = p.training_id AND t.station_id = $2 JOIN employees e ON e.id = p.employee_id WHERE p.training_id = $1 ORDER BY e.last_name`, [req.params.id, req.sid]));
}));
r.post('/hr/v2/trainings/:id/participants/:pid/result', need('hr.training.manage', 'hr.manage'), body(z.object({
  result: z.enum(['present', 'reussi', 'echec', 'absent']), expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
}).strict()), wrap(async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE hr_training_participants p SET result=$3, expires_on=$4 FROM hr_trainings t WHERE p.id=$2 AND p.training_id=$1 AND t.id=p.training_id AND t.station_id=$5`,
    [req.params.id, req.params.pid, req.body.result, req.body.expires_on || null, req.sid]);
  if (!rowCount) throw new HttpError(404, 'Participant introuvable');
  res.json({ ok: true });
}));

module.exports = r;
module.exports.logLicenseWarning = logLicenseWarning;
module.exports.userDashboardPrefs = userDashboardPrefs;
