'use strict';
/** « Ma journée » : synthèse du jour pour le gérant, objectif de ventes du mois, classement des employés. */
const express = require('express');
const { z } = require('zod');
const { pool, wrap, body, need, audit, setting } = require('./core');
const { swallow } = require('./safe');
const extra = require('./alerts_extra');

const r = express.Router();
const rows = (sql, p) => pool.query(sql, p).then(x => x.rows);

/** Avancement d'un objectif mensuel : pourcentage, rythme attendu à ce jour, statut. */
function progress(done, target, day, daysInMonth) {
  if (!(target > 0)) return null;
  const pct = Math.round(done / target * 100);
  const expectedPct = Math.round(day / daysInMonth * 100);
  const status = pct >= 100 ? 'atteint' : pct >= expectedPct ? 'en_avance' : pct >= expectedPct - 10 ? 'dans_le_rythme' : 'en_retard';
  return { pct, expected_pct: expectedPct, status, remaining: Math.max(0, target - done) };
}

r.get('/my-day', need('report.view', 'shift.close'), wrap(async (req, res) => {
  const sid = req.sid, now = new Date();
  const today = now.toISOString().slice(0, 10);
  const day = now.getUTCDate(), dim = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const [summary, openShifts, tanks, month, ranking, target] = await Promise.all([
    extra.buildDailySummary(pool, sid, today).catch(swallow('my_day:summary', { totals: { liters: 0, amount: 0 }, pumps: [] })),
    rows(`SELECT s.id, s.number, s.kind, s.opened_at, COALESCE(NULLIF(trim(e.first_name || ' ' || e.last_name), ''), u.login) AS manager
            FROM shifts s JOIN users u ON u.id = s.manager_id LEFT JOIN employees e ON e.user_id = u.id
           WHERE s.station_id = $1 AND s.status = 'ouvert' ORDER BY s.opened_at`, [sid]),
    extra.tankRunouts(pool, sid).catch(swallow('my_day:tanks', [])),
    rows(`SELECT COALESCE(SUM(sa.total),0)::float8 AS amount,
                 COALESCE(SUM((SELECT SUM(d.quantity) FROM sale_details d WHERE d.sale_id = sa.id)) FILTER (WHERE sa.kind = 'carburant'),0)::float8 AS liters
            FROM sales sa WHERE sa.station_id = $1 AND sa.status = 'valide' AND date_trunc('month', sa.sold_at) = date_trunc('month', now())`, [sid]),
    rows(`SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.position,
                 COUNT(sa.id)::int AS sales_count, COALESCE(SUM(sa.total),0)::float8 AS amount,
                 (SELECT COUNT(*)::int FROM shifts s WHERE s.station_id = $1 AND s.manager_id = e.user_id AND s.status = 'ferme'
                     AND COALESCE(s.cash_gap,0) <> 0 AND s.closed_at >= now() - interval '30 days') AS gap_shifts,
                 (SELECT COALESCE(SUM(s.cash_gap),0)::float8 FROM shifts s WHERE s.station_id = $1 AND s.manager_id = e.user_id AND s.status = 'ferme'
                     AND s.closed_at >= now() - interval '30 days') AS gap_total
            FROM employees e LEFT JOIN sales sa ON sa.employee_id = e.id AND sa.status = 'valide' AND sa.sold_at >= now() - interval '30 days'
           WHERE e.station_id = $1 GROUP BY e.id HAVING COUNT(sa.id) > 0 ORDER BY amount DESC LIMIT 20`, [sid]),
    setting(pool, sid, 'sales_target_month', null)
  ]);
  const m = month[0] || { amount: 0, liters: 0 };
  const t = target && Number(target.value) > 0 ? { type: target.type === 'liters' ? 'liters' : 'amount', value: Number(target.value) } : null;
  const tank_low = tanks.filter(x => x.days != null && x.days <= 3);
  res.json({
    date: today, today: { amount: summary.totals.amount, liters: summary.totals.liters, pumps: summary.pumps },
    open_shifts: openShifts, tanks: tanks, tank_low,
    month: { amount: m.amount, liters: m.liters, day, days_in_month: dim },
    target: t && { ...t, done: t.type === 'liters' ? m.liters : m.amount, ...progress(t.type === 'liters' ? m.liters : m.amount, t.value, day, dim) },
    ranking
  });
}));

r.put('/my-day/target', need('report.view', 'shift.close'), body(z.object({
  type: z.enum(['amount', 'liters']), value: z.number().min(0).max(1e12)
})), wrap(async (req, res) => {
  const { type, value } = req.body;
  if (value > 0) {
    await pool.query(`INSERT INTO settings(station_id, key, value) VALUES ($1, 'sales_target_month', $2::jsonb)
                      ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`, [req.sid, JSON.stringify({ type, value })]);
  } else {
    await pool.query(`DELETE FROM settings WHERE station_id = $1 AND key = 'sales_target_month'`, [req.sid]);
  }
  await audit(pool, req, 'my_day', 'target', 'settings', req.sid, null, { type, value }).catch(swallow('my_day:audit'));
  res.json({ ok: true });
}));

module.exports = { r, progress };
