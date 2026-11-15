'use strict';
/** Récidive des écarts par employé : logique pure (sans base), testable seule.
 *  Un écart « compte » s'il est non nul. Un employé est « récurrent » quand il a des écarts sur au moins `minShifts` quarts distincts
 *  dans la fenêtre. Simple signal à examiner : aucune retenue ni sanction automatique. */
const r2 = n => Math.round(Number(n) * 100) / 100;

/** gaps : [{ employee_id, employee, shift_id, kind: 'caisse'|'stock', amount, created_at }] ; worked : { [employee_id]: nombre de quarts travaillés }. */
function recurrence({ gaps, worked = {}, minShifts = 3 }) {
  const by = new Map();
  for (const g of gaps || []) {
    if (g == null || g.employee_id == null || !(Math.abs(Number(g.amount)) > 0.0005)) continue;
    const e = by.get(g.employee_id) || { employee_id: g.employee_id, employee: g.employee || null, shifts: new Set(), cash_count: 0, stock_count: 0, cash_total: 0, deficits: 0, last_gap_at: null };
    e.shifts.add(g.shift_id);
    if (g.kind === 'caisse') { e.cash_count++; e.cash_total = r2(e.cash_total + Number(g.amount)); if (Number(g.amount) < 0) e.deficits++; } else e.stock_count++;
    if (g.created_at && (!e.last_gap_at || new Date(g.created_at) > new Date(e.last_gap_at))) e.last_gap_at = g.created_at;
    by.set(g.employee_id, e);
  }
  return [...by.values()].map(e => {
    const n = e.shifts.size, w = Number(worked[e.employee_id]) || 0;
    return { employee_id: e.employee_id, employee: e.employee, shifts_with_gap: n, shifts_worked: w || null, rate_pct: w > 0 ? Math.round(Math.min(n, w) / w * 1000) / 10 : null,
      cash_gaps: e.cash_count, stock_gaps: e.stock_count, cash_total: e.cash_total, deficits: e.deficits, last_gap_at: e.last_gap_at,
      recurrent: n >= minShifts, level: n >= minShifts * 2 ? 'critical' : n >= minShifts ? 'warning' : 'info' };
  }).sort((a, b) => b.shifts_with_gap - a.shifts_with_gap || Math.abs(b.cash_total) - Math.abs(a.cash_total));
}
module.exports = { recurrence };
