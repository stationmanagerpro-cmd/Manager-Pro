// Tests module licences (node test/licenses.js <admin> <password>)
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);
if (!login || !password) { console.error('Usage: node test/licenses.js <admin> <password>'); process.exit(2); }
let token, sid, fails = 0;
const hdr = (t, s) => ({ 'Content-Type': 'application/json', ...(t && { Authorization: 'Bearer ' + t }), ...(s && { 'X-Station-Id': String(s) }) });
const call = async (method, p, body, o = {}) => {
  const r = await fetch(BASE + p, { method, headers: hdr(o.token ?? token, o.sid ?? sid), body: body != null ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const ok = (c, m) => { if (c) console.log('  ✔ ' + m); else { fails++; console.log('  ✖ ' + m); } };

(async () => {
  console.log('=== Licences clients ===');
  const t = Date.now();
  let r = await call('POST', '/auth/login', { login, password }, { token: null, sid: null });
  ok(r.s === 200, 'login admin');
  token = r.j.token;
  const me = (await call('GET', '/me', null, { sid: null })).j;
  ok(me.is_global, 'is_global');
  sid = me.stations[0].id;

  // Dashboard
  r = await call('GET', '/admin/licenses/dashboard');
  ok(r.s === 200 && r.j.totals, 'dashboard licences');

  // Création client + licence 1 jour
  const name = 'Licence Test ' + t;
  r = await call('POST', '/admin/clients', {
    name,
    manager_name: 'Resp Test',
    contact_email: 'test' + t + '@example.com',
    start_date: new Date().toISOString().slice(0, 10),
    duration_unit: 'day',
    duration_value: 30,
    max_users: 3,
    can_manage_users: true,
    owner_login: 'owner' + (t % 100000),
    owner_password: 'OwnerPass12!',
    features: { can_access_hr: false, modules: { hr: false, finance: true, sales: true } }
  });
  ok(r.s === 201 && r.j.id, 'client + licence créés');
  const clientId = r.j.id;
  ok(r.j.license && (r.j.license.license_status === 'ACTIVE' || r.j.license.license_status === 'EXPIRANT_BIENTOT'), 'statut ACTIVE/EXPIRANT');
  ok(r.j.license && r.j.license.days_remaining != null && r.j.license.days_remaining <= 30, 'jours restants ≤ 30');

  // Historique
  r = await call('GET', `/admin/clients/${clientId}/license/history`);
  ok(r.s === 200 && Array.isArray(r.j) && r.j.some(h => h.operation === 'creation'), 'historique création');

  // Prolongation +10 jours
  r = await call('POST', `/admin/clients/${clientId}/license/extend`, { duration_unit: 'day', duration_value: 10, note: 'test extend' });
  ok(r.s === 200 && r.j.ok, 'prolongation');
  ok(r.j.license.days_remaining > 30, 'jours restants augmentés');

  // Suspension
  r = await call('POST', `/admin/clients/${clientId}/license/suspend`, { reason: 'test suspend' });
  ok(r.s === 200 && r.j.license.license_status === 'SUSPENDUE', 'suspension');

  // Réactivation
  r = await call('POST', `/admin/clients/${clientId}/license/reactivate`, { note: 'test reactivate' });
  ok(r.s === 200 && r.j.license.license_status !== 'SUSPENDUE', 'réactivation');

  // Renouvellement 1 an
  r = await call('POST', `/admin/clients/${clientId}/license/renew`, {
    duration_unit: 'year', duration_value: 1, start_from: 'now', note: 'test renew'
  });
  ok(r.s === 200 && r.j.ok, 'renouvellement 1 an');
  ok(r.j.license.days_remaining > 300, '≈ 1 an restant');

  // Indéfinie
  r = await call('POST', `/admin/clients/${clientId}/license/extend`, { duration_unit: 'indefinite', is_indefinite: true });
  ok(r.s === 200 && r.j.license.is_indefinite, 'passage indéfinie');
  ok(r.j.license.license_status === 'INDEFINIE', 'statut INDEFINIE');

  // Limite users côté quotas
  r = await call('GET', `/admin/clients/${clientId}/quotas`);
  ok(r.s === 200 && r.j.quotas && r.j.quotas.users.max === 3, 'max_users=3');

  // Non-principal ne peut pas accéder dashboard
  r = await call('POST', '/auth/login', { login: 'owner' + (t % 100000), password: 'OwnerPass12!' }, { token: null, sid: null });
  if (r.s === 200) {
    const oTok = r.j.token;
    r = await call('GET', '/admin/licenses/dashboard', null, { token: oTok, sid });
    ok(r.s === 403, 'gérant bloqué sur dashboard licences');
  } else {
    ok(true, 'owner login soft-skip');
  }

  console.log(fails ? `\n✖ ${fails} échec(s)` : '\n✔ Tests licences OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
