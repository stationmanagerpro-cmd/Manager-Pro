'use strict';
/** Compléments « gérant » (hors « Ma journée » déjà en place) :
 *  - résumé hebdomadaire des ventes de la station (chaque lundi, notification + lecture à la demande) ;
 *  - justificatifs photo rattachés à une dépense.
 *  Lectures limitées à la station courante (req.sid). Montants agrégés uniquement. */
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { swallow } = require('./safe');
const r = express.Router();
const num = v => Number(v) || 0;
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const isoDay = d => d.toISOString().slice(0, 10);
/** Lundi (UTC) de la semaine de la date donnée. */
function mondayOf(d) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); return addDays(x, -((x.getUTCDay() + 6) % 7)); }
const money = n => Math.round(num(n)).toLocaleString('fr-FR');

/** Ventes de la semaine [from, to) : carburant (sales.kind = 'carburant') et produits (kind ≠ 'carburant'), valides seulement. */
async function weekTotals(sid, from, to) {
  const { rows: [t] } = await pool.query(
    `SELECT COALESCE(SUM(sa.total) FILTER (WHERE sa.kind = 'carburant'), 0)::float8 AS fuel_amount,
            COALESCE(SUM(sa.total) FILTER (WHERE sa.kind <> 'carburant'), 0)::float8 AS shop_amount,
            COUNT(*)::int AS sales_count
       FROM sales sa WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.sold_at >= $2 AND sa.sold_at < $3`, [sid, from, to]);
  const { rows: [l] } = await pool.query(
    `SELECT COALESCE(SUM(d.quantity), 0)::float8 AS liters FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
      WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.kind = 'carburant' AND sa.sold_at >= $2 AND sa.sold_at < $3`, [sid, from, to]);
  const { rows: [g] } = await pool.query(
    `SELECT COALESCE(SUM(cash_gap), 0)::float8 AS cash_gap, COUNT(*)::int AS shifts_closed FROM shifts
      WHERE station_id = $1 AND status = 'ferme' AND closed_at >= $2 AND closed_at < $3`, [sid, from, to]);
  const { rows: top } = await pool.query(
    `SELECT COALESCE(NULLIF(trim(e.first_name || ' ' || e.last_name), ''), 'Employé') AS name, SUM(sa.total)::float8 AS amount
       FROM sales sa JOIN employees e ON e.id = sa.employee_id
      WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.sold_at >= $2 AND sa.sold_at < $3
      GROUP BY e.id, e.first_name, e.last_name ORDER BY SUM(sa.total) DESC LIMIT 1`, [sid, from, to]);
  const amount = num(t.fuel_amount) + num(t.shop_amount);
  return { fuel_amount: num(t.fuel_amount), shop_amount: num(t.shop_amount), amount, liters: num(l.liters), sales_count: t.sales_count,
    cash_gap: num(g.cash_gap), shifts_closed: g.shifts_closed, top_seller: top[0] ? { name: top[0].name, amount: num(top[0].amount) } : null };
}

/** Résumé d'une semaine complète avec comparaison à la semaine précédente. */
async function weeklySummary(sid, weekStart) {
  const next = addDays(weekStart, 7), prevStart = addDays(weekStart, -7);
  const [cur, prev] = await Promise.all([weekTotals(sid, weekStart, next), weekTotals(sid, prevStart, weekStart)]);
  const evolution = prev.amount > 0 ? Math.round((cur.amount - prev.amount) / prev.amount * 1000) / 10 : null;
  return { week_start: isoDay(weekStart), week_end: isoDay(addDays(next, -1)), ...cur, previous_amount: prev.amount, evolution_pct: evolution };
}
function summaryText(s, stationName) {
  const evo = s.evolution_pct == null ? '' : ` (${s.evolution_pct >= 0 ? '+' : ''}${s.evolution_pct} % vs semaine précédente)`;
  return `Résumé de la semaine du ${s.week_start} au ${s.week_end}${stationName ? ' — ' + stationName : ''} : ventes ${money(s.amount)}${evo}, ` +
    `${money(s.liters)} L de carburant, ${s.shifts_closed} quart(s) clôturé(s), écart de caisse cumulé ${money(s.cash_gap)}` +
    (s.top_seller ? `, meilleur vendeur : ${s.top_seller.name}` : '') + '.';
}

r.get('/reports/weekly-summary', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const ref = /^\d{4}-\d{2}-\d{2}$/.test(req.query.week_start || '') ? new Date(req.query.week_start + 'T00:00:00Z') : addDays(new Date(), -7);
  const s = await weeklySummary(req.sid, mondayOf(ref));
  res.json({ ...s, text: summaryText(s) });
}));

/** Chaque lundi : une notification « résumé hebdomadaire » par station pour la semaine écoulée (une seule fois, grâce à weekly_summaries_sent). */
async function runWeekly(now = new Date()) {
  if (now.getUTCDay() !== 1) return 0;
  const { rows: stations } = await pool.query(
    "SELECT s.id, s.name FROM stations s JOIN clients c ON c.id = s.client_id WHERE s.active = TRUE AND c.status = 'actif'")
    .catch(swallow('manager_extras:stations', { rows: [] }));
  const ws = addDays(mondayOf(now), -7);
  let sent = 0;
  for (const st of stations) {
    const { rowCount } = await pool.query('INSERT INTO weekly_summaries_sent(station_id, week_start) VALUES ($1,$2) ON CONFLICT DO NOTHING', [st.id, isoDay(ws)]);
    if (!rowCount) continue;
    const s = await weeklySummary(st.id, ws);
    await pool.query("INSERT INTO notifications(station_id, level, kind, message) VALUES ($1,'info','resume_hebdo',$2)", [st.id, summaryText(s, st.name)]);
    sent++;
  }
  return sent;
}
function startScheduler() {
  const tick = () => runWeekly().catch(e => console.warn('[résumé hebdo]', e.message));
  const t0 = setTimeout(tick, 4 * 60 * 1000), t1 = setInterval(tick, 6 * 3600 * 1000);
  if (t0.unref) t0.unref(); if (t1.unref) t1.unref();
}

// ---------- Justificatifs photo d'une dépense ----------
const MAX_RECEIPT = 1.5 * 1024 * 1024, MAX_PER_EXPENSE = 4;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
function magicOk(mime, bytes) {
  const head = bytes.subarray(0, 4), hex = head.toString('hex');
  return (mime === 'image/jpeg' && hex.startsWith('ffd8ff')) || (mime === 'image/png' && hex === '89504e47') ||
    (mime === 'image/webp' && head.toString() === 'RIFF') || (mime === 'application/pdf' && head.toString() === '%PDF');
}
r.post('/expenses/:id/receipts', need('expense.create'), body(z.object({
  filename: z.string().trim().min(1).max(120), mime: z.enum(MIMES), data: z.string().min(8).max(2200000)
})), wrap(async (req, res) => {
  const b = req.body, bytes = Buffer.from(b.data.replace(/^data:[^,]+,/, ''), 'base64');
  if (!bytes.length) throw new HttpError(400, 'Fichier vide');
  if (bytes.length > MAX_RECEIPT) throw new HttpError(413, 'Fichier trop volumineux (1,5 Mo maximum) : réduisez la photo.');
  if (!magicOk(b.mime, bytes)) throw new HttpError(400, 'Le contenu du fichier ne correspond pas à son type.');
  const name = b.filename.replace(/[^\w.\- ]+/g, '_');
  const row = await tx(async c => {
    const { rows: [e] } = await c.query('SELECT id, created_by FROM expenses WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    // Seul l'auteur de la dépense peut joindre un justificatif (les responsables gardent la consultation).
    if (e.created_by !== req.user.id) throw new HttpError(403, 'Seul l\'auteur de la dépense peut joindre un justificatif.');
    const { rows: [n] } = await c.query('SELECT COUNT(*)::int AS n FROM expense_receipts WHERE expense_id = $1', [e.id]);
    if (n.n >= MAX_PER_EXPENSE) throw new HttpError(409, `Maximum ${MAX_PER_EXPENSE} justificatifs par dépense.`);
    const { rows: [ins] } = await c.query(
      'INSERT INTO expense_receipts(station_id, expense_id, filename, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename, mime, size, created_at',
      [req.sid, e.id, name, b.mime, bytes.length, bytes, req.user.id]);
    await audit(c, req, 'dépenses', 'Justificatif ajouté à la dépense ' + e.id, 'expenses', e.id, null, { fichier: name, taille: bytes.length });
    return ins;
  });
  res.status(201).json(row);
}));
r.get('/expenses/:id/receipts', need('expense.create', 'report.view', 'finance.view'), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, filename, mime, size, created_at FROM expense_receipts WHERE expense_id = $1 AND station_id = $2 ORDER BY id', [req.params.id, req.sid]);
  res.json(rows);
}));
r.get('/expenses/:id/receipts/:rid', need('expense.create', 'report.view', 'finance.view'), wrap(async (req, res) => {
  const { rows: [a] } = await pool.query('SELECT filename, mime, data FROM expense_receipts WHERE id = $1 AND expense_id = $2 AND station_id = $3', [req.params.rid, req.params.id, req.sid]);
  if (!a) throw new HttpError(404, 'Justificatif introuvable');
  res.set('Content-Type', a.mime).set('Content-Disposition', `inline; filename="${a.filename.replace(/[^\w.-]/g, '_')}"`).set('X-Content-Type-Options', 'nosniff').send(a.data);
}));

module.exports = { r, weeklySummary, summaryText, runWeekly, startScheduler, mondayOf, magicOk };
