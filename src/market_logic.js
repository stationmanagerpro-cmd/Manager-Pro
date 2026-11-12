'use strict';
/** Logique pure (sans base de données) des fonctions « marché » : score de risque d'un quart, prévision de rupture, rapprochement ventes ↔ relevé. */
const r1 = n => Math.round(Number(n) * 10) / 10;
const r2 = n => Math.round(Number(n) * 100) / 100;
const DAY = 86400000;
const isoDay = d => new Date(d).toISOString().slice(0, 10);

/** Score de risque d'un quart (0-100). Chaque facteur est expliqué : aucun verdict sans raison affichée. */
function scoreShift(f) {
  const factors = [];
  const add = (code, label, points, detail) => { if (points > 0) factors.push({ code, label, points, detail }); };
  const gap = Math.abs(Number(f.cash_gap) || 0), theo = Math.max(Math.abs(Number(f.theoretical_cash) || 0), 1);
  if (gap > 0) {
    const ratio = gap / theo;
    add('cash_gap', 'Écart de caisse', ratio >= 0.02 ? 30 : ratio >= 0.005 ? 20 : 8, `${Math.round(gap)} (${r2(ratio * 100)} % de la caisse théorique)`);
  }
  const canc = Number(f.cancelled_count) || 0, all = (Number(f.sales_count) || 0) + canc;
  if (canc > 0) {
    const pct = all ? canc / all : 0;
    add('cancellations', 'Ventes annulées', pct >= 0.10 ? 20 : pct >= 0.05 ? 12 : 4, `${canc} sur ${all} (${r1(pct * 100)} %)`);
  }
  const an = Number(f.anomaly_count) || 0;
  if (an > 0) add('anomalies', 'Anomalies déclarées', Math.min(15, an * 5), `${an} anomalie(s)${f.anomaly_kinds ? ' : ' + f.anomaly_kinds : ''}`);
  const rep = Number(f.recent_gap_shifts) || 0;
  if (gap > 0 && rep >= 3) add('repeat', 'Écart répété', 15, `écart sur ${rep} des 5 derniers quarts du même responsable`);
  else if (gap > 0 && rep === 2) add('repeat', 'Écart répété', 8, 'écart sur 2 des 5 derniers quarts du même responsable');
  const score = Math.min(100, factors.reduce((s, x) => s + x.points, 0));
  return { score, level: score >= 50 ? 'a_controler' : score >= 25 ? 'a_surveiller' : 'normal', factors };
}

/** Prévision de rupture : cadence = 60 % moyenne des 14 derniers jours + 40 % moyenne de la fenêtre. daily = quantités vendues par jour, du plus ancien au plus récent. */
function forecastProduct({ stock, daily, leadDays = 2, today = new Date() }) {
  const n = daily.length, sum = a => a.reduce((s, v) => s + Number(v || 0), 0);
  if (!n || sum(daily) <= 0) return { status: 'sans_vente' };
  const last = daily.slice(-14), rate = 0.6 * (sum(last) / last.length) + 0.4 * (sum(daily) / n);
  const st = Math.max(Number(stock) || 0, 0), daysLeft = st / rate;
  const out = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + Math.floor(daysLeft) * DAY);
  let orderBy = new Date(out.getTime() - leadDays * DAY); const t0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (orderBy < t0) orderBy = t0;
  const level = daysLeft <= leadDays ? 'critique' : daysLeft <= leadDays + 3 ? 'attention' : 'ok';
  return { status: 'calcule', level, daily_rate: r2(rate), days_left: r1(daysLeft), stockout_on: isoDay(out), order_by: isoDay(orderBy), stock: r2(st) };
}

module.exports = { scoreShift, forecastProduct, r1, r2, isoDay };
