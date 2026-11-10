'use strict';
// CORR-044 : brouillon de relevé de clôture hors ligne — module client exécuté avec DOM et localStorage simulés + câblage statique.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const rd = f => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
function env() {
  const store = {}, els = {}; const toasts = [];
  const mk = (id, value = '') => (els[id] = { id, value });
  const doc = { querySelectorAll: () => Object.values(els), getElementById: id => els[id] || null };
  const win = { addEventListener() {} }; win.window = win;
  const ctx = { window: win, document: doc, SID: 3, SH: { id: 42 }, cur: 'quart', toast: (m) => toasts.push(m), pvd() {}, esc: s => String(s), localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } }, Date, JSON, Object, Array, String, Object, Promise, setTimeout, api: async () => ({}) };
  vm.createContext(ctx); vm.runInContext(rd('public/ext-offline-close.js'), ctx);
  return { D: win.smpCloseDraft, ctx, mk, els, store, toasts };
}
const checks = [];
checks.push(['snapshot ne garde que les champs de clôture non vides', () => {
  const { D, mk } = env(); mk('c0', '1520.5'); mk('c1', ''); mk('cp', '250000'); mk('autre', 'x'); mk('ec7', '1000');
  assert.strictEqual(JSON.stringify(D.snapshot({ querySelectorAll: () => Object.values({ a: { id: 'c0', value: '1520.5' }, b: { id: 'c1', value: '' }, c: { id: 'cp', value: '250000' }, d: { id: 'autre', value: 'x' } }) })), JSON.stringify({ c0: '1520.5', cp: '250000' }));
}]);
checks.push(['sauvegarde puis rétablissement du brouillon sur le bon quart', () => {
  const e = env(); e.mk('c0', '1520.5'); e.mk('cp', '250000'); assert.strictEqual(e.D.save(), true);
  e.els.c0.value = ''; e.els.cp.value = '';                          // formulaire rechargé vide au retour du réseau
  assert.strictEqual(e.D.apply(), 2); assert.strictEqual(e.els.c0.value, '1520.5'); assert.strictEqual(e.els.cp.value, '250000'); assert.ok(e.toasts.length === 1);
  e.ctx.SH = { id: 43 }; e.els.c0.value = ''; assert.strictEqual(e.D.apply(), 0);   // autre quart : jamais appliqué
}]);
checks.push(['un champ déjà saisi n’est pas écrasé ; brouillon périmé (>3 j) ignoré ; effacé après clôture', () => {
  const e = env(); e.mk('cp', '100'); e.D.save(); e.els.cp.value = '999'; assert.strictEqual(e.D.apply(), 0); assert.strictEqual(e.els.cp.value, '999');
  const k = Object.keys(e.store).find(x => x.startsWith('smp-close-draft')); const d = JSON.parse(e.store[k]); d.saved_at -= 4 * 24 * 3600 * 1000; e.store[k] = JSON.stringify(d);
  e.els.cp.value = ''; assert.strictEqual(e.D.apply(), 0);
  e.els.cp.value = '5'; e.D.save(); e.D.clear(42); assert.strictEqual(Object.keys(e.store).filter(x => x.startsWith('smp-close-draft')).length, 0);
}]);
checks.push(['formulaire hors ligne : quart mémorisé requis, champs aux mêmes identifiants que la clôture réelle', () => {
  const e = env(); assert.match(e.D.offlineForm(), /jamais été chargé/);
  e.D.remember({ id: 42, number: 7, opened_at: 'x', counters: [{ pump: 'P1', counter_number: 1, product: 'Gasoil', index_start: 100 }], team: [] });
  const h = e.D.offlineForm(); for (const id of ['c0', 'pm', 'pc', 'pk', 'cp', 'jus']) assert.ok(h.includes('id="' + id + '"'), id);
  assert.match(h, /HORS LIGNE/); assert.ok(!/Po\(|close\?/.test(h));            // aucune clôture envoyée
}]);
checks.push(['câblage : app.js, index, SW', () => {
  const a = rd('public/app.js'); assert.match(a, /smpCloseOfflineForm/); assert.match(a, /smpCloseDraft\.save\(\)/); assert.match(a, /smpCloseDraft\.clear\(sid0\)/);
  assert.match(rd('public/index.html'), /ext-offline-close\.js/); assert.match(rd('public/sw.js'), /ext-offline-close\.js/);
}]);
let n = 0; for (const [l, f] of checks) { f(); n++; console.log('✓ ' + l); } console.log(n + ' contrôles OK');
