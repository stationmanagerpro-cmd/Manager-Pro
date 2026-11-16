'use strict';
/** Outils du gérant : « ma journée », objectifs de vente, classement des pompistes, résumé hebdomadaire, justificatifs photo des dépenses.
 *  Toutes les lectures sont limitées à la station courante (req.sid). */
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { swallow } = require('./safe');
const { progress, rankEmployees } = require('./goals_logic');
const r = express.Router();
const num = v => Number(v) || 0;

/** Ventes d'une période sur une station : carburant (compteurs des quarts clôturés dans la période) + produits (ventes valides). */
async function periodSales(q, sid, from, to) {
  const { rows: [f] } = await q.query(
    `SELECT COALESCE(SUM(mr.amount), 0) AS amount, COALESCE(SUM(mr.liters), 0) AS liters FROM meter_readings mr JOIN shifts sh ON sh.id = mr.shift_id
      WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at >= $2 AND sh.closed_at < $3`, [sid, from, to]);
  const { rows: [p] } = await q.query(
    `SELECT COALESCE(SUM(total), 0) AS amount FROM sales WHERE station_id = $1 AND status = 'valide' AND kind = 'produits' AND sold_at >= $2 AND sold_at < $3`, [sid, from, to]);
  return { fuel_amount: num(f.amount), liters: num(f.liters), shop_amount: num(p.amount), amount: num(f.amount) + num(p.amount) };
}
const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

// ---------- 5. Ma journée ----------
r.get('/me/today', need('report.view', 'shift.close', 'finance.view'), wrap(async (req, res) => {
  const now = new Date(), day0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), day1 = addDays(day0, 1);
  const [sales, cash, shifts, tanks, notes, goals] = await Promise.all([
    periodSales(pool, req.sid, day0, day1),
    pool.query('SELECT COALESCE(SUM(balance), 0) AS balance FROM cash_registers WHERE station_id = $1 AND active', [req.sid]),
    pool.query("SELECT id, number, kind, opened_at FROM shifts WHERE station_id = $1 AND status = 'ouvert' ORDER BY opened_at", [req.sid]),
    pool.query(`SELECT t.id, t.name, p.name AS product, t.alert_threshold, t.capacity_liters, m.quantity FROM tanks t JOIN products p ON p.id = t.product_id
                LEFT JOIN LATERAL (SELECT quantity FROM tank_measurements WHERE tank_id = t.id ORDER BY measured_at DESC, id DESC LIMIT 1) m ON TRUE
                WHERE t.station_id = $1 AND t.active AND t.deleted_at IS NULL ORDER BY p.name, t.name`, [req.sid]),
    pool.query('SELECT id, level, kind, message, created_at FROM notifications WHERE station_id = $1 AND read_at IS NULL ORDER BY id DESC LIMIT 5', [req.sid]),
    goalsProgress(req.sid, now)
  ]);
  const low = tanks.rows.filter(t => t.quantity != null && num(t.alert_threshold) > 0 && num(t.quantity) <= num(t.alert_threshold))
    .map(t => ({ id: t.id, name: t.name, product: t.product, quantity: num(t.quantity), threshold: num(t.alert_threshold), fill_pct: t.capacity_liters > 0 ? Math.round(num(t.quantity) / num(t.capacity_liters) * 100) : null }));
  const { rows: [nn] } = await pool.query('SELECT COUNT(*)::int AS n FROM notifications WHERE station_id = $1 AND read_at IS NULL', [req.sid]);
  res.json({ day: day0.toISOString().slice(0, 10), sales, cash_balance: num(cash.rows[0].balance), open_shifts: shifts.rows, low_tanks: low, tanks_without_measure: tanks.rows.filter(t => t.quantity == null).length,
    alerts: notes.rows, unread_alerts: nn.n, goals,
    note: 'Ventes du jour = carburant des quarts clôturés aujourd\'hui + ventes de produits valides ; le carburant d\'un quart encore ouvert apparaît à sa clôture.' });
}));

// ---------- 6. Objectifs de vente ----------
async function goalsProgress(sid, now = new Date()) {
  const m0 = monthStart(now), m1 = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth() + 1, 1)), dim = Math.round((m1 - m0) / 864e5);
  const { rows: goals } = await pool.query('SELECT id, metric, target FROM sales_goals WHERE station_id = $1 AND month = $2::date', [sid, m0.toISOString().slice(0, 10)]);
  if (!goals.length) return [];
  const s = await periodSales(pool, sid, m0, m1);
  return goals.map(g => ({ id: g.id, metric: g.metric, ...progress({ target: g.target, achieved: g.metric === 'liters' ? s.liters : s.amount, dayOfMonth: now.getUTCDate(), daysInMonth: dim }) }));
}
r.get('/goals', need('report.view', 'shift.close', 'finance.view'), wrap(async (req, res) => res.json({ month: monthStart().toISOString().slice(0, 7), goals: await goalsProgress(req.sid) })));
r.put('/goals', need('settings.edit'), body(z.object({ metric: z.enum(['liters', 'amount']), target: z.number().positive().max(1e12) })), wrap(async (req, res) => {
  const m = monthStart().toISOString().slice(0, 10);
  const { rows: [g] } = await pool.query(
    `INSERT INTO sales_goals(station_id, month, metric, target, created_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (station_id, month, metric) DO UPDATE SET target = EXCLUDED.target, updated_at = now() RETURNING id, metric, target`, [req.sid, m, req.body.metric, req.body.target, req.user.id]);
  await pool.query('DELETE FROM sales_goal_alerts WHERE goal_id = $1', [g.id]);       // nouvel objectif : les alertes repartent de zéro
  await audit(pool, req, 'objectifs', `Objectif ${req.body.metric === 'liters' ? 'litres' : 'chiffre d\'affaires'} du mois : ${req.body.target}`, 'sales_goals', g.id);
  res.json({ ok: true, goals: await goalsProgress(req.sid) });
}));
r.delete('/goals/:metric', need('settings.edit'), wrap(async (req, res) => {
  if (!['liters', 'amount'].includes(req.params.metric)) throw new HttpError(400, 'Métrique inconnue');
  await pool.query('DELETE FROM sales_goals WHERE station_id = $1 AND month = $2::date AND metric = $3', [req.sid, monthStart().toISOString().slice(0, 10), req.params.metric]);
  res.json({ ok: true });
}));

// ---------- 7. Classement des pompistes ----------
r.get('/leaderboard/employees', need('hr.view', 'hr.gaps', 'report.view'), wrap(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 7), 365), from = addDays(new Date(), -days);
  const { rows } = await pool.query(
    `WITH shared AS (
       SELECT sep.employee_id, mr.shift_id, mr.pump_id, mr.amount / COUNT(*) OVER (PARTITION BY sep.shift_id, sep.pump_id) AS part
         FROM meter_readings mr JOIN shifts sh ON sh.id = mr.shift_id AND sh.status = 'ferme' AND sh.station_id = $1 AND sh.closed_at >= $2
         JOIN shift_employee_pumps sep ON sep.shift_id = mr.shift_id AND sep.pump_id = mr.pump_id)
     SELECT e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee,
            COALESCE((SELECT SUM(part) FROM shared WHERE shared.employee_id = e.id), 0)
          + COALESCE((SELECT SUM(x.total) FROM sales x WHERE x.station_id = $1 AND x.employee_id = e.id AND x.status = 'valide' AND x.kind = 'produits' AND x.sold_at >= $2), 0) AS sales,
            (SELECT COUNT(DISTINCT se.shift_id) FROM shift_employees se JOIN shifts sh ON sh.id = se.shift_id WHERE se.employee_id = e.id AND sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at >= $2)::int AS shifts_worked,
            COALESCE((SELECT SUM(g.amount) FROM employee_gaps g WHERE g.employee_id = e.id AND g.station_id = $1 AND g.kind = 'caisse' AND g.created_at >= $2), 0) AS cash_gap_total,
            (SELECT COUNT(DISTINCT g.shift_id) FROM employee_gaps g WHERE g.employee_id = e.id AND g.station_id = $1 AND g.created_at >= $2 AND ABS(g.amount) > 0)::int AS gap_shifts,
            (SELECT COUNT(*) FROM employee_gaps g WHERE g.employee_id = e.id AND g.station_id = $1 AND g.kind <> 'caisse' AND g.created_at >= $2 AND ABS(g.amount) > 0)::int AS stock_gaps
       FROM employees e WHERE e.station_id = $1 AND e.status = 'actif' ORDER BY e.id`, [req.sid, from]);
  res.json({ days, employees: rankEmployees(rows.filter(x => num(x.shifts_worked) > 0 || num(x.sales) > 0)),
    note: 'Ventes carburant partagées à parts égales entre les employés d\'une même pompe sur un quart ; ventes de produits au nom de l\'employé. Signal d\'aide à la décision : aucune sanction ou prime automatique.' });
}));

// ---------- 8. Résumé hebdomadaire (chaque lundi) ----------
async function weeklySummary(sid, weekStart) {
  const w1 = addDays(weekStart, 7), prev0 = addDays(weekStart, -7);
  const [cur, prev] = await Promise.all([periodSales(pool, sid, weekStart, w1), periodSales(pool, sid, prev0, weekStart)]);
  const { rows: [g] } = await pool.query(`SELECT COALESCE(SUM(cash_gap), 0) AS gap, COUNT(*)::int AS shifts FROM shifts WHERE station_id = $1 AND status = 'ferme' AND closed_at >= $2 AND closed_at < $3`, [sid, weekStart, w1]);
  const { rows: top } = await pool.query(
    `SELECT e.first_name || ' ' || e.last_name AS employee, SUM(x.total) AS sales FROM sales x JOIN employees e ON e.id = x.employee_id
      WHERE x.station_id = $1 AND x.status = 'valide' AND x.sold_at >= $2 AND x.sold_at < $3 GROUP BY e.id ORDER BY SUM(x.total) DESC LIMIT 1`, [sid, weekStart, w1]);
  const evo = prev.amount > 0 ? Math.round((cur.amount - prev.amount) / prev.amount * 1000) / 10 : null;
  return { week_start: weekStart.toISOString().slice(0, 10), week_end: addDays(w1, -1).toISOString().slice(0, 10), sales: cur, previous_amount: prev.amount, evolution_pct: evo,
    cash_gap: num(g.gap), shifts_closed: g.shifts, top_seller: top[0] ? { employee: top[0].employee, sales: num(top[0].sales) } : null };
}
const mondayOf = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); return addDays(x, -((x.getUTCDay() + 6) % 7)); };
const money = n => Math.round(n).toLocaleString('fr-FR');
function summaryText(s, name) {
  const evo = s.evolution_pct == null ? '' : ` (${s.evolution_pct >= 0 ? '+' : ''}${s.evolution_pct} % vs semaine précédente)`;
  return `Résumé de la semaine du ${s.week_start} au ${s.week_end}${name ? ' — ' + name : ''} : ventes ${money(s.sales.amount)}${evo}, ${money(s.sales.liters)} L de carburant, ` +
    `${s.shifts_closed} quart(s) clôturé(s), écart de caisse cumulé ${money(s.cash_gap)}` + (s.top_seller ? `, meilleur vendeur : ${s.top_seller.employee}` : '') + '.';
}
r.get('/reports/weekly-summary', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const ws = req.query.week_start && /^\d{4}-\d{2}-\d{2}$/.test(req.query.week_start) ? mondayOf(new Date(req.query.week_start + 'T00:00:00Z')) : addDays(mondayOf(new Date()), -7);
  const s = await weeklySummary(req.sid, ws); res.json({ ...s, text: summaryText(s) });
}));

// ---------- Planificateur : résumé du lundi + alertes d'objectifs ----------
async function runDaily(now = new Date()) {
  let sent = 0;
  const { rows: stations } = await pool.query("SELECT s.id, s.name FROM stations s JOIN clients c ON c.id = s.client_id WHERE s.active AND c.status = 'actif'").catch(swallow('manager_tools:stations', { rows: [] }));
  for (const st of stations) {
    if (now.getUTCDay() === 1) {                                         // lundi : semaine précédente, une fois par station
      const ws = addDays(mondayOf(now), -7);
      const { rowCount } = await pool.query('INSERT INTO weekly_summaries_sent(station_id, week_start) VALUES ($1,$2) ON CONFLICT DO NOTHING', [st.id, ws.toISOString().slice(0, 10)]);
      if (rowCount) { const s = await weeklySummary(st.id, ws); await pool.query("INSERT INTO notifications(station_id, level, kind, message) VALUES ($1,'info','resume_hebdo',$2)", [st.id, summaryText(s, st.name)]); sent++; }
    }
    for (const g of await goalsProgress(st.id, now)) {
      if (g.status !== 'atteint' && g.status !== 'en_retard') continue;
      const { rowCount } = await pool.query('INSERT INTO sales_goal_alerts(goal_id, state) VALUES ($1,$2) ON CONFLICT DO NOTHING', [g.id, g.status]);
      if (!rowCount) continue;
      const unit = g.metric === 'liters' ? 'L' : '';
      const txt = g.status === 'atteint' ? `🎯 Objectif du mois atteint : ${money(g.achieved)} ${unit} sur ${money(g.target)} ${unit}.`.replace('  ', ' ')
        : `⚠ Objectif du mois en retard : ${g.pct} % réalisé alors que ${g.expected_pct} % du mois est écoulé (projection ${money(g.projected)} ${unit} pour ${money(g.target)} ${unit}).`.replace('  ', ' ');
      await pool.query("INSERT INTO notifications(station_id, level, kind, message) VALUES ($1,$2,'objectif_vente',$3)", [st.id, g.status === 'atteint' ? 'info' : 'warning', txt]); sent++;
    }
  }
  return sent;
}
function startScheduler() {
  const tick = () => runDaily().catch(e => console.warn('[outils-gérant]', e.message));
  const t0 = setTimeout(tick, 3 * 60 * 1000), t1 = setInterval(tick, 6 * 3600 * 1000);
  if (t0.unref) t0.unref(); if (t1.unref) t1.unref();
}

// ---------- 9. Justificatif photo d'une dépense ----------
const MAX_RECEIPT = 1.5 * 1024 * 1024, MAX_PER_EXPENSE = 4;
r.post('/expenses/:id/receipt', need('expense.create'), body(z.object({
  filename: z.string().trim().min(1).max(120), mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']), data: z.string().min(8).max(2200000)
})), wrap(async (req, res) => {
  const b = req.body, bytes = Buffer.from(b.data.replace(/^data:[^,]+,/, ''), 'base64');
  if (!bytes.length) throw new HttpError(400, 'Fichier vide');
  if (bytes.length > MAX_RECEIPT) throw new HttpError(413, 'Fichier trop volumineux (1,5 Mo maximum) : réduisez la photo.');
  const magic = bytes.subarray(0, 4).toString('hex');
  const ok = (b.mime === 'image/jpeg' && magic.startsWith('ffd8ff')) || (b.mime === 'image/png' && magic === '89504e47') || (b.mime === 'image/webp' && bytes.subarray(0, 4).toString() === 'RIFF') || (b.mime === 'application/pdf' && bytes.subarray(0, 4).toString() === '%PDF');
  if (!ok) throw new HttpError(400, 'Le contenu du fichier ne correspond pas à son type.');
  const out = await tx(async c => {
    const { rows: [e] } = await c.query('SELECT id, created_by FROM expenses WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    if (e.created_by !== req.user.id && !req.user.perms.has('finance.view')) throw new HttpError(403, 'Seul l\'auteur de la dépense ou un responsable peut ajouter le justificatif.');
    const { rows: [n] } = await c.query('SELECT COUNT(*)::int AS n FROM expense_receipts WHERE expense_id = $1', [e.id]);
    if (n.n >= MAX_PER_EXPENSE) throw new HttpError(409, `Maximum ${MAX_PER_EXPENSE} justificatifs par dépense.`);
    const name = b.filename.replace(/[^\w.\- ]+/g, '_');
    const { rows: [row] } = await c.query('INSERT INTO expense_receipts(station_id, expense_id, filename, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, filename, mime, size', [req.sid, e.id, name, b.mime, bytes.length, bytes, req.user.id]);
    await audit(c, req, 'dépenses', 'Justificatif ajouté à la dépense ' + e.id, 'expenses', e.id, null, { fichier: name, taille: bytes.length });
    return row;
  });
  res.status(201).json(out);
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

module.exports = { r, periodSales, goalsProgress, weeklySummary, summaryText, runDaily, startScheduler, mondayOf };
