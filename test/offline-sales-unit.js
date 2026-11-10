'use strict';
// CORR-043 : vente carburant hors ligne — logique serveur pure + module client exécuté (stockage et réseau simulés) + câblage statique.
const fs = require('fs'); const path = require('path'); const vm = require('vm'); const assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const { resolveOfflineSale } = require('../src/offline_sale_logic');
let n = 0; const checks = []; const check = (l, fn) => checks.push([l, fn]);
const NOW = Date.parse('2026-11-05T12:00:00Z');

check('serveur : heure plausible dans le quart ouvert → conservée', () => {
  const r = resolveOfflineSale({ offlineAt: '2026-11-05T10:30:00Z', nowMs: NOW, shiftOpenedAt: '2026-11-05T06:00:00Z' });
  assert.deepStrictEqual(r, { ok: true, soldAt: '2026-11-05T10:30:00.000Z' });
});
check('serveur : avant l\'ouverture du quart actuel → rejet (jamais rattachée à un autre quart)', () => {
  const r = resolveOfflineSale({ offlineAt: '2026-11-05T05:00:00Z', nowMs: NOW, shiftOpenedAt: '2026-11-05T06:00:00Z' }); assert.strictEqual(r.ok, false); assert.match(r.reason, /quart/);
});
check('serveur : futur, trop ancienne, invalide → rejet ; absente → comportement inchangé', () => {
  assert.strictEqual(resolveOfflineSale({ offlineAt: '2026-11-05T13:00:00Z', nowMs: NOW, shiftOpenedAt: null }).ok, false);
  assert.strictEqual(resolveOfflineSale({ offlineAt: '2026-11-01T10:00:00Z', nowMs: NOW, shiftOpenedAt: null }).ok, false);
  assert.strictEqual(resolveOfflineSale({ offlineAt: 'xx', nowMs: NOW, shiftOpenedAt: null }).ok, false);
  assert.deepStrictEqual(resolveOfflineSale({ nowMs: NOW, shiftOpenedAt: null }), { ok: true, soldAt: null });
  assert.strictEqual(resolveOfflineSale({ offlineAt: '2026-11-05T12:03:00Z', nowMs: NOW, shiftOpenedAt: null }).ok, true); // tolérance d'horloge 5 min
});

// ---- module client exécuté dans un bac à sable
function sandbox() {
  const listeners = {}; const win = { addEventListener: (e, f) => { listeners[e] = f; }, crypto: { randomUUID: () => '1111-2222' } };
  const ctx = { window: win, navigator: { onLine: true }, document: {}, setTimeout, console, SID: 5, ME: { id: 9 }, TK: 't', toast: () => {}, confirm: () => true, indexedDB: {}, Date, Promise, Math, String, Number, Array, Object, Error, TypeError };
  win.window = win; ctx.window = win; vm.createContext(ctx); vm.runInContext(rd('public/ext-offline-sales.js'), ctx);
  return { O: win.SMPOffline, win, ctx };
}
function fakeStore(items = []) { let id = 100; const rows = items.map(x => Object.assign({ id: id++ }, x));
  return { rows, getAll: async () => rows.map(x => ({ ...x })), put: async it => { const i = rows.findIndex(r => r.id === it.id); rows[i] = { ...it }; }, add: async it => { rows.push({ id: id++, ...it }); }, del: async i => { const k = rows.findIndex(r => r.id === i); rows.splice(k, 1); } }; }
const httpErr = (status, msg, details) => Object.assign(new Error(msg), { status, details });

check('client : classification des erreurs (réseau/5xx/401 → réessayer ; 4xx métier → rejeter)', () => {
  const { O } = sandbox();
  assert.strictEqual(O.classify(new TypeError('Failed to fetch')), 'retry'); assert.strictEqual(O.classify(httpErr(503, 'x')), 'retry'); assert.strictEqual(O.classify(httpErr(401, 'x')), 'retry');
  assert.strictEqual(O.classify(httpErr(409, 'Aucun quart ouvert')), 'reject'); assert.strictEqual(O.classify(httpErr(400, 'x')), 'reject'); assert.strictEqual(O.classify(httpErr(403, 'x')), 'reject');
});
check('client : hors ligne → mise en file avec référence unique, heure, station ; cartes flotte refusées', async () => {
  const { O, ctx } = sandbox(); const store = fakeStore();
  const r = await O.fuelSale({ mode: 'litres', counter_id: 1, liters: 20, payments: [{ method: 'especes', amount: 15000 }] }, { online: false, store, send: async () => { throw new Error('ne doit pas appeler'); } });
  assert.strictEqual(r.queued, true); assert.strictEqual(store.rows.length, 1);
  const it = store.rows[0]; assert.strictEqual(it.status, 'pending'); assert.strictEqual(it.station, 5); assert.match(it.body.client_ref, /^off-/); assert.ok(Date.parse(it.body.offline_at)); assert.match(it.label, /20 L/);
  await assert.rejects(() => O.fuelSale({ mode: 'litres', counter_id: 1, liters: 5, fleet_card: { number: 'C1', pin: '1234' } }, { online: false, store }), /Carte flotte/);
  assert.strictEqual(store.rows.length, 1);                                   // aucun PIN stocké
  assert.ok(!JSON.stringify(store.rows).includes('1234'));
});
check('client : coupure réseau pendant l\'envoi → file ; refus serveur en ligne → erreur remontée, pas de file', async () => {
  const { O } = sandbox(); const store = fakeStore();
  const r = await O.fuelSale({ mode: 'montant', counter_id: 1, amount: 5000 }, { online: true, store, send: async () => { throw new TypeError('Failed to fetch'); } }); assert.strictEqual(r.queued, true);
  await assert.rejects(() => O.fuelSale({ mode: 'montant', counter_id: 1, amount: 5000 }, { online: true, store, send: async () => { throw httpErr(409, 'Aucun quart ouvert'); } }), /quart/);
  assert.strictEqual(store.rows.length, 1);
});
check('client : synchro — succès supprimés, ordre de saisie, refus marqué failed avec motif, réseau → arrêt sans perte', async () => {
  const { O } = sandbox(); const calls = [];
  const store = fakeStore([{ status: 'pending', created_at: 3, method: 'POST', path: '/sales/fuel', body: { n: 3 }, label: 'C', station: 5 }, { status: 'pending', created_at: 1, method: 'POST', path: '/sales/fuel', body: { n: 1 }, label: 'A', station: 5 }, { status: 'pending', created_at: 2, method: 'POST', path: '/sales/fuel', body: { n: 2 }, label: 'B', station: 5 }]);
  const r = await O.flush({ store, station: 5, send: async (m, p, b) => { calls.push(b.n); if (b.n === 2) throw httpErr(409, 'Aucun quart ouvert', ['x']); return {}; } });
  assert.deepStrictEqual(calls, [1, 2, 3]); assert.strictEqual(r.flushed, 2); assert.strictEqual(r.rejected, 1);
  assert.strictEqual(store.rows.length, 1); assert.strictEqual(store.rows[0].status, 'failed'); assert.match(store.rows[0].error, /Aucun quart ouvert/);
  const st2 = fakeStore([{ status: 'pending', created_at: 1, path: '/p', body: {}, station: 5 }, { status: 'pending', created_at: 2, path: '/p', body: {}, station: 5 }]);
  const r2 = await O.flush({ store: st2, station: 5, send: async () => { throw new TypeError('Failed to fetch'); } });
  assert.strictEqual(r2.flushed, 0); assert.strictEqual(st2.rows.length, 2); assert.ok(st2.rows.every(x => x.status === 'pending'));
});
check('client : un élément d\'une autre station n\'est jamais envoyé ; un refusé n\'est pas renvoyé', async () => {
  const { O } = sandbox(); let sent = 0;
  const store = fakeStore([{ status: 'pending', created_at: 1, path: '/p', body: {}, station: 7 }, { status: 'failed', created_at: 2, path: '/p', body: {}, station: 5 }]);
  await O.flush({ store, station: 5, send: async () => { sent++; return {}; } }); assert.strictEqual(sent, 0);
});
const sale = rd('public/ext-sale-shift.js'), fs2 = rd('src/fuelsales.js'), sw = rd('public/sw.js'), idx = rd('public/index.html'), pwa = rd('public/pwa.js'), prop = rd('public/ext-proposals.js');
check('câblage : formulaire, schéma serveur, SW, index, badge, écran de file', () => {
  assert.ok((sale.match(/smpFuelSale\(body\)/g) || []).length === 2); assert.ok(!/Po\('\/sales\/fuel'/.test(sale));
  assert.match(fs2, /offline_at: z\.string\(\)\.datetime/); assert.match(fs2, /resolveOfflineSale\(/); assert.match(fs2, /offline_rejected: true/);
  assert.match(sw, /ext-offline-sales\.js/); assert.match(sw, /smp-static-b[0-9a-f]{10}/); assert.match(idx, /ext-offline-sales\.js/);
  assert.match(pwa, /failed/); assert.match(prop, /offlineDiscard/);
});
(async () => { for (const [l, fn] of checks) { await fn(); n++; console.log('✓ ' + l); } console.log(`${n} contrôles OK`); })().catch(e => { console.error('✗', e.message); process.exit(1); });
