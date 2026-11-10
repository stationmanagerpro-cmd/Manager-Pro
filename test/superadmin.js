// Tests d'intégration du périmètre Superadmin (node test/superadmin.js <superadmin> <mot_de_passe>)
// Prérequis : serveur démarré sur une base de TEST migrée (jusqu'à 030). Ne jamais lancer sur la production.
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);
if (!login || !password) { console.error('Usage: node test/superadmin.js <superadmin> <password>'); process.exit(2); }
let token, fails = 0;
const call = async (method, p, body, t = token) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(t && { Authorization: 'Bearer ' + t }) }, body: body != null ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const ok = (c, m) => { if (c) console.log('  ✔ ' + m); else { fails++; console.log('  ✖ ' + m); } };
(async () => {
  console.log('=== Périmètre Superadmin ===');
  let r = await call('POST', '/auth/login', { login, password }, null); ok(r.s === 200, 'connexion Superadmin'); token = r.j.token;
  r = await call('GET', '/me'); ok(r.s === 200 && r.j.is_global && r.j.stations.length === 0, '/me : is_global, aucune station');
  for (const p of ['/appearance', '/dashboard', '/notifications', '/products', '/customers', '/employees', '/finance/accounts'])
    { r = await call('GET', p); ok(r.s === 403, p + ' refusé au Superadmin (403, données de station)'); }
  console.log('=== Finance plateforme ===');
  r = await call('GET', '/admin/platform/summary'); ok(r.s === 200 && typeof r.j.treasury === 'number', 'synthèse');
  const t = Date.now();
  r = await call('POST', '/admin/platform/invoices', { kind: 'licence', label: 'Licence test ' + t, amount: 100000, due_on: '2999-01-01' }); ok(r.s === 201, 'facture créée'); const inv = r.j.id;
  r = await call('POST', `/admin/platform/invoices/${inv}/payments`, { amount: 40000 }); ok(r.s === 201 && r.j.balance === 60000, 'encaissement partiel, solde 60000');
  r = await call('POST', `/admin/platform/invoices/${inv}/payments`, { amount: 70000 }); ok(r.s === 409, 'sur-encaissement refusé');
  r = await call('POST', `/admin/platform/invoices/${inv}/cancel`); ok(r.s === 409, 'facture encaissée non annulable');
  r = await call('POST', '/admin/platform/expenses', { category: 'hebergement', label: 'Hebergement ' + t, amount: 7000 }); ok(r.s === 201, 'dépense créée'); const ex = r.j.id;
  r = await call('POST', `/admin/platform/expenses/${ex}/payments`, { amount: 7000 }); ok(r.s === 201 && r.j.balance === 0, 'dépense réglée');
  r = await call('POST', '/admin/platform/expenses', { category: 'inconnue', label: 'x', amount: 1 }); ok(r.s === 400, 'catégorie invalide refusée');
  r = await call('POST', '/admin/platform/invoices', { label: 'x', amount: -5 }); ok(r.s === 400, 'montant négatif refusé');
  r = await call('GET', '/admin/platform/reports'); ok(r.s === 200 && r.j.length >= 7, 'liste des rapports');
  for (const k of (r.j || []).map(x => x.key)) { const q = await call('GET', '/admin/platform/reports/' + k); ok(q.s === 200 && Array.isArray(q.j.rows), 'rapport ' + k); }
  r = await call('GET', '/admin/platform/reports/inconnu'); ok(r.s === 404, 'rapport inconnu : 404');
  console.log('=== Séparation : un Gérant ne voit pas la finance plateforme (variables TEST_MANAGER_LOGIN / TEST_MANAGER_PASSWORD) ===');
  const ml = process.env.TEST_MANAGER_LOGIN, mp = process.env.TEST_MANAGER_PASSWORD;
  if (ml && mp) {
    r = await call('POST', '/auth/login', { login: ml, password: mp }, null); const mt = r.j && r.j.token;
    const me = (await call('GET', '/me', null, mt)).j, h = { 'X-Station-Id': String(me.stations[0].id) };
    const rr = await fetch(BASE + '/admin/platform/summary', { headers: { Authorization: 'Bearer ' + mt, ...h } });
    ok(rr.status === 403, 'Gérant : /admin/platform/summary refusé (403)');
  } else console.log('  – non exécuté : TEST_MANAGER_LOGIN / TEST_MANAGER_PASSWORD absents');
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUS LES TESTS SUPERADMIN PASSENT'); process.exit(fails ? 1 : 0);
})();
