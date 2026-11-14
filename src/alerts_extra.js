'use strict';
// Alertes calculées : résumé du soir par station et prévision de rupture de cuve.
// Les requêtes prennent un « pool » en paramètre pour pouvoir être testées sur une base locale.

const SUMMARY_HOUR = 20;           // heure du serveur (UTC = heure de Bamako) à partir de laquelle le résumé du jour est envoyé
const fmt = n => Math.round(Number(n) || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
const fmtL = n => (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('fr-FR').replace(/[  ]/g, ' ');

/** Identifiant de déduplication : un seul résumé par station et par jour. */
function summaryRefId(date, stationId) { return Number(String(date).replace(/-/g, '')) * 1000000 + Number(stationId); }

/** Jours restants = stock estimé / consommation moyenne par jour. null si la consommation est nulle. */
function daysLeft(stockLiters, litersLast7Days) {
  const daily = Number(litersLast7Days) / 7;
  if (!(daily > 0)) return null;
  return Math.max(0, Number(stockLiters)) / daily;
}

function formatSummary({ date, stationName, pumps, totals, shifts, anomalies }) {
  const lines = [`Résumé du ${date}${stationName ? ' — ' + stationName : ''}`];
  if (!pumps.length) lines.push('Aucune vente de carburant enregistrée aujourd’hui.');
  else {
    lines.push('Ventes de carburant par pompe :');
    for (const p of pumps) lines.push(`• ${p.name} : ${fmtL(p.liters)} L, ${fmt(p.amount)} FCFA`);
    lines.push(`Total carburant : ${fmtL(totals.liters)} L, ${fmt(totals.amount)} FCFA`);
  }
  lines.push(`Quarts du jour : ${shifts.count} (dont ${shifts.closed} clôturé(s))`);
  lines.push(shifts.gapCount
    ? `Écarts de caisse : ${shifts.gapCount} quart(s), cumul ${fmt(shifts.gapTotal)} FCFA`
    : 'Écarts de caisse : aucun');
  if (anomalies) lines.push(`Anomalies signalées : ${anomalies}`);
  return lines.join('\n');
}

async function buildDailySummary(pool, stationId, date) {
  const [{ rows: pumps }, { rows: [sh] }, { rows: [an] }, { rows: [st] }] = await Promise.all([
    pool.query(
      `SELECT COALESCE(pu.name, 'Sans pompe') AS name, COALESCE(SUM(d.quantity),0)::float8 AS liters, COALESCE(SUM(d.amount),0)::float8 AS amount
         FROM sales sa JOIN sale_details d ON d.sale_id = sa.id LEFT JOIN pumps pu ON pu.id = sa.pump_id
        WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND sa.sold_at::date = $2::date
        GROUP BY pu.name ORDER BY pu.name`, [stationId, date]),
    pool.query(
      `SELECT COUNT(*)::int AS count, COUNT(*) FILTER (WHERE status = 'ferme')::int AS closed,
              COUNT(*) FILTER (WHERE COALESCE(cash_gap,0) <> 0)::int AS gap_count, COALESCE(SUM(cash_gap) FILTER (WHERE COALESCE(cash_gap,0) <> 0),0)::float8 AS gap_total
         FROM shifts WHERE station_id = $1 AND status <> 'annule' AND opened_at::date = $2::date`, [stationId, date]),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM shift_anomalies a JOIN shifts s ON s.id = a.shift_id WHERE s.station_id = $1 AND a.created_at::date = $2::date`, [stationId, date]),
    pool.query('SELECT name FROM stations WHERE id = $1', [stationId])
  ]);
  const totals = pumps.reduce((t, p) => ({ liters: t.liters + p.liters, amount: t.amount + p.amount }), { liters: 0, amount: 0 });
  const text = formatSummary({ date, stationName: st && st.name, pumps, totals, anomalies: an.n,
    shifts: { count: sh.count, closed: sh.closed, gapCount: sh.gap_count, gapTotal: sh.gap_total } });
  return { text, pumps, totals };
}

/** Une ligne par produit carburant : stock estimé (dernier jaugeage − litres vendus depuis) et jours restants. */
async function tankRunouts(pool, stationId) {
  const { rows } = await pool.query(
    `WITH last AS (
       SELECT t.product_id, t.id AS tank_id, m.quantity, m.measured_at
         FROM tanks t
         JOIN LATERAL (SELECT quantity, measured_at FROM tank_measurements WHERE tank_id = t.id ORDER BY measured_at DESC, id DESC LIMIT 1) m ON TRUE
        WHERE t.station_id = $1 AND t.deleted_at IS NULL AND t.active),
     prod AS (SELECT product_id, SUM(quantity)::float8 AS measured, MIN(measured_at) AS since FROM last GROUP BY product_id)
     SELECT p.product_id, pr.name, p.measured,
            COALESCE((SELECT SUM(d.quantity) FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
                       WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND d.product_id = p.product_id AND sa.sold_at >= p.since),0)::float8 AS sold_since,
            COALESCE((SELECT SUM(d.quantity) FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
                       WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND d.product_id = p.product_id AND sa.sold_at >= now() - interval '7 days'),0)::float8 AS sold_7d
       FROM prod p JOIN products pr ON pr.id = p.product_id`, [stationId]);
  return rows.map(r => {
    const stock = Math.max(0, r.measured - r.sold_since);
    return { product_id: r.product_id, name: r.name, stock, daily: r.sold_7d / 7, days: daysLeft(stock, r.sold_7d) };
  });
}

module.exports = { SUMMARY_HOUR, summaryRefId, daysLeft, formatSummary, buildDailySummary, tankRunouts, fmt, fmtL };
