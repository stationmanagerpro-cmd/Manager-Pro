'use strict';
// Utilisation par client (Superadmin) : score d'accrochage, garde d'accès, suivi par écran et par heure. Base simulée, sans PostgreSQL.
const assert = require('assert'), Module = require('module');
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✓ ' + l); };

const queries = []; let rowsFor = () => [];
const fakePool = { query: async (sql, p) => { queries.push({ sql, p }); return { rows: rowsFor(sql, p), rowCount: 1 }; } };
const routes = {};
const fakeRouter = () => { const r = {}; for (const m of ['get', 'post']) r[m] = (path, ...h) => { routes[m + ' ' + path] = h[h.length - 1]; return r; }; return r; };
const orig = Module._load;
let guardCalled = false;
Module._load = function (req, parent, ...a) {
  if (parent && /usage_client\.js$/.test(parent.filename)) {
    if (req === 'express') { const e = () => fakeRouter(); e.Router = fakeRouter; return e; }
    if (req === './core') return { pool: fakePool, wrap: f => f, HttpError: class extends Error { constructor(s, m) { super(m); this.status = s; } } };
    if (req === './contracts') return { needPrincipal: (q, s, nx) => { guardCalled = true; return nx && nx(); } };
  }
  if (parent && /usage\.js$/.test(parent.filename)) {
    if (req === 'express') { const e = () => fakeRouter(); e.Router = fakeRouter; return e; }
    if (req === './core') return { pool: fakePool, wrap: f => f };
  }
  return orig.call(this, req, parent, ...a);
};
const U = require('../src/usage_client');
require('../src/usage');
Module._load = orig;

(async () => {
  await check('score client : sans donnée → « Aucune donnée », valeur nulle', () => {
    const s = U.clientEngagement({ days: 30, activeDays: 0, totalUsers: 0, activeUsers: 0, distinctViews: 0, totalSeconds: 0, activeAccountDays: 0 });
    assert.strictEqual(s.value, null); assert.strictEqual(s.level, 'Aucune donnée');
  });

  await check('score client : activité forte → Fort, poids 30/25/20/25 = 100', () => {
    const s = U.clientEngagement({ days: 30, activeDays: 30, totalUsers: 4, activeUsers: 4, distinctViews: 15, totalSeconds: 4 * 30 * 3600, activeAccountDays: 120 });
    assert.strictEqual(s.value, 100); assert.strictEqual(s.level, 'Fort');
    assert.deepStrictEqual(s.components.map(c => c.weight), [30, 25, 20, 25]);
    assert.strictEqual(s.components.reduce((a, c) => a + c.weight, 0), 100);
  });

  await check('score client : composantes bornées à 0–100 et niveaux cohérents', () => {
    const s = U.clientEngagement({ days: 30, activeDays: 3, totalUsers: 10, activeUsers: 1, distinctViews: 2, totalSeconds: 600, activeAccountDays: 1 });
    assert.ok(s.value >= 0 && s.value <= 100);
    s.components.forEach(c => assert.ok(c.score >= 0 && c.score <= 100, c.key));
    assert.strictEqual(s.level, s.value >= 75 ? 'Fort' : s.value >= 50 ? 'Moyen' : s.value >= 25 ? 'Faible' : 'Dormant');
  });

  await check('score compte : nul sans jour actif, progressif ensuite', () => {
    assert.strictEqual(U.accountScore({ days: 30, activeDays: 0, seconds: 0, distinctViews: 0 }), 0);
    const low = U.accountScore({ days: 30, activeDays: 2, seconds: 600, distinctViews: 1 });
    const high = U.accountScore({ days: 30, activeDays: 30, seconds: 30 * 3600, distinctViews: 8 });
    assert.ok(high > low && high <= 100);
  });

  await check('route : identifiant invalide refusé (400) et garde Superadmin appliquée', async () => {
    const h = routes['get /admin/clients/:id/usage'];
    assert.ok(h, 'route enregistrée');
    let err = null;
    try { await h({ params: { id: 'abc' }, query: {} }, { json() {} }); } catch (e) { err = e; }
    assert.ok(err && err.status === 400);
    const src = require('fs').readFileSync(require.resolve('../src/usage_client'), 'utf8');
    assert.ok(/get\('\/admin\/clients\/:id\/usage', needPrincipal/.test(src), 'garde needPrincipal sur la route');
  });

  await check('route : client inexistant → 404', async () => {
    rowsFor = () => [];
    const h = routes['get /admin/clients/:id/usage'];
    let err = null;
    try { await h({ params: { id: '42' }, query: { days: '30' } }, { json() {} }); } catch (e) { err = e; }
    assert.ok(err && err.status === 404);
  });

  await check('suivi : le ping enregistre le client, le compte, l’heure de Bamako et l’écran (chaîne simple seulement)', async () => {
    const ping = routes['post /usage/ping'];
    queries.length = 0;
    await ping({ user: { id: 5, client_id: 1, is_global: false }, body: { view: 'stock' }, get: () => '' }, { json() {} });
    const ud = queries.find(q => /INSERT INTO usage_detail/.test(q.sql));
    assert.ok(ud, 'insertion usage_detail');
    assert.deepStrictEqual(ud.p, [1, 5, 'stock']);
    assert.ok(/Africa\/Bamako/.test(ud.sql));
    queries.length = 0;
    await ping({ user: { id: 5, client_id: 1, is_global: false }, body: { view: { stations: [] } }, get: () => '' }, { json() {} });
    const ud2 = queries.find(q => /INSERT INTO usage_detail/.test(q.sql));
    assert.deepStrictEqual(ud2.p, [1, 5, ''], 'un objet n’est pas pris pour un écran');
    assert.ok(!queries.some(q => /INSERT INTO view_usage/.test(q.sql)), 'pas de vue enregistrée pour un objet');
  });

  console.log(`\n${n} vérifications OK`);
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
