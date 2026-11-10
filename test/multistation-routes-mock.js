// Test des routeurs « vue consolidée / par station / archivage » avec doublures (sans base ni express) :
// valide l'assemblage des réponses, le masquage selon les droits et le contenu de l'archive. Le SQL n'est PAS exécuté ici.
// node test/multistation-routes-mock.js
const assert = require('assert'), Module = require('module'), path = require('path'), zlib = require('zlib');
const routes = {}; const queries = [];
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
const fakeRouter = () => ({ get: (p, ...h) => { routes[p] = h; } });
const rows = (sql) => {
  const has = s => sql.includes(s);
  if (has('FROM stations s') && has('user_stations')) return [{ id: '1', name: 'Shell Maarif', currency: 'FCFA', has_logo: false }, { id: '2', name: 'Afriquia', currency: 'FCFA', has_logo: true }];
  if (has('station_permission_caps')) return [];
  if (has('CURRENT_DATE')) return [{ d: '2025-08-21' }];
  if (has('WITH ev AS') && has('day_cur')) return [{ station_id: '1', day_cur: 171000, day_prev: 150000, week_cur: 800000, week_prev: 700000, month_cur: 4e6, month_prev: 0, year_cur: 3e7, d7: 1e6 }, { station_id: '2', day_cur: 123000, day_prev: 125000, week_cur: 500000, week_prev: 600000, month_cur: 3e6, month_prev: 3.2e6, year_cur: 2e7, d7: 8e5 }];
  if (has('WITH ev AS') && has('AS ht')) return [{ station_id: '1', ht: 3000000 }, { station_id: '2', ht: 1000000 }];
  if (has('FROM payments pm') && has('day_cur')) return [{ station_id: '1', day_cur: 85500, day_prev: 78000 }];
  if (has('FROM shifts') && has('oldest_open_h')) return [{ station_id: '1', today: 3, yesterday: 3, prev7: 10, oldest_open_h: 5, gap7: 100 }];
  if (has('shift_anomalies') && has('COUNT(*)::int AS n')) return [];
  if (has('FROM customers WHERE')) return [{ station_id: '1', due: 1225000, n: 40, over_limit: 0 }, { station_id: '2', due: 879000, n: 77, over_limit: 1 }];
  if (has('FROM suppliers WHERE')) return [{ station_id: '1', due: 500000, n: 2 }];
  if (has("cat.code = 'CARBURANT'") && has('AS capacity')) return [{ station_id: '1', id: 10, name: 'Gasoil', unit: 'L', book: 6000, min_stock: 500, capacity: 10000, pending: 1000 }, { station_id: '2', id: 11, name: 'Super Sans Plomb', unit: 'L', book: 100, min_stock: 0, capacity: 0, pending: 0 }];
  if (has('cat.code <> \'CARBURANT\'')) return [{ station_id: '1', n: 2 }];
  if (has('gap AS (')) return [{ name: 'Gasoil', gap_l: 246, sold_l: 123000 }, { name: 'Super', gap_l: -157, sold_l: 8722 }];
  if (has('SELECT name FROM stations')) return [{ name: 'Shell Maarif' }];
  if (has('COUNT(DISTINCT d)')) return [{ n: 20 }];
  if (has('COUNT(*)::int AS n FROM') || has(')::int AS n')) return [{ n: 5 }];
  if (has('ofn')) return [];
  return [];
};
const pool = { query: async (sql, p) => { queries.push(sql); return { rows: rows(sql) }; } };
const stubs = {
  express: { Router: fakeRouter },
  './core': { pool, wrap: f => f, need: () => (q, s, n) => n(), HttpError, audit: async () => {} },
  './contracts': { featureOn: () => true },
  './files': { read: async () => null, typeOf: async () => 'image/png' },
  './exports': { KINDS: { expenses: { label: 'Dépenses' }, sales: { label: 'Ventes' }, shifts: { label: 'Quarts' }, cash: { label: 'Caisse' }, stock: { label: 'Stocks' } }, allowed: () => true, loadDataset: async () => ({ head: ['a', 'b'], rows: [['x', 1]], sumCols: [1] }) },
  './billing': { buildInvoicePdf: async () => Buffer.from('PDF:FACTURE') },
  './docs': { branding: async () => ({ name: 'Shell Maarif', currency: 'FCFA' }), buildXlsx: async () => { throw new Error('Excel interdit dans l\'archive'); }, buildPdf: async o => Buffer.from('PDF:' + o.title), csv: () => '' }
};
const orig = Module._load;
Module._load = function (req, parent, ...r) { if (stubs[req]) return stubs[req]; return orig.call(this, req, parent, ...r); };
process.chdir(path.join(__dirname, '..'));
const mv = require('../src/multistation_views'), ar = require('../src/monthly_archive');
const mkReq = (perms, extra = {}) => ({ user: { id: 7, login: 'u', is_global: false, perms: new Set(perms) }, sid: 1, query: {}, params: {}, contract: { unrestricted: true }, ...extra });
const mkRes = () => ({ headers: {}, body: null, set(a, b) { Object.assign(this.headers, typeof a === 'object' ? a : { [a]: b }); return this; }, json(x) { this.body = x; return this; }, send(x) { this.body = x; return this; } });
const call = async (p, req) => { const res = mkRes(); await routes[p][routes[p].length - 1](req, res); return res; };
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('✔', name); };

(async () => {
  await ok('consolidée : CA, variations, créances, dettes, jaugeage, répartition HT, santé', async () => {
    const d = (await call('/stations/consolidated', mkReq(['report.view', 'finance.view', 'customer.view', 'supplier.view', 'stock.adjust', 'shift.open']))).body;
    assert.strictEqual(d.as_of, '2025-08-21'); assert.strictEqual(d.ca_ttc.day.value, 294000); assert.strictEqual(d.ca_ttc.day.previous, 275000);
    assert.strictEqual(d.ca_ttc.month.variation_pct, 118.75);   // (4 M + 3 M) vs 3,2 M
    assert.strictEqual(d.receivables.amount, 2104000); assert.strictEqual(d.receivables.customers, 117); assert.strictEqual(d.payables.suppliers, 2);
    assert.strictEqual(d.gauging.items[1].pct_of_sales, -1.8); assert.deepStrictEqual(d.ht_share.items.map(x => x.pct), [75, 25]);
    const h = d.health.stations; assert.strictEqual(h.length, 2); assert.ok(h[0].stock && h[0].finance && h[0].ops);
    assert.strictEqual(h[0].finance.level, 'ok'); assert.strictEqual(h[1].finance.level, 'warn', 'client au-delà du plafond');
    assert.strictEqual(h[0].stock.level, 'warn'); // 5000/10000 = 50 % ok, mais 2 produits sous seuil => warn
  });
  await ok('droits : sans finance/customer/supplier/stock → rubriques masquées (null), pas de fuite', async () => {
    const d = (await call('/stations/consolidated', mkReq(['report.view']))).body;
    assert.ok(d.ca_ttc); assert.strictEqual(d.receivables, null); assert.strictEqual(d.payables, null);
    assert.ok(d.health.stations.every(s => s.finance === null));
  });
  await ok('sans droit de CA : tout est masqué', async () => {
    const d = (await call('/stations/consolidated', mkReq(['user.manage']))).body;
    assert.strictEqual(d.ca_ttc, null); assert.strictEqual(d.ht_share, null); assert.strictEqual(d.gauging, null);
  });
  await ok('Super Admin : refus', async () => {
    const req = mkReq(['report.view']); req.user.is_global = true;
    await assert.rejects(() => call('/stations/consolidated', req), e => e.status === 403);
  });
  await ok('contrat sans module Ventes ni Finance : créances masquées', async () => {
    const off = Module._load; stubs['./contracts'] = { featureOn: (c, k) => !/finance|sales/.test(k) };
    delete require.cache[require.resolve('../src/multistation_views')]; const r = require('../src/multistation_views');
    const d = (await call('/stations/consolidated', mkReq(['report.view', 'finance.view', 'customer.view'], { contract: { unrestricted: false } }))).body;
    assert.strictEqual(d.receivables, null); stubs['./contracts'] = { featureOn: () => true };
  });
  await ok('par station : cartes, variations, jauges sans capacité = null', async () => {
    delete require.cache[require.resolve('../src/multistation_views')]; require('../src/multistation_views');
    const d = (await call('/stations/by-station', mkReq(['report.view', 'finance.view', 'customer.view', 'stock.adjust', 'shift.open']))).body;
    const s1 = d.stations[0], s2 = d.stations[1];
    assert.strictEqual(s1.ca_ttc.value, 171000); assert.strictEqual(s1.ca_ttc.variation_pct, 14); assert.strictEqual(s1.cash.value, 85500);
    assert.deepStrictEqual(s1.shifts, { today: 3, yesterday: 3 }); assert.strictEqual(s1.tanks[0].quantity, 5000); assert.strictEqual(s1.tanks[0].level_pct, 50);
    assert.strictEqual(s2.tanks[0].level_pct, null, 'capacité non renseignée : pas de niveau inventé'); assert.strictEqual(s2.tanks[0].short, 'SSP');
  });
  await ok('par station : période libre (du … au …) → CA/espèces/quarts de la période, dates invalides refusées', async () => {
    const full = ['report.view', 'finance.view', 'customer.view', 'stock.adjust', 'shift.open'];
    queries.length = 0;
    const d = (await call('/stations/by-station', mkReq(full, { query: { from: '2025-08-01', to: '2025-08-21' } }))).body;
    assert.strictEqual(d.range.days, 21); assert.strictEqual(d.range.prev_from, '2025-07-11'); assert.strictEqual(d.as_of, '2025-08-21');
    const s1 = d.stations[0];
    assert.ok(s1.ca_ttc && 'value' in s1.ca_ttc && 'previous' in s1.ca_ttc, 'CA de la période'); assert.ok(s1.cash && 'previous' in s1.cash);
    assert.strictEqual(typeof s1.shifts.period, 'number', 'quarts de la période');
    assert.ok(queries.some(q => q.includes('range_cur') && q.includes('range_prev') && q.includes('FROM payments pm')), 'espèces : colonnes période');
    assert.ok(queries.some(q => q.includes('FROM shifts') && q.includes('shift_date >= $2::date AND shift_date <= $3::date')), 'quarts : bornes Du/Au');
    const day = (await call('/stations/by-station', mkReq(full))).body; assert.strictEqual(day.range, null); assert.strictEqual(day.stations[0].shifts.period, undefined);
    for (const bad of [{ from: '2025-08-01' }, { from: '2025-08-22', to: '2025-08-21' }, { from: "2025-08-01'; DROP TABLE x;--", to: '2025-08-21' }, { from: '2000-01-01', to: '2025-08-21' }]) {
      await assert.rejects(() => call('/stations/by-station', mkReq(full, { query: bad })), e => e.status === 400, JSON.stringify(bad));
    }
  });
  await ok('SQL : toute requête de vue est bornée par station (ANY ids) ou compte', async () => {
    for (const sql of queries) if (/FROM (sales|customers|suppliers|shifts|payments|products)\b/.test(sql)) assert.ok(/station_id = ANY|station_id = \$1|p\.station_id = ANY|sa\.station_id = ANY|sh\.station_id = ANY|pm\.station_id = ANY|WHERE us\.user_id|user_stations/.test(sql), 'requête sans filtre de station : ' + sql.slice(0, 90));
  });
  await ok('archive : récapitulatif par dossier et droits', async () => {
    const req = mkReq(['report.view', 'finance.view', 'purchase.manage', 'expense.create', 'sale.create']); req.query.month = '2025-08';
    const d = (await call('/exports/archive/monthly/summary', req)).body;
    assert.strictEqual(d.folders.length, 6); assert.ok(d.folders.every(f => f.available)); assert.strictEqual(d.folders[0].count, 20);
    const r2 = mkReq(['report.view']); r2.query.month = '2025-08'; const d2 = (await call('/exports/archive/monthly/summary', r2)).body;
    assert.deepStrictEqual(d2.folders.filter(f => f.available).map(f => f.key), ['days', 'customers', 'misc']);   // billing.js VIEW inclut report.view
  });
  await ok('archive : mois invalide refusé (injection)', async () => {
    const req = mkReq(['report.view']); req.query.month = "2025-08'; DROP TABLE sales;--";
    await assert.rejects(() => call('/exports/archive/monthly', req), e => e.status === 400);
  });
  await ok('archive : ZIP valide avec LISEZ-MOI, INDEX et 6 dossiers', async () => {
    const req = mkReq(['report.view', 'finance.view', 'purchase.manage', 'expense.create', 'sale.create']); req.query.month = '2025-08';
    const res = await call('/exports/archive/monthly', req); const zip = res.body;
    assert.strictEqual(res.headers['Content-Type'], 'application/zip'); assert.ok(/Archive_Shell_Maarif_2025-08\.zip/.test(res.headers['Content-Disposition']));
    const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6])), cnt = zip.readUInt16LE(eocd + 10); let p = zip.readUInt32LE(eocd + 16); const names = [];
    for (let i = 0; i < cnt; i++) { const nl = zip.readUInt16LE(p + 28); names.push(zip.slice(p + 46, p + 46 + nl).toString()); p += 46 + nl; }
    assert.ok(names.includes('LISEZ-MOI.txt') && names.includes('INDEX_ARCHIVE.csv'));
    const bad = names.filter(x => !/^(LISEZ-MOI\.txt|INDEX_ARCHIVE\.csv)$/.test(x) && !/\.pdf$/.test(x) && !/\/Justificatifs\//.test(x));
    assert.deepStrictEqual(bad, [], 'fichiers non PDF dans l\'archive : ' + bad);
    assert.ok(names.some(x => /04_Factures_des_depenses\/Journal_des_depenses_2025-08\.pdf/.test(x)) && names.some(x => /06_Rapports_divers\/Ventes_2025-08\.pdf/.test(x)));
    for (const f of ['01_Rapports_des_journees', '02_Factures_des_achats', '03_Factures_clients', '04_Factures_des_depenses', '05_Rapports_transactions_tiers', '06_Rapports_divers']) assert.ok(names.some(x => x.startsWith(f + '/')), 'dossier manquant ' + f);
  });
  await ok('consolidée : période libre (du … au …) → bloc period, plafonds et dates invalides refusés', async () => {
    const full = ['report.view', 'finance.view', 'customer.view', 'supplier.view', 'stock.adjust', 'shift.open'];
    const d = (await call('/stations/consolidated', mkReq(full, { query: { from: '2025-08-01', to: '2025-08-21' } }))).body;
    assert.strictEqual(d.as_of, '2025-08-21'); assert.strictEqual(d.range.days, 21); assert.strictEqual(d.range.prev_from, '2025-07-11');
    assert.ok(d.ca_ttc.period && d.ca_ttc.period.value === 0, 'bloc period présent');
    assert.ok(queries.some(q => q.includes('range_cur') && q.includes('range_prev')));
    for (const bad of [{ from: '2025-08-01' }, { from: '2025-08-22', to: '2025-08-21' }, { from: '2025-13-01', to: '2025-08-21' }, { from: "2025-08-01'; DROP TABLE x;--", to: '2025-08-21' }, { from: '2000-01-01', to: '2025-08-21' }]) {
      await assert.rejects(() => call('/stations/consolidated', mkReq(full, { query: bad })), e => e.status === 400, JSON.stringify(bad));
    }
    assert.strictEqual((await call('/stations/consolidated', mkReq(full))).body.range, null);
  });
  console.log(`\n${n}/${n} tests réussis.`);
})().catch(e => { console.error('✖', e); process.exit(1); });
