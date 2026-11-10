'use strict';
// Validation d'une facture libre : quart ouvert / fermé, pompe obligatoire pour le carburant, ventes liées, stock, créance client.
// Faux client SQL scripté : on vérifie le déroulé (erreurs, écritures émises), pas le moteur SQL.
const assert = require('assert');
const Module = require('module');
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log('✓ ' + label); }

class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const calls = [];
let world;
function reset(w) { calls.length = 0; world = w; }
const client = {
  async query(sql, p = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    calls.push({ q, p });
    const hit = (s) => q.includes(s);
    if (hit('FROM invoices i LEFT JOIN customers c')) return { rows: [{ ...world.inv, customer_name: 'Transport SA' }] };
    if (hit('FROM invoice_lines')) return { rows: world.lines };
    if (hit('FROM invoice_payments')) return { rows: [] };
    if (hit('FROM products p JOIN categories')) return { rows: world.products };
    if (hit('FROM customers WHERE id')) return { rows: [{ id: 3, name: 'Transport SA', balance: 0, credit_limit: 0, active: true, credit_blocked: false }] };
    if (hit("FROM shifts WHERE station_id = $1 AND status = 'ouvert'")) return { rows: world.shift ? [world.shift] : [] };
    if (hit('FROM pumps WHERE id')) return { rows: [{ id: 7, name: 'Pompe 1' }] };
    if (hit('FROM meter_readings WHERE shift_id = $1 AND pump_id')) return { rows: [{ counter_id: 11 }] };
    if (hit('FROM pump_counters WHERE pump_id')) return { rows: [{ counter_id: 11 }] };
    if (hit('FROM stock WHERE product_id')) return { rows: [{ quantity: 500 }] };
    if (hit('FROM sale_details d JOIN sales sa')) return { rows: [{ l: 0 }] };
    if (hit('FROM employees WHERE user_id')) return { rows: world.userEmp ? [{ id: 5 }] : [] };
    if (hit('FROM employees WHERE id')) return { rows: [{ id: 5 }], rowCount: 1 };
    if (hit("kind = 'credit' AND active")) return { rows: [{ code: 'credit' }] };
    if (hit('INSERT INTO sales')) return { rows: [{ id: 100 + calls.filter(c => c.q.includes('INSERT INTO sales')).length }] };
    if (hit('SELECT index_start FROM meter_readings')) return { rows: [{ index_start: 1000 }] };
    if (hit('MAX(x.index_new)')) return { rows: [{ i: null }] };
    if (hit('FROM shift_employees')) return { rows: [{ employee_id: 5 }] };
    if (hit('TRIM(COALESCE(first_name')) return { rows: [{ id: 5, name: 'Awa Traoré' }] };
    return { rows: [], rowCount: 0 };
  }
};
const core = {
  pool: client, tx: fn => fn(client), HttpError, wrap: f => f, body: () => (req, res, next) => next(), need: () => (req, res, next) => next(),
  audit: async () => {}, settle: async () => {}, ledger: async (c, o) => { calls.push({ q: 'LEDGER', p: [o] }); }, payMethod: async () => ({}), assertLinkedMethod: async () => ({}),
  fl: n => Math.round(Number(n) * 100) / 100, f3: n => Math.round(Number(n) * 1000) / 1000,
  stockMove: async (c, o) => { calls.push({ q: 'STOCKMOVE', p: [o] }); }, recordFinancialEvent: async () => {}
};
const handlers = {};
const fakeExpress = () => { const r = {}; for (const m of ['get', 'post', 'patch']) r[m] = (path, ...h) => { handlers[m + ' ' + path] = h[h.length - 1]; }; return r; };
fakeExpress.Router = fakeExpress;
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'express') return fakeExpress;
  if (req === './core') return core;
  if (req === './safe') return { swallow: () => () => null };
  if (req === './contracts') return { loadContractForUser: async () => null, featureOn: () => true };
  if (req === './docs') return {};
  if (req === 'zod') return orig.call(this, '/opt/npm-tools/node_modules/zod', parent, ...rest);
  return orig.call(this, req, parent, ...rest);
};
require('../src/billing.js');
const issue = handlers['post /invoices/:id/issue'];
const run = async (body) => { const out = {}; await issue({ params: { id: '1' }, sid: 1, user: { id: 9, is_global: false }, body }, { json: v => { out.json = v; } }); return out; };
const fail = async (body) => { try { await run(body); } catch (e) { return e; } throw new Error('erreur attendue'); };
const base = (extra = {}) => ({ inv: { id: 1, invoice_no: 'FAC-1', status: 'brouillon', customer_id: 3, tax_rate: 0, total_ttc: 3000, amount_paid: 0, source: null, ...extra }, userEmp: true, shift: null, lines: [], products: [] });

(async () => {
  await check('sans client : refus', async () => {
    reset({ ...base({ customer_id: null }), lines: [{ id: 1, description: 'Service', quantity: 1, unit_price: 3000, amount: 3000 }] });
    assert.strictEqual((await fail({})).details.code, 'CUSTOMER_REQUIRED');
  });
  await check('quart fermé : message d’information puis validation attribuée au commanditaire, stock sorti', async () => {
    reset({ ...base(), lines: [{ id: 1, product_id: 20, description: 'Huile', quantity: 2, unit_price: 1500, amount: 3000 }], products: [{ id: 20, name: 'Huile', buy_price: 900, cat: 'LUBRIFIANT' }] });
    const e = await fail({});
    assert.strictEqual(e.details.code, 'NO_OPEN_SHIFT'); assert.ok(/commanditaire/.test(e.message) && /quart/.test(e.message));
    assert.ok(!calls.some(c => c.q === 'STOCKMOVE'), 'rien n’est écrit avant confirmation');
    await run({ no_shift_ack: true });
    const sm = calls.find(c => c.q === 'STOCKMOVE').p[0];
    assert.strictEqual(sm.qty, -2); assert.strictEqual(sm.kind, 'vente');
    const upd = calls.find(c => c.q.startsWith('UPDATE invoices SET status')).p;
    assert.strictEqual(upd[2], null, 'pas de quart'); assert.strictEqual(upd[4], 9, 'commanditaire = utilisateur'); assert.strictEqual(upd[8], 3000, 'montant compté au CA via la facture'); assert.strictEqual(upd[9], 'commanditaire');
    assert.ok(!calls.some(c => c.q.startsWith('INSERT INTO sales')), 'aucune vente sans quart');
    assert.strictEqual(calls.find(c => c.q === 'LEDGER').p[0].amount, 3000, 'créance client');
  });
  await check('carburant : la pompe est obligatoire (même sans quart)', async () => {
    reset({ ...base(), lines: [{ id: 1, product_id: 30, description: 'Gasoil', quantity: 50, unit_price: 60, amount: 3000 }], products: [{ id: 30, name: 'Gasoil', buy_price: 50, cat: 'CARBURANT' }] });
    assert.strictEqual((await fail({ no_shift_ack: true })).details.code, 'PUMP_REQUIRED');
  });
  await check('quart ouvert + produit + carburant : 2 ventes à crédit, index avancé, stock produit diminué, rattachement quart', async () => {
    reset({ ...base({ total_ttc: 6000 }), shift: { id: 4, number: 12, opened_at: new Date().toISOString() },
      lines: [{ id: 1, product_id: 20, description: 'Huile', quantity: 2, unit_price: 1500, amount: 3000 }, { id: 2, product_id: 30, description: 'Gasoil', quantity: 50, unit_price: 60, amount: 3000 }],
      products: [{ id: 20, name: 'Huile', buy_price: 900, cat: 'LUBRIFIANT' }, { id: 30, name: 'Gasoil', buy_price: 50, cat: 'CARBURANT' }] });
    await run({ pump_id: 7 });
    const sales = calls.filter(c => c.q.startsWith('INSERT INTO sales'));
    assert.strictEqual(sales.length, 2); assert.deepStrictEqual(sales.map(s => s.p[5]), ['produits', 'carburant']);
    const fd = calls.find(c => c.q.includes('INSERT INTO sale_details') && c.q.includes('index_new')).p;
    assert.strictEqual(fd[7], 11, 'compteur'); assert.strictEqual(fd[8], 1000); assert.strictEqual(fd[9], 1050, 'index avancé de 50 L');
    assert.strictEqual(calls.filter(c => c.q === 'STOCKMOVE').length, 1, 'stock : produit seulement (le carburant sort à la clôture)');
    const upd = calls.find(c => c.q.startsWith('UPDATE invoices SET status')).p;
    assert.strictEqual(upd[2], 4); assert.strictEqual(upd[5], 7); assert.strictEqual(upd[9], 'quart'); assert.strictEqual(upd[8], 0, 'tout est porté par des ventes');
    const led = calls.filter(c => c.q === 'LEDGER').map(c => c.p[0].amount); assert.deepStrictEqual(led, [3000, 3000]);
  });
  console.log(`${passed}/${passed} contrôles réussis`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
