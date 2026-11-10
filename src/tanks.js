'use strict';
/** Cuves : liste, création, saisie des jauges et réconciliation du stock en cuve par produit (logique : tank_logic.js). */
const express = require('express');
const { z } = require('zod');
const { pool, HttpError, wrap, body, need, audit } = require('./core');
const { reconcileProduct, tolerancePct } = require('./tank_logic');

const r = express.Router();
const rows = (sql, p) => pool.query(sql, p).then(x => x.rows);
const ts = (v, d) => { const t = v ? new Date(v) : d; if (Number.isNaN(t.getTime())) throw new HttpError(400, 'Date invalide'); return t; };

/** Alerte « tank_variance » : messagerie interne + canaux choisis (e-mail, SMS, WhatsApp si activés). Ne bloque jamais la saisie. */
async function alertVariance(req, tank, rec, measurementId) {
  const { rows: [st] } = await pool.query('SELECT client_id FROM stations WHERE id = $1', [req.sid]);
  if (!st || !st.client_id) return { sent: false, reason: 'no_client' };
  const sign = rec.variance < 0 ? 'manque' : 'excédent';
  const text = `Écart de cuve (${rec.level === 'critical' ? 'CRITIQUE' : 'à surveiller'}) — ${rec.product_name || 'produit'} : ${sign} de ${Math.abs(rec.variance)} L` +
    (rec.variance_pct != null ? ` (${rec.variance_pct} % des litres pompés)` : '') + `. Théorique ${rec.theoretical} L, mesuré ${rec.closing} L, tolérance ${rec.tolerance} L. Jauge saisie sur la cuve ${tank.name}.`;
  const { sendSystemAlert } = require('./messaging');
  const out = await sendSystemAlert({ clientId: st.client_id, actorUserId: req.user.id, kind: 'tank_variance', body: text, refTable: 'tank_measurements', refId: measurementId, stationId: req.sid });
  return { sent: !!out.sent, reason: out.reason || null, external: out.external || [] };
}

r.get('/tanks', need('report.view', 'stock.adjust', 'shift.close'), wrap(async (req, res) => {
  res.json(await rows(
    `SELECT t.id, t.name, t.product_id, p.name AS product_name, t.capacity_liters, t.alert_threshold, t.active,
            m.quantity AS last_quantity, m.measured_at AS last_measured_at,
            CASE WHEN t.capacity_liters > 0 AND m.quantity IS NOT NULL THEN ROUND(m.quantity / t.capacity_liters * 100, 1) END AS fill_pct
       FROM tanks t JOIN products p ON p.id = t.product_id
       LEFT JOIN LATERAL (SELECT quantity, measured_at FROM tank_measurements WHERE tank_id = t.id ORDER BY measured_at DESC, id DESC LIMIT 1) m ON TRUE
      WHERE t.station_id = $1 AND t.deleted_at IS NULL ORDER BY p.name, t.name`, [req.sid]));
}));

r.post('/tanks', need('settings.edit'), body(z.object({
  product_id: z.coerce.number().int().positive(), name: z.string().trim().min(1).max(80),
  capacity_liters: z.coerce.number().positive().optional(), alert_threshold: z.coerce.number().min(0).default(0)
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [p] } = await pool.query('SELECT id FROM products WHERE id = $1 AND station_id = $2', [b.product_id, req.sid]);
  if (!p) throw new HttpError(404, 'Produit introuvable');
  const { rows: [t] } = await pool.query(
    `INSERT INTO tanks(station_id, product_id, name, capacity_liters, alert_threshold) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (station_id, name) DO NOTHING RETURNING *`, [req.sid, b.product_id, b.name, b.capacity_liters ?? null, b.alert_threshold]);
  if (!t) throw new HttpError(409, 'Une cuve porte déjà ce nom');
  await audit(pool, req, 'stock', `Cuve ${t.name} créée`, 'tanks', t.id);
  res.status(201).json(t);
}));

r.post('/tanks/:id/measurements', need('stock.adjust', 'shift.close'), body(z.object({
  quantity: z.coerce.number().min(0), measured_at: z.string().optional(), notes: z.string().max(500).optional()
})), wrap(async (req, res) => {
  const { rows: [t] } = await pool.query('SELECT * FROM tanks WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!t) throw new HttpError(404, 'Cuve introuvable');
  const q = req.body.quantity;
  if (t.capacity_liters && q > Number(t.capacity_liters) * 1.02) throw new HttpError(400, `Jauge supérieure à la capacité de la cuve (${t.capacity_liters} L)`);
  const at = ts(req.body.measured_at, new Date());
  if (at.getTime() > Date.now() + 5 * 60e3) throw new HttpError(400, 'Date de jauge dans le futur');
  const { rows: [m] } = await pool.query(
    `INSERT INTO tank_measurements(tank_id, station_id, measured_at, quantity, measured_by, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [t.id, req.sid, at, q, req.user.employee_id || null, req.body.notes || null]);
  await audit(pool, req, 'stock', `Jauge ${t.name} : ${q} L`, 'tank_measurements', m.id);
  // Réconciliation immédiate depuis la jauge précédente de cette cuve ; alerte (sans blocage) si l'écart dépasse la tolérance.
  let reconciliation = null, alert = null;
  try {
    const { rows: [prev] } = await pool.query(
      'SELECT measured_at FROM tank_measurements WHERE tank_id = $1 AND id <> $2 AND measured_at < $3 ORDER BY measured_at DESC, id DESC LIMIT 1', [t.id, m.id, at]);
    if (prev) {
      const [pr] = await reconcileStation(req.sid, prev.measured_at, at, t.product_id);
      reconciliation = pr || null;
      if (pr && (pr.level === 'warning' || pr.level === 'critical')) alert = await alertVariance(req, t, pr, m.id);
    }
  } catch (e) { console.warn('[tanks] réconciliation après jauge impossible :', e.message); }
  res.status(201).json({ ...m, reconciliation, alert });
}));

r.get('/tanks/:id/measurements', need('report.view', 'stock.adjust', 'shift.close'), wrap(async (req, res) => {
  const lim = Math.min(Math.max(parseInt(req.query.limit, 10) || 60, 1), 500);
  res.json(await rows(
    `SELECT m.id, m.measured_at, m.quantity, m.notes FROM tank_measurements m JOIN tanks t ON t.id = m.tank_id
      WHERE t.id = $1 AND t.station_id = $2 ORDER BY m.measured_at DESC, m.id DESC LIMIT ${lim}`, [req.params.id, req.sid]));
}));

// Réconciliation en cuve par produit sur [from, to] (défaut : dernières 24 h). Les jauges d'ouverture et de clôture sont les
// dernières jauges de chaque cuve avant from et avant to ; litres pompés = compteurs des quarts clos dans la période.
/** Réconciliation par produit sur [from, to] (onlyProduct : limiter à un produit, sinon tous). */
async function reconcileStation(sid, from, to, onlyProduct = null) {
  const tanks = await rows(
    `SELECT t.id, t.name, t.product_id, p.name AS product_name,
            (SELECT quantity FROM tank_measurements WHERE tank_id = t.id AND measured_at <= $2 ORDER BY measured_at DESC, id DESC LIMIT 1) AS opening,
            (SELECT quantity FROM tank_measurements WHERE tank_id = t.id AND measured_at <= $3 ORDER BY measured_at DESC, id DESC LIMIT 1) AS closing
       FROM tanks t JOIN products p ON p.id = t.product_id
      WHERE t.station_id = $1 AND t.active AND t.deleted_at IS NULL AND ($4::bigint IS NULL OR t.product_id = $4) ORDER BY p.name, t.name`, [sid, from, to, onlyProduct]);
  const mv = await rows(
    `SELECT product_id,
            COALESCE(SUM(quantity) FILTER (WHERE kind IN ('achat','entree')), 0) AS received,
            COALESCE(SUM(quantity) FILTER (WHERE kind IN ('perte','casse','correction','transfert','retour')), 0) AS other
       FROM stock_movements WHERE station_id = $1 AND created_at > $2 AND created_at <= $3 GROUP BY product_id`, [sid, from, to]);
  const pumpedRows = await rows(
    `SELECT mr.product_id, COALESCE(SUM(mr.liters), 0) AS liters FROM meter_readings mr JOIN shifts sh ON sh.id = mr.shift_id
      WHERE sh.station_id = $1 AND sh.status = 'ferme' AND sh.closed_at > $2 AND sh.closed_at <= $3 AND mr.index_end IS NOT NULL
      GROUP BY mr.product_id`, [sid, from, to]);
  const mvBy = Object.fromEntries(mv.map(x => [x.product_id, x])), pBy = Object.fromEntries(pumpedRows.map(x => [x.product_id, Number(x.liters)]));
  const byProduct = new Map();
  for (const t of tanks) { if (!byProduct.has(t.product_id)) byProduct.set(t.product_id, { product_id: t.product_id, product_name: t.product_name, tanks: [] }); byProduct.get(t.product_id).tanks.push(t); }
  const tolPct = tolerancePct();
  const products = [...byProduct.values()].map(g => ({
    product_id: g.product_id, product_name: g.product_name,
    tanks: g.tanks.map(t => ({ id: t.id, name: t.name, opening: t.opening == null ? null : Number(t.opening), closing: t.closing == null ? null : Number(t.closing) })),
    ...reconcileProduct({ tanks: g.tanks.map(t => ({ id: t.id, name: t.name, opening: t.opening, closing: t.closing })),
      received: Number(mvBy[g.product_id]?.received || 0), other: Number(mvBy[g.product_id]?.other || 0), pumped: pBy[g.product_id] || 0, tolPct })
  }));
  return products;
}

r.get('/tanks/reconcile', need('report.view'), wrap(async (req, res) => {
  const to = ts(req.query.to, new Date()), from = ts(req.query.from, new Date(to.getTime() - 864e5));
  if (from >= to) throw new HttpError(400, 'La date de début doit précéder la date de fin');
  const products = await reconcileStation(req.sid, from, to);
  const rank = { critical: 3, warning: 2, ok: 1, info: 0 };
  res.json({ from, to, tolerance_pct: tolerancePct(), level: products.reduce((a, p) => rank[p.level] > rank[a] ? p.level : a, 'info'), products });
}));

module.exports = { r, reconcileStation };
