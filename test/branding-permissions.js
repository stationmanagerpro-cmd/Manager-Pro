// Tests API : identité de l'application, permissions fines clients/fournisseurs, exports PDF, profil.
// Usage : node test/branding-permissions.js <admin_login> <password>   (serveur démarré, base de TEST uniquement)
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);
if (!login || !password) { console.error('Usage: node test/branding-permissions.js <admin> <password>'); process.exit(2); }
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };
const call = async (method, p, body, { token, sid, raw } = {}) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }), ...(sid && { 'X-Station-Id': String(sid) }) }, body: body != null ? JSON.stringify(body) : undefined });
  if (raw) return { s: r.status, buf: Buffer.from(await r.arrayBuffer()), type: r.headers.get('content-type') };
  return { s: r.status, j: await r.json().catch(() => null) };
};
(async () => {
  const t = Date.now() % 1e6;
  let r = await call('POST', '/auth/login', { login, password }); const A = r.j.token;
  const me = (await call('GET', '/me', null, { token: A })).j, sid = me.stations[0].id, a = { token: A, sid };
  console.log('== Identité de l\'application');
  r = await call('GET', '/branding'); ok(r.s === 200 && r.j.name, 'GET /branding public (sans jeton)');
  const old = r.j;
  r = await call('PUT', '/admin/branding', { name: 'Station Test ' + t, tagline: 'Slogan ' + t }, a); ok(r.s === 200, 'admin principal modifie nom + slogan');
  r = await call('GET', '/branding'); ok(r.j.name === 'Station Test ' + t && r.j.tagline === 'Slogan ' + t, 'nouveau nom/slogan renvoyés publiquement');
  r = await call('PUT', '/admin/branding', { name: '   ', tagline: '' }, a); ok(r.s === 400, 'nom vide refusé');
  r = await call('PUT', '/admin/branding', { name: 'X' }, { sid }); ok(r.s === 401, 'modification sans jeton refusée');
  console.log('== Utilisateur limité (caissier)');
  const cl = 'caisse' + t, cp = 'Passw0rd!' + t;
  r = await call('POST', '/users', { login: cl, password: cp, role: 'CAISSIER', station_ids: [sid], full_name: 'Test Caissier', job_title: 'Caissier test' }, a); ok(r.s === 201, 'création utilisateur avec nom complet et fonction');
  const C = (await call('POST', '/auth/login', { login: cl, password: cp })).j.token, c = { token: C, sid };
  const cme = (await call('GET', '/me', null, { token: C })).j; ok(cme.full_name === 'Test Caissier' && cme.job_title === 'Caissier test' && !!cme.role_label, '/me renvoie nom complet, fonction et libellé du rôle');
  r = await call('PUT', '/admin/branding', { name: 'Pirate', tagline: '' }, c); ok(r.s === 403, 'caissier ne peut pas modifier l\'identité (403)');
  r = await call('GET', '/exports/customers?format=pdf', null, { ...c, raw: true }); ok(r.s === 403, 'caissier : export clients refusé côté API (403)');
  r = await call('GET', '/exports/suppliers?format=pdf', null, { ...c, raw: true }); ok(r.s === 403, 'caissier : export fournisseurs refusé (403)');
  r = await call('GET', '/suppliers', null, c); ok(r.s === 403, 'caissier : liste fournisseurs refusée (403)');
  r = await call('DELETE', '/customers/1', null, c); ok(r.s === 403, 'caissier : suppression client refusée (403)');
  r = await call('PATCH', '/users/1/role', { role: 'ADMIN' }, c); ok(r.s === 403, 'caissier : attribution de rôle refusée (403)');
  console.log('== Exports PDF (admin)');
  for (const k of ['customers', 'suppliers']) {
    r = await call('GET', `/exports/${k}?format=pdf`, null, { ...a, raw: true });
    ok(r.s === 200 && /pdf/.test(r.type) && r.buf.slice(0, 5).toString() === '%PDF-', `export ${k} : PDF valide`);
  }
  r = await call('GET', '/exports/kinds', null, a); ok(r.j.some(x => x.key === 'customers') && r.j.some(x => x.key === 'suppliers'), 'liste des exports contient clients et fournisseurs');
  r = await call('GET', '/exports/kinds', null, c); ok(!r.j.some(x => x.key === 'customers'), 'liste des exports du caissier ne contient pas clients');
  console.log('== Permissions fines : retrait / attribution');
  r = await call('PUT', '/admin/roles/CAISSIER/permissions', { permissions: ['sale.create', 'customer.view'] }, a); ok(r.s === 403, 'le Super Admin ne définit plus les rôles des employés (403)');
  r = await call('POST', '/admin/roles', { label: 'Test', permissions: [] }, a); ok(r.s === 403, 'le Super Admin ne crée plus de rôle employé (403)');
  console.log('== Nettoyage');
  await call('PUT', '/admin/branding', { name: old.name, tagline: old.tagline }, a); ok((await call('GET', '/branding')).j.name === old.name, 'identité d\'origine restaurée');
  console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUS LES TESTS PASSENT'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
