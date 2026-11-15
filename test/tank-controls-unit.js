'use strict';
// Contrôles de cuve : tolérance par station, blocage optionnel de la clôture, écart de livraison (jauge avant/après), récidive par employé.
// Le vrai code est exécuté ; seule la base est simulée (core.js remplacé).
const assert = require('assert'), Module = require('module'), fs = require('fs');
let n = 0; const check = async (l, fn) => { await fn(); n++; console.log('✓ ' + l); };
const settings = {};
const fakeCore = { pool: {}, HttpError: class extends Error {}, wrap: f => f, body: () => (q, s, nx) => nx && nx(), need: () => (q, s, nx) => nx && nx(), audit: async () => {},
  setting: async (_c, _sid, key, def) => (key in settings ? settings[key] : def) };
const orig = Module._load;
const fakeRouter = () => { const r = {}; for (const m of ['get', 'post', 'put', 'patch', 'delete', 'use']) r[m] = () => r; return r; };
const chain = () => new Proxy(function () {}, { get: (_t, k) => (k === 'then' ? undefined : chain()), apply: () => chain() });
Module._load = function (req, parent, ...a) { if (req === 'zod' && parent && /tanks\.js$/.test(parent.filename)) return { z: chain() }; if (req === 'express') { const e = () => fakeRouter(); e.Router = fakeRouter; return e; } if (req === './core' && parent && /tanks\.js$/.test(parent.filename)) return fakeCore; return orig.call(this, req, parent, ...a); };
const L = require('../src/tank_logic'); const tanks = require('../src/tanks'); const { recurrence } = require('../src/gap_recurrence');
Module._load = orig;

(async () => {
  await check('tolérance : réglage station prioritaire, sinon défaut 0,5 %, valeurs invalides ignorées', () => {
    assert.strictEqual(L.resolveTolerancePct(1.2, {}), 1.2); assert.strictEqual(L.resolveTolerancePct(null, {}), 0.5);
    assert.strictEqual(L.resolveTolerancePct(0, {}), 0.5); assert.strictEqual(L.resolveTolerancePct('abc', {}), 0.5); assert.strictEqual(L.resolveTolerancePct(-2, {}), 0.5);
  });
  await check('la tolérance de la station change le niveau d\'un même écart', () => {
    const t = [{ id: 1, name: 'C1', opening: 10000, closing: 15975 }];
    assert.strictEqual(L.reconcileProduct({ tanks: t, received: 10000, pumped: 4000, tolPct: 0.5 }).level, 'warning');
    assert.strictEqual(L.reconcileProduct({ tanks: t, received: 10000, pumped: 4000, tolPct: 1 }).level, 'ok');
  });
  await check('mode de blocage : défaut off ; valeur inconnue = off', () => {
    assert.strictEqual(L.blockMode(undefined), 'off'); assert.strictEqual(L.blockMode('xx'), 'off'); assert.strictEqual(L.blockMode('critical'), 'critical');
    const ps = [{ level: 'ok' }, { level: 'warning' }, { level: 'critical' }];
    assert.strictEqual(L.blockingProducts(ps, 'off').length, 0); assert.strictEqual(L.blockingProducts(ps, 'critical').length, 1); assert.strictEqual(L.blockingProducts(ps, 'warning').length, 2);
  });
  const fakeClient = rows => ({ query: async sql => (/FROM tanks t/.test(sql) ? { rows: rows.tanks } : { rows: rows.mv || [] }) });
  const base = { from: new Date('2026-11-01T06:00:00Z'), to: new Date('2026-11-01T14:00:00Z') };
  await check('clôture : mode off → aucun contrôle ni blocage', async () => {
    settings.tank_close_block = 'off';
    const r = await tanks.tankCloseCheck(fakeClient({ tanks: [] }), 1, { ...base, pumpedByProduct: {}, mode: 'off' });
    assert.strictEqual(r.mode, 'off'); assert.strictEqual(r.blocking.length, 0);
  });
  await check('clôture : écart critique + mode critical → blocage', async () => {
    const tk = [{ id: 1, name: 'C1', product_id: 7, product_name: 'Gasoil', opening: 10000, closing: 5000 }];
    const r = await tanks.tankCloseCheck(fakeClient({ tanks: tk }), 1, { ...base, pumpedByProduct: { 7: 4000 }, mode: 'critical' });
    assert.strictEqual(r.blocking.length, 1); assert.strictEqual(r.blocking[0].level, 'critical'); // théorique 6 000, mesuré 5 000
  });
  await check('clôture : écart faible → pas de blocage', async () => {
    const tk = [{ id: 1, name: 'C1', product_id: 7, product_name: 'Gasoil', opening: 10000, closing: 6005 }];
    const r = await tanks.tankCloseCheck(fakeClient({ tanks: tk }), 1, { ...base, pumpedByProduct: { 7: 4000 }, mode: 'critical' });
    assert.strictEqual(r.blocking.length, 0);
  });
  await check('clôture : sans jauge prise pendant le quart → incomplet, jamais de blocage', async () => {
    const tk = [{ id: 1, name: 'C1', product_id: 7, product_name: 'Gasoil', opening: 10000, closing: null }];
    const r = await tanks.tankCloseCheck(fakeClient({ tanks: tk }), 1, { ...base, pumpedByProduct: { 7: 4000 }, mode: 'warning' });
    assert.strictEqual(r.blocking.length, 0); assert.strictEqual(r.products[0].status, 'incomplet');
  });
  await check('clôture : réception pendant le quart prise en compte', async () => {
    const tk = [{ id: 1, name: 'C1', product_id: 7, product_name: 'Gasoil', opening: 1000, closing: 8000 }];
    const r = await tanks.tankCloseCheck(fakeClient({ tanks: tk, mv: [{ product_id: 7, received: '10000', other: '0' }] }), 1, { ...base, pumpedByProduct: { 7: 3000 }, mode: 'critical' });
    assert.strictEqual(r.blocking.length, 0); // 1 000 + 10 000 − 3 000 = 8 000
  });
  await check('livraison : manque détecté (reçu 10 000, entré 9 700)', () => {
    const d = L.deliveryVariance({ before: 2000, after: 11700, received: 10000, tolPct: 0.5 });
    assert.strictEqual(d.measured, 9700); assert.strictEqual(d.variance, -300); assert.strictEqual(d.level, 'critical'); assert.match(d.diagnosis, /incomplète/);
  });
  await check('livraison : conforme dans la tolérance ; excédent ; données invalides', () => {
    assert.strictEqual(L.deliveryVariance({ before: 2000, after: 11980, received: 10000, tolPct: 0.5 }).level, 'ok');
    assert.match(L.deliveryVariance({ before: 2000, after: 12200, received: 10000, tolPct: 0.5 }).diagnosis, /Plus de carburant/);
    assert.strictEqual(L.deliveryVariance({ before: 'x', after: 1, received: 1 }), null); assert.strictEqual(L.deliveryVariance({ before: 0, after: 1, received: 0 }), null);
  });
  await check('récidive : seuil de quarts distincts, écarts nuls ignorés, tri, taux', () => {
    const g = (e, s, k, a) => ({ employee_id: e, employee: 'E' + e, shift_id: s, kind: k, amount: a, created_at: '2026-11-0' + s + 'T10:00:00Z' });
    const out = recurrence({ gaps: [g(1, 1, 'caisse', -500), g(1, 2, 'caisse', -200), g(1, 3, 'stock', -4), g(1, 3, 'caisse', -100), g(2, 1, 'caisse', -50), g(3, 1, 'caisse', 0), g(null, 1, 'caisse', -9)], worked: { 1: 6, 2: 6 }, minShifts: 3 });
    assert.strictEqual(out.length, 2); assert.strictEqual(out[0].employee_id, 1); assert.strictEqual(out[0].shifts_with_gap, 3); assert.strictEqual(out[0].recurrent, true);
    assert.strictEqual(out[0].cash_total, -800); assert.strictEqual(out[0].rate_pct, 50); assert.strictEqual(out[1].recurrent, false);
  });
  await check('réglages enregistrés dans le registre avec valeurs par défaut sûres', () => {
    const t = fs.readFileSync('src/admin.js', 'utf8');
    assert.match(t, /tank_tolerance_pct:[^\n]*def: 0\.5/); assert.match(t, /tank_close_block:[^\n]*def: 'off'/); assert.match(t, /gap_recurrence_min:[^\n]*def: 3/);
  });
  await check('branchements : clôture, réception, route de récidive, migration', () => {
    assert.match(fs.readFileSync('src/shifts.js', 'utf8'), /tankCloseCheck/); assert.match(fs.readFileSync('src/purchase_orders.js', 'utf8'), /deliveryVariance/);
    assert.match(fs.readFileSync('src/hr.js', 'utf8'), /\/hr\/gaps\/recurrence/); assert.match(fs.readFileSync('migrations/107_receipt_tank_dips.sql', 'utf8'), /CREATE TABLE IF NOT EXISTS receipt_tank_dips/);
  });
  console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
