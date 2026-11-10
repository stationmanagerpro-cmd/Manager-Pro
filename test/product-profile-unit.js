'use strict';
// Test unitaire sans base de données ni dépendances : npm run test:product-profile
// Charge src/product_profile.js avec un faux pool qui enregistre le SQL : scoping par station, permissions,
// calculs (marge, couverture, rang), masquage des coûts, historique des prix, commandes en cours, historique des stocks.
// Limite : le SQL n'est pas exécuté par PostgreSQL ici.
const Module = require('module');
const path = require('path');
const assert = require('assert');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const calls = []; let handler = () => [];
const client = { query: async (sql, params) => { calls.push({ sql, params: params || [] }); return { rows: handler(sql, params || []), rowCount: 1 }; } };
const pool = client;
const routes = {}; const audits = [];
const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
const coreStub = { pool, tx: async fn => fn(client), HttpError, wrap: f => f, body: () => ({ body: true }), need: (...perms) => ({ gate: perms }), audit: async (...a) => { audits.push(a); } };
const mkRouter = () => ({ get: (p, ...fns) => { routes['GET ' + p] = fns; }, post: (p, ...fns) => { routes['POST ' + p] = fns; } });
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && /(profile_stats|product_profile)\.js$/.test(parent.filename)) {
    if (request === 'express') return { Router: mkRouter };
    if (request === 'zod') return { z: chain };
    if (request === './core') return coreStub;
    if (request === './docs') return {};
  }
  return origLoad.apply(this, arguments);
};
const mod = require(path.join(__dirname, '..', 'src', 'product_profile.js'));
Module._load = origLoad;
const { productStats, recordPriceChange } = mod._internals;
const PS = require(path.join(__dirname, '..', 'src', 'profile_stats.js'))._internals;

let failed = 0;
const check = async (label, fn) => { try { calls.length = 0; audits.length = 0; await fn(); console.log('✔ ' + label); } catch (e) { failed++; console.log('✖ ' + label + '\n    ' + (e.stack || e).split('\n').slice(0, 3).join('\n    ')); } };
const req = (perms, extra = {}) => ({ sid: 5, user: { id: 9, perms: new Set(perms) }, query: {}, params: { id: '12' }, body: {}, ...extra });
const run = (key, rq) => { const res = { json: v => { res.body = v; return res; }, status: c => { res.code = c; return res; } }; const fns = routes[key]; return fns[fns.length - 1](rq, res).then(() => res); };
const PRODUCT = { id: 12, name: 'Huile 5L', category: 'HUILE', category_label: 'Huile', unit: 'L', buy_price: '1000.00', sell_price: '1500.00', tax_rate: '0', min_stock: '10', stock: '40', active: true, main_supplier_id: 3, supplier_name: 'Total', barcode: 'B1', sku: 'S1' };
const base = extra => (sql, params) => {
  if (/FROM products p JOIN categories/.test(sql)) return [PRODUCT];
  if (/generate_series/.test(sql)) return ['2026-09', '2026-10'].map(k => ({ k }));
  if (/AS from_date/.test(sql)) return [{ from_date: '2026-08-01', to_date: '2026-10-27' }];
  return (extra && extra(sql, params)) || [];
};
const FULL = ['price.edit', 'report.view'];

(async () => {
  await check('toutes les routes sont déclarées avec une garde de permission', () => {
    for (const k of ['GET /products/:id/profile', 'GET /products/:id/prices', 'POST /products/:id/prices', 'GET /products/:id/purchases', 'GET /products/:id/stock-history']) {
      assert.ok(routes[k], k); assert.ok(routes[k][0].gate && routes[k][0].gate.length, 'garde ' + k);
    }
    assert.deepStrictEqual(routes['POST /products/:id/prices'][0].gate, ['price.edit']);
  });

  await check('recordPriceChange : sans variation → aucune écriture', async () => {
    assert.strictEqual(await recordPriceChange(client, { station: 5, product: 12, type: 'sell', oldPrice: '1500.00', newPrice: 1500 }), false);
    assert.strictEqual(calls.length, 0);
  });
  await check('recordPriceChange : ferme la période précédente puis insère (type, ancien, nouveau prix)', async () => {
    assert.strictEqual(await recordPriceChange(client, { station: 5, product: 12, type: 'buy', oldPrice: 1000, newPrice: 1100, by: 9, note: 'x' }), true);
    assert.ok(/UPDATE price_history SET effective_to/.test(calls[0].sql) && calls[0].params.join() === '5,12,buy');
    assert.ok(/INSERT INTO price_history/.test(calls[1].sql) && calls[1].params.slice(0, 5).join() === '5,12,buy,1100,1000');
    await assert.rejects(() => recordPriceChange(client, { station: 5, product: 12, type: 'zzz', oldPrice: 1, newPrice: 2 }));
  });
  await check('recordPriceChange : création (ancien prix inconnu) → insère la ligne de départ', async () => {
    assert.strictEqual(await recordPriceChange(client, { station: 5, product: 12, type: 'sell', oldPrice: null, newPrice: 500 }), true);
    assert.strictEqual(calls[1].params[4], null);
  });

  await check('POST prix : refuse un corps vide et des prix identiques', async () => {
    handler = base();
    await assert.rejects(() => run('POST /products/:id/prices', req(['price.edit'], { body: {} })), e => e.status === 400);
    handler = (sql) => (/FOR UPDATE/.test(sql) ? [PRODUCT] : []);
    await assert.rejects(() => run('POST /products/:id/prices', req(['price.edit'], { body: { sell_price: 1500, buy_price: 1000 } })), e => e.status === 400 && /identiques/.test(e.message));
  });
  await check('POST prix : journalise vente ET achat, ne met à jour que les champs modifiés, audite', async () => {
    handler = (sql) => (/FOR UPDATE/.test(sql) ? [PRODUCT] : /UPDATE products/.test(sql) ? [{ sell_price: 1800, buy_price: 1100 }] : []);
    const res = await run('POST /products/:id/prices', req(['price.edit'], { body: { sell_price: 1800, buy_price: 1100, note: 'Hausse fournisseur' } }));
    assert.strictEqual(res.code, 201);
    const ins = calls.filter(c => /INSERT INTO price_history/.test(c.sql));
    assert.deepStrictEqual(ins.map(c => c.params[2]), ['sell', 'buy']);
    assert.ok(ins.every(c => c.params.includes('Hausse fournisseur')));
    const up = calls.find(c => /UPDATE products SET/.test(c.sql));
    assert.ok(/sell_price = \$3/.test(up.sql) && /buy_price = \$4/.test(up.sql) && up.params[0] === 12 && up.params[1] === 5);
    assert.strictEqual(audits.length, 1); assert.strictEqual(audits[0][3].startsWith('Modification de'), true);
  });
  await check('POST prix : seul le prix de vente modifié → un seul enregistrement', async () => {
    handler = (sql) => (/FOR UPDATE/.test(sql) ? [PRODUCT] : /UPDATE products/.test(sql) ? [{ sell_price: 1600, buy_price: 1000 }] : []);
    await run('POST /products/:id/prices', req(['price.edit'], { body: { sell_price: 1600 } }));
    assert.strictEqual(calls.filter(c => /INSERT INTO price_history/.test(c.sql)).length, 1);
    assert.ok(!/buy_price = /.test(calls.find(c => /UPDATE products SET/.test(c.sql)).sql));
  });
  await check('identifiant invalide → 400 ; produit d\'une autre station → 404', async () => {
    handler = base();
    await assert.rejects(() => run('GET /products/:id/profile', req(FULL, { params: { id: 'abc' } })), e => e.status === 400);
    handler = () => [];
    await assert.rejects(() => run('GET /products/:id/prices', req(FULL)), e => e.status === 404);
  });

  await check('profil : KPIs (quantité, CA, marge, couverture, rang, part) et scoping station', async () => {
    handler = base((sql) => {
      if (/COALESCE\(SUM\(d\.quantity\) FILTER/.test(sql)) return [{ qty: '90', revenue: '135000', cost: '90000', tickets: 30, first_at: '2026-08-02', last_at: '2026-10-25' }];
      if (/WITH per AS/.test(sql)) return [{ total_revenue: '540000', n_products: 8, rank: 2, sold: true }];
      if (/SUM\(d\.quantity\) AS qty, SUM\(d\.amount\) AS revenue, SUM\(d\.quantity \* d\.unit_cost\)/.test(sql)) return [{ month: '2026-10', qty: '60', revenue: '90000', cost: '60000' }];
      if (/FROM purchase_details d JOIN purchases pu ON pu.id = d.purchase_id\s+WHERE pu.station_id = \$1 AND d.product_id = \$2 AND pu.status IN/.test(sql)) return [{ n: 2, qty: '15' }];
      return [];
    });
    const s = await productStats(req(FULL), 12, PS.periodOf({ query: { period: '3m' } }));
    assert.strictEqual(s.kpis.qty_sold, 90); assert.strictEqual(s.kpis.revenue, 135000); assert.strictEqual(s.kpis.margin_total, 45000);
    assert.strictEqual(s.kpis.margin_total_pct, 33.3); assert.strictEqual(s.kpis.margin_unit, 500); assert.strictEqual(s.kpis.margin_pct, 33.3);
    assert.strictEqual(s.kpis.share_pct, 25); assert.strictEqual(s.kpis.rank, 2); assert.strictEqual(s.kpis.open_orders, 2); assert.strictEqual(s.kpis.open_qty, 15);
    assert.ok(s.kpis.days_cover > 0 && s.kpis.stock === 40 && s.kpis.low === false && s.kpis.stock_value_buy === 40000);
    assert.strictEqual(s.monthly.length, 2); assert.strictEqual(s.monthly[1].qty, 60);
    const sql = calls.filter(c => /FROM (sale_details|stock_movements|purchase_details)/.test(c.sql));
    assert.ok(sql.length >= 8 && sql.every(c => c.params[0] === 5), 'chaque requête de données est filtrée par la station');
  });
  await check('profil : sans droit sur les coûts → marge, valeur d\'achat et coûts masqués', async () => {
    handler = base((sql) => /COALESCE\(SUM\(d\.quantity\) FILTER/.test(sql) ? [{ qty: '10', revenue: '15000', cost: '10000', tickets: 5 }] : /SUM\(d\.quantity \* d\.unit_cost\)/.test(sql) && /GROUP BY 1/.test(sql) ? [{ month: '2026-10', qty: '10', revenue: '15000', cost: '10000' }] : []);
    const s = await productStats(req(['sale.create']), 12, PS.periodOf({ query: {} }));
    assert.strictEqual(s.kpis.margin_total, null); assert.strictEqual(s.kpis.margin_unit, null); assert.strictEqual(s.kpis.stock_value_buy, null);
    assert.ok(s.monthly.every(m => m.cost === null));
    assert.ok(s.kpis.revenue === 15000, 'le chiffre d\'affaires reste visible');
  });
  await check('profil : stock sous le seuil, aucune vente → rang null, couverture null', async () => {
    handler = (sql, p) => base()(sql, p).map(r => r) || [];
    handler = (sql) => (/FROM products p JOIN categories/.test(sql) ? [{ ...PRODUCT, stock: '3' }] : base()(sql));
    const s = await productStats(req(FULL), 12, PS.periodOf({ query: {} }));
    assert.strictEqual(s.kpis.low, true); assert.strictEqual(s.kpis.rank, null); assert.strictEqual(s.kpis.days_cover, null);
  });

  await check('achats : commande en cours = commandé/partiel avec reste à livrer ; livré, annulé → pas en cours', async () => {
    const L = (id, status, o, r) => ({ detail_id: id, purchase_id: id, order_no: 'BC-' + id, status, ordered_at: new Date(Date.now() - 3 * 864e5).toISOString(), supplier_id: 3, supplier: 'Total', qty_ordered: o, qty_received: r, unit_cost: '1000' });
    handler = (sql) => (/FROM products p JOIN categories/.test(sql) ? [PRODUCT] : [L(1, 'commande', '20', '0'), L(2, 'partiel', '20', '5'), L(3, 'recu', '20', '20'), L(4, 'annule', '20', '0'), L(5, 'partiel', '10', '10')]);
    const res = await run('GET /products/:id/purchases', req(FULL));
    const open = res.body.lines.filter(l => l.open).map(l => l.detail_id);
    assert.deepStrictEqual(open, [1, 2]);
    assert.strictEqual(res.body.lines[1].qty_remaining, 15); assert.strictEqual(res.body.lines[1].waiting_days, 3);
    assert.strictEqual(res.body.summary.open_count, 2); assert.strictEqual(res.body.summary.open_qty, 35);
    assert.strictEqual(res.body.summary.orders, 4, 'les commandes annulées ne comptent pas'); assert.strictEqual(res.body.summary.avg_cost, 1000);
    // la même commande, une fois entièrement livrée, n'est plus « en cours »
    handler = (sql) => (/FROM products p JOIN categories/.test(sql) ? [PRODUCT] : [L(1, 'recu', '20', '20'), L(2, 'recu', '20', '20')]);
    const after = await run('GET /products/:id/purchases', req(FULL));
    assert.strictEqual(after.body.summary.open_count, 0);
    assert.ok(calls.some(c => /pu\.station_id = \$1 AND d\.product_id = \$2/.test(c.sql) && c.params[0] === 5));
  });

  await check('historique des stocks : filtres validés (type, dates), limite bornée, solde après mouvement, références', async () => {
    handler = (sql) => (/FROM products p JOIN categories/.test(sql) ? [PRODUCT] : /WITH m AS/.test(sql) ? [
      { id: 9, kind: 'achat', quantity: '20', balance_after: '40', created_at: '2026-10-20', login: 'mod', order_no: 'BC-5-00009', ref_table: 'purchases', ref_id: 9 },
      { id: 8, kind: 'perte', quantity: '-2', balance_after: '20', created_at: '2026-10-19', comment: 'fuite', ref_table: null }
    ] : [{ kind: 'achat', n: 1, qty: '20', qty_in: '20', qty_out: '0' }, { kind: 'perte', n: 1, qty: '-2', qty_in: '0', qty_out: '2' }]);
    const res = await run('GET /products/:id/stock-history', req(FULL, { query: { kind: "vente'; DROP TABLE x;--", from: '2026-10-01', to: 'pas-une-date', limit: '99999' } }));
    const main = calls.find(c => /WITH m AS/.test(c.sql));
    assert.ok(!/DROP/.test(main.sql) && !/x\.kind = /.test(main.sql), 'type inconnu ignoré');
    assert.ok(/x\.created_at >= \$3::date/.test(main.sql) && !/\$4/.test(main.sql), 'seule la date valide est retenue');
    assert.ok(/LIMIT 500\b/.test(main.sql));
    assert.strictEqual(res.body.rows[0].ref.label, 'BC-5-00009'); assert.strictEqual(res.body.rows[1].quantity, -2);
    assert.strictEqual(res.body.by_kind.find(k => k.kind === 'perte').qty_out, 2);
    const typed = await run('GET /products/:id/stock-history', req(FULL, { query: { kind: 'perte' } }));
    assert.ok(/x\.kind = \$3/.test(calls.filter(c => /WITH m AS/.test(c.sql)).pop().sql));
    assert.ok(typed.body.rows.length === 2);
  });

  await check('historique des prix : variation et pourcentage calculés, droit de modification exposé', async () => {
    handler = (sql) => (/FROM products p JOIN categories/.test(sql) ? [PRODUCT] : [
      { id: 2, price_type: 'sell', price: '1500', old_price: '1200', effective_from: '2026-10-01', effective_to: null, login: 'mod', note: 'hausse' },
      { id: 1, price_type: 'sell', price: '1200', old_price: null, effective_from: '2026-08-01', effective_to: '2026-10-01', login: null, note: null }]);
    const r1 = await run('GET /products/:id/prices', req(FULL));
    assert.strictEqual(r1.body.history[0].delta, 300); assert.strictEqual(r1.body.history[0].delta_pct, 25); assert.strictEqual(r1.body.history[1].delta, null);
    assert.strictEqual(r1.body.can_edit, true); assert.strictEqual(r1.body.margin_unit, 500);
    const r2 = await run('GET /products/:id/prices', req(['report.view']));
    assert.strictEqual(r2.body.can_edit, false);
  });

  console.log(failed ? `\n${failed} test(s) en échec` : '\nTous les tests de la fiche produit (API) passent.');
  process.exit(failed ? 1 : 0);
})();
