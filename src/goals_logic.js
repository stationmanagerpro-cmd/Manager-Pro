'use strict';
/** Objectifs de vente et classement : logique pure (sans base). */
const r1 = n => Math.round(n * 10) / 10;

/** Avancement d'un objectif mensuel. achieved/target dans la même unité ; jours écoulés (≥ 1) sur jours du mois.
 *  Statut : 'atteint' dès 100 % ; 'en_retard' si l'avancement est inférieur à 85 % du rythme attendu après au moins 7 jours ; sinon 'en_bonne_voie'. */
function progress({ target, achieved, dayOfMonth, daysInMonth }) {
  const t = Number(target), a = Math.max(0, Number(achieved) || 0);
  if (!(t > 0)) return null;
  const dim = Math.max(1, Number(daysInMonth) || 30), dom = Math.min(Math.max(Number(dayOfMonth) || 1, 1), dim);
  const pct = r1(a / t * 100), expectedPct = r1(dom / dim * 100), projected = Math.round(a / dom * dim * 1000) / 1000;
  let status = 'en_bonne_voie';
  if (a >= t) status = 'atteint';
  else if (dom >= 7 && pct < expectedPct * 0.85) status = 'en_retard';
  return { target: t, achieved: a, pct, expected_pct: expectedPct, projected, remaining: Math.max(0, Math.round((t - a) * 1000) / 1000), status };
}

/** Classement des pompistes : tri par ventes décroissantes ; taux d'écart = quarts avec écart de caisse / quarts travaillés. */
function rankEmployees(rows) {
  return (rows || []).map(e => {
    const shifts = Number(e.shifts_worked) || 0, gapShifts = Number(e.gap_shifts) || 0;
    return { employee_id: e.employee_id, employee: e.employee, sales: Number(e.sales) || 0, shifts_worked: shifts, cash_gap_total: Number(e.cash_gap_total) || 0, gap_shifts: gapShifts,
      stock_gaps: Number(e.stock_gaps) || 0, gap_rate_pct: shifts > 0 ? r1(Math.min(gapShifts, shifts) / shifts * 100) : null,
      avg_per_shift: shifts > 0 ? Math.round((Number(e.sales) || 0) / shifts) : null };
  }).sort((a, b) => b.sales - a.sales || a.employee.localeCompare(b.employee)).map((e, i) => ({ rank: i + 1, ...e,
    // « À féliciter » = ventes dans la première moitié ET aucun écart ; « À accompagner » = au moins 3 quarts avec écart et taux ≥ 25 %
    tag: e.gap_shifts === 0 && e.shifts_worked >= 3 && i < Math.ceil(rows.length / 2) ? 'a_feliciter' : e.gap_shifts >= 3 && e.gap_rate_pct != null && e.gap_rate_pct >= 25 ? 'a_accompagner' : null }));
}
module.exports = { progress, rankEmployees };
