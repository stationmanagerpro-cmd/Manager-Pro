// Vue consolidée (toutes les stations) et Vue par station — lecture seule.
// SOURCES (aucune valeur n'est posée sans origine ; chaque bloc renvoyé porte son champ « sources ») :
//   CA TTC ............ même définition que le tableau de bord (reports.js) : ventes produits (sales.total) + carburant des
//                       compteurs des quarts clos (meter_readings.amount) + carburant déclaré des quarts ouverts ;
//                       fenêtres équivalentes (station_views_logic.windowsFor)
//   CA HT ............. même assiette, TVA par ligne (sale_details.tax_rate ; carburant des compteurs : products.tax_rate)
//   Encaissements ..... payments (method = 'especes') rattachés à des ventes valides ou au quart
//   Quarts saisis ..... shifts (status ouvert/ferme) par shift_date
//   Créances clients .. customers.balance > 0 (clients non supprimés)
//   Dettes fournisseurs suppliers.balance_due > 0 (fournisseurs non supprimés)
//   Écarts jaugeage ... shift_stock_counts.gap (physique − théorique) des produits CARBURANT, quarts clos ;
//                       base « ventes » = meter_readings.liters des mêmes quarts
//   Niveaux de cuves .. stock.quantity − litres déjà vendus dans le quart ouvert ; capacité = tanks.capacity_liters
//   Santé ............. règles de station_views_logic (seuils exposés dans la réponse)
// Périmètre : stations du compte (user_stations ∩ actives ∩ même client), droits et plafonds de station respectés.
const express = require('express');
const { swallow } = require('./safe');
const { pool, wrap, need, HttpError } = require('./core');
const { featureOn } = require('./contracts');
const files = require('./files');
const L = require('./station_views_logic');

const r = express.Router();
const ENTRY = ['user.manage', 'report.view', 'finance.view'];

/** Module de contrat actif ? (compte sans contrat restreint = tout autorisé ; Super Admin déjà bloqué en amont). */
const moduleOn = (req, ...keys) => !req.contract || req.contract.unrestricted || keys.some(k => featureOn(req.contract, k));

async function accessibleStations(req) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.currency, s.photo_path IS NOT NULL AS has_logo
       FROM stations s
       JOIN user_stations us ON us.station_id = s.id
       JOIN users u ON u.id = us.user_id
      WHERE us.user_id = $1 AND s.active = true
        AND (u.client_id IS NULL OR s.client_id = u.client_id)
      ORDER BY s.name, s.id`, [req.user.id]);
  return rows.map(s => ({ ...s, currency: String(s.currency || 'FCFA').trim() }));
}

/** Droits effectifs par station : droits du rôle − plafonds de la station (station_permission_caps) − modules du contrat. */
async function capabilitiesByStation(req, stations) {
  const { rows: caps } = await pool.query(
    'SELECT station_id, permission_code FROM station_permission_caps WHERE station_id = ANY($1::bigint[]) AND allowed = false',
    [stations.map(s => s.id)]).catch(swallow('multistation_views:44', { rows: [] }));
  const capped = new Map();
  for (const c of caps) { if (!capped.has(String(c.station_id))) capped.set(String(c.station_id), new Set()); capped.get(String(c.station_id)).add(c.permission_code); }
  const base = req.user.perms;
  const out = new Map();
  for (const s of stations) {
    const off = capped.get(String(s.id)) || new Set();
    const has = (...codes) => codes.some(c => base.has(c) && !off.has(c));
    out.set(String(s.id), {
      sales: has('report.view', 'finance.view') && moduleOn(req, 'module:sales', 'can_view_reports', 'module:reports'),
      customers: has('finance.view', 'customer.view') && moduleOn(req, 'module:sales', 'can_access_finance', 'module:finance'),
      suppliers: has('finance.view', 'supplier.view') && moduleOn(req, 'module:stock', 'module:purchases', 'module:suppliers', 'can_access_finance', 'module:finance'),
      stock: has('report.view', 'stock.adjust', 'price.edit') && moduleOn(req, 'module:stock'),
      finance: has('finance.view') && moduleOn(req, 'can_access_finance', 'module:finance'),
      ops: has('report.view', 'shift.open', 'shift.close') && moduleOn(req, 'module:sales')
    });
  }
  return out;
}

async function refDate(q) {
  if (q && L.isYmd(String(q))) return String(q);
  const { rows: [d] } = await pool.query('SELECT CURRENT_DATE::text AS d');   // même fuseau que les requêtes « ::date » existantes
  return d.d;
}

/** Période libre optionnelle ?from=AAAA-MM-JJ&to=AAAA-MM-JJ (les deux ensemble) ; la date de référence devient « to ». */
function parseRange(q) {
  const from = q && q.from ? String(q.from) : '', to = q && q.to ? String(q.to) : '';
  if (!from && !to) return null;
  if (!from || !to) throw new HttpError(400, 'Indiquez les deux dates de la période (du … au …).');
  if (!L.isYmd(from) || !L.isYmd(to)) throw new HttpError(400, 'Dates invalides (format AAAA-MM-JJ attendu).');
  if (from > to) throw new HttpError(400, 'La date de début doit précéder la date de fin.');
  return { from, to };
}

const num = v => Number(v) || 0;
const byStation = rows => { const m = new Map(); for (const x of rows) m.set(String(x.station_id), x); return m; };

/**
 * CA TTC par station et par fenêtre — MÊME définition que le tableau de bord (reports.js) :
 *   ventes produits (sales, kind = produits) + carburant des compteurs des quarts CLOS (meter_readings.amount, closed_at)
 *   + carburant déclaré en vente dans les quarts encore OUVERTS (sales, kind = carburant).
 * Le carburant déclaré d'un quart clos est déjà inclus dans les compteurs : il n'est donc pas ajouté une 2e fois.
 */
async function loadSales(ids, w) {
  const win = (a, b) => `COALESCE(SUM(amt) FILTER (WHERE ts >= '${a}'::date AND ts < '${b}'::date + 1), 0)::float`;
  const rangeCols = w.range ? `, ${win(...w.range)} AS range_cur, ${win(...w.rangePrev)} AS range_prev` : '';
  // Les bornes viennent de windowsFor (dates validées YYYY-MM-DD) : aucune donnée utilisateur n'est concaténée.
  const { rows } = await pool.query(
    `WITH ev AS (
        SELECT sa.station_id, sa.sold_at AS ts, sa.total AS amt FROM sales sa
         WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.kind = 'produits'
           AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
        UNION ALL
        SELECT sh.station_id, sh.closed_at, m.amount FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
         WHERE sh.station_id = ANY($1::bigint[]) AND sh.status = 'ferme' AND m.amount IS NOT NULL
           AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
        UNION ALL
        SELECT sa.station_id, sa.sold_at, sa.total FROM sales sa JOIN shifts sh ON sh.id = sa.shift_id
         WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.kind = 'carburant' AND sh.status = 'ouvert'
           AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1)
     SELECT station_id,
            ${win(...w.day)} AS day_cur, ${win(...w.dayPrev)} AS day_prev,
            ${win(...w.week)} AS week_cur, ${win(...w.weekPrev)} AS week_prev,
            ${win(...w.month)} AS month_cur, ${win(...w.monthPrev)} AS month_prev,
            ${win(...w.year)} AS year_cur${rangeCols},
            COALESCE(SUM(amt) FILTER (WHERE ts >= ($3::date - 6)), 0)::float AS d7
       FROM ev GROUP BY station_id`, [ids, w.minStart, w.ref]);
  return byStation(rows);
}

/** CA HT par station (mois de la date de référence, ou période libre si elle est choisie) : TVA par ligne de vente ; carburant des compteurs au taux de TVA du produit. */
async function loadHt(ids, w) {
  const line = ({ rate, amt }) => `CASE WHEN COALESCE(${rate}, 0) > 0 THEN ${amt} / (1 + ${rate} / 100.0) ELSE ${amt} END`;
  const { rows } = await pool.query(
    `WITH ev AS (
        SELECT sa.station_id, ${line({ rate: 'd.tax_rate', amt: 'd.amount' })} AS ht
          FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
         WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.kind = 'produits'
           AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
        UNION ALL
        SELECT sh.station_id, ${line({ rate: 'p.tax_rate', amt: 'm.amount' })}
          FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id JOIN products p ON p.id = m.product_id
         WHERE sh.station_id = ANY($1::bigint[]) AND sh.status = 'ferme' AND m.amount IS NOT NULL
           AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
        UNION ALL
        SELECT sa.station_id, ${line({ rate: 'd.tax_rate', amt: 'd.amount' })}
          FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN shifts sh ON sh.id = sa.shift_id
         WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.kind = 'carburant' AND sh.status = 'ouvert'
           AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1)
     SELECT station_id, COALESCE(SUM(ht), 0)::float AS ht FROM ev GROUP BY station_id`, [ids, w.htRange[0], w.htRange[1]]);
  return byStation(rows);
}

async function loadCash(ids, w) {
  const win = (a, b) => `COALESCE(SUM(pm.amount) FILTER (WHERE pm.paid_at >= '${a}'::date AND pm.paid_at < '${b}'::date + 1), 0)::float`;
  // Période libre : colonnes supplémentaires (même formule), fenêtre de lecture élargie à la période précédente.
  const rangeCols = w.range ? `, ${win(...w.range)} AS range_cur, ${win(...w.rangePrev)} AS range_prev` : '';
  const lower = w.range ? [w.dayPrev[0], w.rangePrev[0]].sort()[0] : w.dayPrev[0];
  const { rows } = await pool.query(
    `SELECT pm.station_id, ${win(...w.day)} AS day_cur, ${win(...w.dayPrev)} AS day_prev${rangeCols}
       FROM payments pm LEFT JOIN sales sa ON sa.id = pm.sale_id
      WHERE pm.station_id = ANY($1::bigint[]) AND pm.method = 'especes'
        AND (pm.sale_id IS NULL OR sa.status = 'valide')
        AND pm.paid_at >= $2::date AND pm.paid_at < $3::date + 1
      GROUP BY pm.station_id`, [ids, lower, w.ref]);
  return byStation(rows);
}

async function loadShifts(ids, w) {
  const { rows } = await pool.query(
    `SELECT station_id,
            COUNT(*) FILTER (WHERE shift_date = $2::date)::int AS today,
            COUNT(*) FILTER (WHERE shift_date = $2::date - 1)::int AS yesterday,
            COUNT(*) FILTER (WHERE shift_date >= $2::date - 7 AND shift_date < $2::date - 1)::int AS prev7,
            COALESCE(MAX(EXTRACT(EPOCH FROM (now() - opened_at)) / 3600.0) FILTER (WHERE status = 'ouvert'), NULL)::float AS oldest_open_h,
            COALESCE(SUM(ABS(cash_gap)) FILTER (WHERE status = 'ferme' AND shift_date >= $2::date - 6 AND shift_date <= $2::date), 0)::float AS gap7
       FROM shifts
      WHERE station_id = ANY($1::bigint[]) AND status IN ('ouvert', 'ferme')
        AND shift_date >= $2::date - 7 AND shift_date <= $2::date
      GROUP BY station_id`, [ids, w.ref]);
  return byStation(rows);
}

/** Quarts saisis (ouverts ou clos) sur une période libre, par date de quart — même source que loadShifts. */
async function loadShiftsRange(ids, range) {
  const { rows } = await pool.query(
    `SELECT station_id, COUNT(*)::int AS n FROM shifts
      WHERE station_id = ANY($1::bigint[]) AND status IN ('ouvert', 'ferme') AND shift_date >= $2::date AND shift_date <= $3::date
      GROUP BY station_id`, [ids, range[0], range[1]]);
  return byStation(rows);
}

async function loadAnomalies(ids, w) {
  const { rows } = await pool.query(
    `SELECT sh.station_id, COUNT(*)::int AS n
       FROM shift_anomalies an JOIN shifts sh ON sh.id = an.shift_id
      WHERE sh.station_id = ANY($1::bigint[]) AND an.kind IN ('ecart_caisse', 'ecart_stock', 'ecart_compteur')
        AND sh.shift_date >= $2::date - 6 AND sh.shift_date <= $2::date
      GROUP BY sh.station_id`, [ids, w.ref]);
  return byStation(rows);
}

async function loadCustomers(ids) {
  const { rows } = await pool.query(
    `SELECT station_id,
            COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::float AS due,
            COUNT(*) FILTER (WHERE balance > 0)::int AS n,
            COUNT(*) FILTER (WHERE credit_limit > 0 AND balance > credit_limit)::int AS over_limit
       FROM customers WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL
      GROUP BY station_id`, [ids]);
  return byStation(rows);
}

async function loadSuppliers(ids) {
  const { rows } = await pool.query(
    `SELECT station_id, COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0), 0)::float AS due,
            COUNT(*) FILTER (WHERE balance_due > 0)::int AS n
       FROM suppliers WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL
      GROUP BY station_id`, [ids]);
  return byStation(rows);
}

/** Cuves carburant : stock comptable − litres déjà vendus dans le quart ouvert (comme /dashboard/overview). */
async function loadFuel(ids) {
  const sqlFull = `SELECT p.station_id, p.id, p.name, p.unit, COALESCE(st.quantity, 0)::float AS book, p.min_stock::float AS min_stock,
            (SELECT COALESCE(SUM(t.capacity_liters), 0)::float FROM tanks t
              WHERE t.station_id = p.station_id AND t.product_id = p.id AND t.deleted_at IS NULL AND t.active) AS capacity,
            COALESCE((SELECT SUM(d.quantity) FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN shifts sh ON sh.id = sa.shift_id
                       WHERE sa.station_id = p.station_id AND sa.kind = 'carburant' AND sa.status = 'valide'
                         AND sh.status = 'ouvert' AND d.product_id = p.id), 0)::float AS pending
       FROM products p JOIN categories cat ON cat.id = p.category_id LEFT JOIN stock st ON st.product_id = p.id
      WHERE p.station_id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND p.active AND cat.code = 'CARBURANT'
      ORDER BY p.station_id, p.name`;
  let rows;
  try { ({ rows } = await pool.query(sqlFull, [ids])); }
  catch (_) {   // table « tanks » absente (migration 045 non appliquée) : niveaux sans capacité
    ({ rows } = await pool.query(sqlFull.replace(/\(SELECT COALESCE\(SUM\(t\.capacity_liters\)[\s\S]*?\) AS capacity,/, '0::float AS capacity,'), [ids]));
  }
  return rows.map(x => ({
    station_id: x.station_id, product_id: x.id, name: x.name, unit: x.unit || 'L',
    quantity: Math.max(0, num(x.book) - num(x.pending)), capacity: num(x.capacity) || null, min_stock: num(x.min_stock),
    pending_liters: num(x.pending), level_pct: L.gaugePct(Math.max(0, num(x.book) - num(x.pending)), x.capacity),
    short: L.fuelShort(x.name), color: L.fuelColor(x.name)
  }));
}

async function loadLowOther(ids) {
  const { rows } = await pool.query(
    `SELECT p.station_id, COUNT(*)::int AS n
       FROM products p JOIN categories cat ON cat.id = p.category_id JOIN stock st ON st.product_id = p.id
      WHERE p.station_id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND p.active AND cat.code <> 'CARBURANT'
        AND p.min_stock > 0 AND st.quantity <= p.min_stock
      GROUP BY p.station_id`, [ids]);
  return byStation(rows);
}

/** Écarts de jaugeage du mois par carburant (nom normalisé) : litres d'écart et % des litres vendus. */
async function loadGauging(ids, w) {
  const { rows } = await pool.query(
    `WITH sh AS (
        SELECT id FROM shifts WHERE station_id = ANY($1::bigint[]) AND status = 'ferme' AND closed_at >= $2::date AND closed_at < $3::date + 1),
      gap AS (
        SELECT lower(btrim(p.name)) AS k, MIN(p.name) AS name, SUM(sc.gap)::float AS gap_l
          FROM shift_stock_counts sc JOIN sh ON sh.id = sc.shift_id JOIN products p ON p.id = sc.product_id
          JOIN categories cat ON cat.id = p.category_id
         WHERE cat.code = 'CARBURANT' AND sc.gap IS NOT NULL GROUP BY 1),
      sold AS (
        SELECT lower(btrim(p.name)) AS k, SUM(mr.liters)::float AS sold_l
          FROM meter_readings mr JOIN sh ON sh.id = mr.shift_id JOIN products p ON p.id = mr.product_id
         WHERE mr.liters IS NOT NULL GROUP BY 1)
      SELECT gap.name, gap.gap_l, COALESCE(sold.sold_l, 0)::float AS sold_l FROM gap LEFT JOIN sold USING (k) ORDER BY gap.name`,
    [ids, w.htRange[0], w.htRange[1]]);
  return rows.map(x => ({
    name: x.name, gap_liters: Math.round(num(x.gap_l) * 10) / 10, sold_liters: Math.round(num(x.sold_l) * 10) / 10,
    pct_of_sales: num(x.sold_l) > 0 ? Math.round((num(x.gap_l) / num(x.sold_l)) * 1000) / 10 : null
  }));
}

function salesBlock(row, w) {
  const g = k => num(row && row[k]);
  return {
    day: { value: g('day_cur'), previous: g('day_prev'), variation_pct: L.variation(g('day_cur'), g('day_prev')) },
    week: { value: g('week_cur'), previous: g('week_prev'), variation_pct: L.variation(g('week_cur'), g('week_prev')), iso_week: w.isoWeek },
    month: { value: g('month_cur'), previous: g('month_prev'), variation_pct: L.variation(g('month_cur'), g('month_prev')) },
    year: { value: g('year_cur'), year: w.year_n },
    ...(w.range ? { period: { value: g('range_cur'), previous: g('range_prev'), variation_pct: L.variation(g('range_cur'), g('range_prev')) } } : {})
  };
}

const sumBlocks = list => {
  const add = k => list.reduce((a, b) => a + num(b[k].value), 0), addP = k => list.reduce((a, b) => a + num(b[k].previous), 0);
  const mk = k => ({ value: add(k), previous: addP(k), variation_pct: L.variation(add(k), addP(k)) });
  return { day: mk('day'), week: mk('week'), month: mk('month'), year: { value: add('year') }, ...(list.length && list[0].period ? { period: mk('period') } : {}) };
};

/** GET /stations/consolidated?date=YYYY-MM-DD — vue consolidée de toutes les stations accessibles. */
r.get('/stations/consolidated', need(...ENTRY), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Réservé aux comptes clients.');
  const stations = await accessibleStations(req);
  const ids = stations.map(s => s.id);
  const range = parseRange(req.query);
  let w;
  try { w = L.windowsFor(range ? range.to : await refDate(req.query.date), range); } catch (e) { throw new HttpError(400, e.message); }
  if (!ids.length) return res.json({ as_of: w.ref, stations: [], note: 'Aucune station accessible.' });
  const caps = await capabilitiesByStation(req, stations);
  const cap = s => caps.get(String(s.id));

  const [sales, ht, shifts, anomalies, customers, suppliers, fuel, lowOther, gauging] = await Promise.all([
    loadSales(ids, w), loadHt(ids, w), loadShifts(ids, w), loadAnomalies(ids, w),
    loadCustomers(ids), loadSuppliers(ids), loadFuel(ids), loadLowOther(ids), loadGauging(ids, w)
  ]);

  const seeSales = stations.filter(s => cap(s).sales);
  const perStation = stations.map(s => {
    const c = cap(s), k = String(s.id);
    const fuelS = fuel.filter(x => String(x.station_id) === k);
    const sh = shifts.get(k) || {}, cu = customers.get(k) || {};
    const health = {
      stock: c.stock ? L.healthStock({ fuel: fuelS, lowOther: num((lowOther.get(k) || {}).n) }) : null,
      finance: c.finance ? L.healthFinance({ cashGapAbs7d: sh.gap7, sales7d: (sales.get(k) || {}).d7, overLimitCustomers: num(cu.over_limit) }) : null,
      ops: c.ops ? L.healthOps({ oldestOpenHours: sh.oldest_open_h == null ? null : num(sh.oldest_open_h), anomalies7d: num((anomalies.get(k) || {}).n), shiftsYesterday: num(sh.yesterday), shiftsPrev7d: num(sh.prev7) }) : null
    };
    return { id: s.id, name: s.name, currency: s.currency, health, month_ht: c.sales ? num((ht.get(k) || {}).ht) : null };
  });

  const salesBlocks = seeSales.map(s => salesBlock(sales.get(String(s.id)), w));
  const custStations = stations.filter(s => cap(s).customers), supStations = stations.filter(s => cap(s).suppliers);
  const ca = salesBlocks.length ? sumBlocks(salesBlocks) : null;
  const currencies = [...new Set(stations.map(s => s.currency))];
  const htParts = L.shares(perStation.filter(p => p.month_ht != null).map(p => ({ id: p.id, name: p.name, value: p.month_ht })));

  res.set('Cache-Control', 'no-store').json({
    as_of: w.ref, period_labels: { iso_week: w.isoWeek, month: w.month_n, year: w.year_n },
    range: w.range ? { from: w.range[0], to: w.range[1], days: w.rangeDays, prev_from: w.rangePrev[0], prev_to: w.rangePrev[1] } : null,
    currencies, mixed_currency: currencies.length > 1,
    stations_total: stations.length,
    hidden: { sales: stations.length - seeSales.length, customers: stations.length - custStations.length, suppliers: stations.length - supStations.length },
    ca_ttc: ca && { ...ca, sources: ['sales.total (produits, valides)', 'meter_readings.amount (quarts clos)', 'sales.total carburant (quarts ouverts)'] },
    receivables: custStations.length ? {
      amount: custStations.reduce((a, s) => a + num((customers.get(String(s.id)) || {}).due), 0),
      customers: custStations.reduce((a, s) => a + num((customers.get(String(s.id)) || {}).n), 0),
      sources: ['customers.balance > 0']
    } : null,
    payables: supStations.length ? {
      amount: supStations.reduce((a, s) => a + num((suppliers.get(String(s.id)) || {}).due), 0),
      suppliers: supStations.reduce((a, s) => a + num((suppliers.get(String(s.id)) || {}).n), 0),
      sources: ['suppliers.balance_due > 0']
    } : null,
    gauging: stations.some(s => cap(s).stock) ? { month: w.month_n, range: !!w.range, items: gauging, sources: ['shift_stock_counts.gap', 'meter_readings.liters'] } : null,
    ht_share: htParts.length ? { month: w.month_n, range: !!w.range, items: htParts.map(p => ({ id: p.id, name: p.name, ht: Math.round(p.value), pct: p.pct })), sources: ['sale_details.amount / (1 + tax_rate)', 'meter_readings.amount / (1 + products.tax_rate)'] } : null,
    health: { stations: perStation.map(p => ({ id: p.id, name: p.name, ...p.health })), thresholds: L.THRESHOLDS,
      sources: ['products/stock/tanks', 'shifts.cash_gap', 'shift_anomalies', 'customers.credit_limit'] }
  });
}));

/** GET /stations/by-station?date=YYYY-MM-DD — une carte par station (jour de référence).
 *  Variante période libre : ?from=AAAA-MM-JJ&to=AAAA-MM-JJ (CA TTC, espèces et quarts cumulés sur la période, comparés à la période précédente de même durée). */
r.get('/stations/by-station', need(...ENTRY), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Réservé aux comptes clients.');
  const stations = await accessibleStations(req);
  const ids = stations.map(s => s.id);
  const range = parseRange(req.query);
  let w;
  try { w = L.windowsFor(range ? range.to : await refDate(req.query.date), range); } catch (e) { throw new HttpError(400, e.message); }
  if (!ids.length) return res.json({ as_of: w.ref, stations: [] });
  const caps = await capabilitiesByStation(req, stations);
  const [sales, cash, shifts, customers, fuel, shiftsRange] = await Promise.all([loadSales(ids, w), loadCash(ids, w), loadShifts(ids, w), loadCustomers(ids), loadFuel(ids), w.range ? loadShiftsRange(ids, w.range) : Promise.resolve(null)]);
  res.set('Cache-Control', 'no-store').json({
    as_of: w.ref,
    range: w.range ? { from: w.range[0], to: w.range[1], days: w.rangeDays, prev_from: w.rangePrev[0], prev_to: w.rangePrev[1] } : null,
    sources: { ca_ttc: 'sales (produits) + meter_readings (quarts clos) + sales carburant (quarts ouverts)', cash: "payments (method = especes)", shifts: 'shifts.shift_date', customers: 'customers.balance > 0', tanks: 'stock + tanks.capacity_liters' },
    stations: stations.map(s => {
      const c = caps.get(String(s.id)), k = String(s.id);
      const sb = salesBlock(sales.get(k), w), ca = cash.get(k) || {}, sh = shifts.get(k) || {}, cu = customers.get(k) || {};
      return {
        id: s.id, name: s.name, currency: s.currency, has_logo: s.has_logo, is_current: String(req.sid) === k,
        ca_ttc: c.sales ? (w.range ? sb.period : { value: sb.day.value, previous: sb.day.previous, variation_pct: sb.day.variation_pct }) : null,
        cash: c.sales ? (w.range ? { value: num(ca.range_cur), previous: num(ca.range_prev), variation_pct: L.variation(ca.range_cur, ca.range_prev) } : { value: num(ca.day_cur), previous: num(ca.day_prev), variation_pct: L.variation(ca.day_cur, ca.day_prev) }) : null,
        shifts: c.ops ? { today: num(sh.today), yesterday: num(sh.yesterday), ...(w.range ? { period: num((shiftsRange.get(k) || {}).n) } : {}) } : null,
        customers_balance: c.customers ? { amount: num(cu.due), customers: num(cu.n) } : null,
        tanks: c.stock ? fuel.filter(x => String(x.station_id) === k).map(({ station_id, ...t }) => t) : null
      };
    })
  });
}));

/** GET /stations/:id/logo — logo d'une station du compte (la route /images ne sert que la station courante). */
r.get('/stations/:id/logo', need(...ENTRY), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant de station invalide.');
  const allowed = (await accessibleStations(req)).some(s => Number(s.id) === id);
  if (!allowed) throw new HttpError(403, 'Accès à cette station refusé');
  const { rows: [st] } = await pool.query('SELECT photo_path FROM stations WHERE id = $1', [id]);
  const buf = st && st.photo_path ? await files.read(st.photo_path) : null;
  if (!buf) throw new HttpError(404, 'Aucune image');
  res.set('Content-Type', await files.typeOf(st.photo_path)).set('Cache-Control', 'private, max-age=60').send(buf);
}));

module.exports = { r, accessibleStations, capabilitiesByStation, moduleOn };
