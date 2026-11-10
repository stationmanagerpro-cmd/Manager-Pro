'use strict';
// A8 — Mode démonstration : preuve (sans base) qu'aucune écriture ni lecture réelle n'est possible, + contrôles de l'aide intégrée.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const src = rd('public/ext-aide-demo.js'), app = rd('public/app.js'), shell = rd('public/ext-shell.js'), idx = rd('public/index.html'), css = rd('public/responsive-v3.css');
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✔ ' + l); };

// Bac à sable : faux navigateur dont fetch() ENREGISTRE chaque appel réseau.
const calls = [];
const el = () => ({ addEventListener() {}, appendChild() {}, remove() {}, after() {}, querySelector: () => null, classList: { add() {}, remove() {} }, setAttribute() {}, set innerHTML(v) {}, style: {} });
const sandbox = {
  console, setTimeout: () => 0, setInterval: () => 0, JSON, Date, Math, Promise, Object, Array, String, Error, URL,
  document: { getElementById: () => null, createElement: el, body: el() , querySelector: () => null },
  esc: s => String(s), toast: () => {}, go: () => {}, can: () => true, V: {}, VM: {}, NAV_ICONS: {},
  ME: { id: 1, is_global: false }, TK: 'token'
};
sandbox.window = sandbox;
sandbox.fetch = (url, init) => { calls.push({ url, method: (init && init.method) || 'GET' }); return Promise.resolve({ ok: true, json: async () => ({}) }); };
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const D = sandbox.SMP_DEMO, state = D.state;

(async () => {
  await check('lectures : toutes les données viennent de l\'échantillon, zéro appel réseau', async () => {
    state.active = true; D.installGuard(); calls.length = 0;
    for (const p of ['/shifts', '/shifts/current', '/pumps', '/pumps/status', '/products', '/sales', '/customers', '/suppliers', '/purchases', '/employees', '/cash/registers', '/cash/movements', '/categories']) {
      const r = await D.handle('GET', p); assert(r && (Array.isArray(r) ? r.length : Object.keys(r).length), p);
    }
    assert.strictEqual(calls.length, 0, 'aucun appel réseau pour les données');
    const prods = await D.handle('GET', '/products'); assert(prods.some(x => x.name === 'Gasoil') && prods.length === 8);
    assert.strictEqual((await D.handle('GET', '/pumps')).length, 3); assert.strictEqual((await D.handle('GET', '/customers')).length, 4);
  });
  await check('écritures simulées : POST/PUT/PATCH/DELETE ne produisent AUCUN appel réseau', async () => {
    calls.length = 0;
    for (const [m, p] of [['POST', '/sales'], ['POST', '/shifts'], ['PATCH', '/pumps/1/counters/1/index'], ['PUT', '/settings/theme'], ['DELETE', '/sales/120'], ['POST', '/customers/1/payments'], ['POST', '/stock/movements']]) {
      const r = await D.handle(m, p, { x: 1 }); assert.strictEqual(r.demo, true, m + ' ' + p);
    }
    assert.strictEqual(calls.length, 0, 'aucune écriture envoyée au serveur');
  });
  await check('garde réseau : toute écriture directe via fetch() vers /api est refusée', async () => {
    calls.length = 0;
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) await assert.rejects(() => sandbox.fetch('/api/sales', { method: m }), /mode démonstration/);
    assert.strictEqual(calls.length, 0);
    await sandbox.fetch('/api/branding'); assert.strictEqual(calls.length, 1);          // lecture de configuration : autorisée
  });
  await check('écran non prévu : erreur claire, jamais de lecture réelle', async () => {
    calls.length = 0;
    await assert.rejects(() => D.handle('GET', '/finance/audit'), /pas disponible dans le mode démonstration/);
    await assert.rejects(() => D.handle('GET', '/sales/120/lines'), /pas disponible/);
    assert.strictEqual(calls.length, 0);
  });
  await check('hors démonstration : le garde laisse passer les écritures normales', async () => {
    state.active = false; calls.length = 0;
    await sandbox.fetch('/api/sales', { method: 'POST' }); assert.strictEqual(calls.length, 1);
    D.removeGuard();
  });
  await check('api() (app.js) bascule sur la démonstration AVANT tout fetch', () => {
    const i = app.indexOf('SMP_DEMO.state.active'), f = app.indexOf("await fetch('/api' + p", i);
    assert(i > 0 && f > i);
  });
  await check('le module n\'envoie aucune écriture : seul fetch autorisé = lectures de configuration et déconnexion', () => {
    assert.strictEqual((src.match(/state\.realFetch\(/g) || []).length, 2);               // garde + realApi
    assert.match(src, /READ_THROUGH = \[/); assert.match(src, /method !== 'GET'/);
  });
  await check('réservé aux administrateurs de station (pas le Super Admin)', () => assert.match(src, /!ME\.is_global[\s\S]*can\('settings\.edit'\) \|\| can\('user\.manage'\)/));
  await check('bandeau « Mode démonstration – rien n\'est enregistré dans la vraie base » + cadre orange', () => {
    assert(src.includes("MODE DÉMONSTRATION – rien n\\'est enregistré dans la vraie base")); assert.match(css, /#demo-banner \{ position: fixed/); assert.match(css, /body\.demo-on::after/);
  });
  await check('aide : manuel servi par l\'application, lien dans « Mon profil & aide », boutons « ? » sur les pages difficiles', () => {
    assert(fs.statSync('public/manuel/Manuel_Utilisation_Manager_Pro.pdf').size > 1e6);
    assert.match(shell, /keys: \['moi', 'clients', 'onboard', 'aide'\]/); assert.match(src, /\/manuel\/Manuel_Utilisation_Manager_Pro\.pdf/);
    for (const k of ['quart', 'clot', 'ventes', 'four']) assert(new RegExp(k + ': \\d+').test(src.match(/const HELP = \{[^}]*\}/)[0]), k);
    assert.match(idx, /ext-aide-demo\.js/);
  });
  console.log(`\n${n}/10 contrôles réussis.`);
})().catch(e => { console.error('✘', e.message); process.exit(1); });
