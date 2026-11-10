// Test du module d'agrégats avec doublures (sans base : le SQL n'est PAS exécuté ici).
// Vérifie : catalogue complet (chaque indicateur a formule + sources), assemblage, dérivés, variations, droits, périodes invalides.
// node test/aggregates-mock.js
const assert = require('assert'), Module = require('module'), path = require('path');
const routes = {}; const queries = [];
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const rows = sql => {
  const tag = (/\/\*agg:(\w+)\*\//.exec(sql) || [])[1];
  if (sql.includes('CURRENT_DATE::text')) return [{ d: '2026-11-03', m: '2026-11-01' }];
  if (sql.includes('FROM stations WHERE id')) return [{ id: '1', name: 'RUE SOUNDIATA', currency: 'FCFA' }];
  const T = {
    sales: [{ station_id: '1', tx_n: 10, sales_total: 100000, shop_total: 40000, cancel_n: 1, cancel_total: 5000 }],
    fuel: [{ station_id: '1', fuel_total: 60000, liters: 90 }],
    pay: [{ station_id: '1', pay_especes: 70000, pay_carte: 0, pay_mobile_money: 10000, pay_credit: 20000, pay_autre: 0 }],
    margin: [{ station_id: '1', margin_ht: 8000, margin_base_ht: 40000, cost_lines: 5, lines: 10 }],
    ops: [{ station_id: '1', shifts_closed: 3, shifts_open: 1, cash_gap_net: -500, cash_gap_abs: 700, shift_hours: 24, shift_hours_n: 3 }],
    anomalies: [{ station_id: '1', anomalies_n: 2 }],
    expenses: [{ station_id: '1', expenses_total: 15000, expenses_n: 4 }],
    supplier_paid: [{ station_id: '1', supplier_paid: 9000 }], customer_collected: [{ station_id: '1', customer_collected: 3000 }],
    purchases: [{ station_id: '1', purchases_total: 50000, purchases_n: 4, purchases_received_n: 3, purchases_pending_n: 1 }],
    payables: [{ station_id: '1', payables: 12000 }], overdue: [{ station_id: '1', overdue_amount: 4000, overdue_n: 1 }],
    customers: [{ station_id: '1', receivables: 8000, receivables_n: 3, over_limit_n: 0 }], stock: [{ station_id: '1', low_stock_n: 2, stock_value: 250000 }]
  };
  return T[tag] || [];
};
const pool = { query: async (sql, p) => { queries.push({ sql, p }); return { rows: rows(sql) }; } };
const mvStub = { accessibleStations: async () => [{ id: '1', name: 'A', currency: 'FCFA' }, { id: '2', name: 'B', currency: 'FCFA' }],
  capabilitiesByStation: async (req, st) => new Map(st.map(s => [String(s.id), req.caps || { sales: true, customers: true, suppliers: true, stock: true, finance: true, ops: true }])) };
const stubs = { express: { Router: () => ({ get: (p, ...h) => { routes[p] = h; } }) }, './core': { pool, wrap: f => f, need: () => (q, s, n) => n(), HttpError }, './multistation_views': mvStub };
const orig = Module._load; Module._load = function (req, parent, ...r) { if (stubs[req]) return stubs[req]; return orig.call(this, req, parent, ...r); };
process.chdir(path.join(__dirname, '..'));
const A = require('../src/aggregates');
const mkRes = () => ({ body: null, set() { return this; }, json(x) { this.body = x; return this; } });
const call = async req => { const res = mkRes(); await routes['/aggregates'][routes['/aggregates'].length - 1]({ user: { id: 7, is_global: false, perms: new Set(['report.view']) }, sid: 1, query: {}, ...req }, res); return res.body; };
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('✔', name); };
(async () => {
  await ok('catalogue : clés uniques, formule, au moins une source, unité et domaine valides', () => {
    const keys = A.CATALOG.map(e => e.key); assert.strictEqual(new Set(keys).size, keys.length); assert.ok(keys.length >= 40, 'au moins 40 agrégats');
    for (const e of A.CATALOG) { assert.ok(e.formula && e.sources.length, 'sans source : ' + e.key); assert.ok(['money', 'count', 'liters', 'pct', 'hours'].includes(e.unit), e.key); assert.ok(A.DOMAIN_FIELDS[e.domain], e.key); assert.ok(e.group && e.label, e.key); }
    assert.ok(A.CATALOG_META.every(e => typeof e.get === 'undefined'), 'aucune fonction exposée');
  });
  await ok('station courante : valeurs, dérivés (panier moyen, taux, marge) et sources renvoyées', async () => {
    const d = await call({});
    assert.deepStrictEqual([d.period.from, d.period.to, d.period.days], ['2026-11-01', '2026-11-03', 3]);
    assert.strictEqual(d.total.ca_ttc.value, 100000); assert.strictEqual(d.total.avg_basket.value, 10000); assert.strictEqual(d.total.liters.value, 90);
    assert.ok(Math.abs(d.total.cancel_rate_pct.value - (1 / 11) * 100) < 1e-9);
    assert.strictEqual(d.total.margin_pct.value, 20); assert.strictEqual(d.total.cost_coverage_pct.value, 50); assert.strictEqual(d.total.credit_share_pct.value, 20);
    assert.strictEqual(d.total.shift_avg_h.value, 8); assert.strictEqual(d.total.avg_daily_ca.value, 100000 / 3);
    assert.strictEqual(d.total.payables.value, 12000); assert.strictEqual(d.total.payables.previous, undefined, 'situation à ce jour : pas de période précédente');
    assert.strictEqual(d.stations.length, 1); assert.strictEqual(d.stations[0].values.tx_n, 10);
    assert.ok(d.catalog.find(e => e.key === 'margin_ht').sources.some(s => /sale_details/.test(s)));
  });
  await ok('variation vs période précédente de même durée (valeurs doublées en N-1 → 0 % ici, bornes correctes)', async () => {
    const d = await call({ query: { from: '2026-10-20', to: '2026-10-29' } });
    assert.deepStrictEqual([d.period.days, d.period.prev_from, d.period.prev_to], [10, '2026-10-10', '2026-10-19']);
    assert.strictEqual(d.total.ca_ttc.variation.value, 0); assert.strictEqual(d.total.shop_share_pct.variation.kind, 'pts');
  });
  await ok('droits : domaine masqué → indicateurs absents et compté dans hidden', async () => {
    const d = await call({ query: { scope: 'all' }, caps: { sales: true, customers: false, suppliers: false, stock: false, finance: false, ops: false } });
    assert.ok(d.total.ca_ttc && !('receivables' in d.total) && !('expenses_total' in d.total) && !('low_stock_n' in d.total));
    assert.deepStrictEqual(d.hidden, { ops: 2, finance: 2, suppliers: 2, customers: 2, stock: 2 });
    assert.strictEqual(d.stations, undefined, 'détail par station seulement sur demande (by_station=1)');
  });
  await ok('consolidé : 2 stations (la 2e sans données = zéros), ratios recalculés sur les sommes', async () => {
    const d = await call({ query: { scope: 'all', by_station: '1' } });
    assert.strictEqual(d.stations.length, 2); assert.strictEqual(d.total.tx_n.value, 10); assert.strictEqual(d.stations[1].values.tx_n, 0);
    assert.strictEqual(d.total.avg_basket.value, 10000, 'ratio recalculé sur les sommes, pas moyenné');
  });
  await ok('périodes invalides refusées (une seule date, inversées, injection, trop longue) ; SQL borné par stations', async () => {
    for (const bad of [{ from: '2026-11-01' }, { from: '2026-11-04', to: '2026-11-03' }, { from: "2026-11-01'; DROP TABLE x;--", to: '2026-11-03' }, { from: '2000-01-01', to: '2026-11-03' }])
      await assert.rejects(() => call({ query: bad }), e => e.status === 400, JSON.stringify(bad));
    const agg = queries.filter(q => q.sql.includes('/*agg:')); assert.ok(agg.length >= 14);
    assert.ok(agg.every(q => q.sql.includes('ANY($1::bigint[])')), 'toute requête bornée par les stations');
    assert.ok(agg.every(q => !/\$\d[^:]*'\s*\+/.test(q.sql)) && agg.every(q => Array.isArray(q.p) && Array.isArray(q.p[0])));
  });
  console.log(`\n${n}/${n} tests réussis.`);
})().catch(e => { console.error('✖', e); process.exit(1); });
