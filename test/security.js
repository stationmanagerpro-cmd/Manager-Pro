// P16 — Tests sécurité & isolation (node test/security.js <admin_login> <password>)
// Ne jamais lancer sur la base de production.
const BASE = process.env.API || 'http://localhost:3000/api';
// Ce test crée des utilisateurs et modifie des comptes : il ne doit jamais cibler une base de production.
let baseUrl;
try { baseUrl = new URL(BASE); } catch { console.error('API doit être une URL valide'); process.exit(2); }
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(baseUrl.hostname.replace(/^\[|\]$/g, ''))) {
  console.error('REFUS DE SÉCURITÉ : test/security.js est limité à une API locale (localhost/127.0.0.1/::1).');
  process.exit(2);
}
const [login, password] = process.argv.slice(2);
if (!login || !password) { console.error('Usage: node test/security.js <admin> <password>'); process.exit(2); }

let token, sid, fails = 0;
const hdr = (t, s) => ({
  'Content-Type': 'application/json',
  ...(t && { Authorization: 'Bearer ' + t }),
  ...(s && { 'X-Station-Id': String(s) })
});
const call = async (method, p, body, o = {}) => {
  const r = await fetch(BASE + p, {
    method,
    headers: hdr(o.token !== undefined ? o.token : token, o.sid ?? sid),
    body: body != null ? JSON.stringify(body) : undefined
  });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const ok = (c, m) => { if (c) console.log('  ✔ ' + m); else { fails++; console.log('  ✖ ' + m); } };

(async () => {
  console.log('=== P16 Sécurité & isolation ===');
  const t = Date.now();

  // --- Auth de base ---
  let r = await call('POST', '/auth/login', { login, password }, { token: null, sid: null });
  ok(r.s === 200 && r.j?.token, 'login admin');
  token = r.j.token;
  const me = (await call('GET', '/me', null, { sid: null })).j;
  ok(me && me.is_global, 'admin is_global');
  sid = me.stations?.[0]?.id;
  ok(!!sid, 'station disponible');

  // --- Sans token ---
  r = await call('GET', '/me', null, { token: null, sid: null });
  ok(r.s === 401, 'GET /me sans token → 401');
  r = await call('GET', '/admin/backups', null, { token: null, sid });
  ok(r.s === 401, 'GET /admin/backups sans token → 401');
  r = await call('POST', '/admin/backups', {}, { token: null, sid });
  ok(r.s === 401, 'POST /admin/backups sans token → 401');

  // --- Token invalide ---
  r = await call('GET', '/me', null, { token: 'invalid.jwt.token', sid: null });
  ok(r.s === 401, 'token JWT invalide → 401');

  // --- Station absente / refusée ---
  r = await call('GET', '/products', null, { sid: null });
  ok(r.s === 400, 'sans X-Station-Id → 400');
  r = await call('GET', '/products', null, { sid: 999999001 });
  ok(r.s === 403 || r.s === 404 || r.s === 400, 'station inexistante refusée (' + r.s + ')');

  // --- Créer un employé limité (CAISSIER) ---
  const cLogin = 'caissier_sec_' + (t % 100000);
  const cPass = 'CaissierSec1!';
  r = await call('POST', '/users', {
    login: cLogin, password: cPass, role: 'CAISSIER', station_ids: [sid], is_global: false
  });
  // Rôle peut s'appeler autrement selon seed
  if (r.s !== 201) {
    r = await call('POST', '/users', {
      login: cLogin, password: cPass, role: 'EMPLOYE', station_ids: [sid], is_global: false
    });
  }
  ok(r.s === 201, 'utilisateur limité créé (' + (r.j?.role || r.j?.login || r.s) + ')');
  const empId = r.j?.id;

  // Login limité
  r = await call('POST', '/auth/login', { login: cLogin, password: cPass }, { token: null, sid: null });
  ok(r.s === 200 && r.j?.token, 'login utilisateur limité');
  const eTok = r.j?.token;

  // --- Anti-élévation : ne peut pas créer is_global ---
  r = await call('POST', '/users', {
    login: 'hacker_' + t, password: 'HackerPass1!', role: 'ADMIN', station_ids: [sid], is_global: true
  }, { token: eTok, sid });
  ok(r.s === 403 || r.s === 401, 'employé ne peut pas créer ADMIN/is_global (' + r.s + ')');

  // --- Admin endpoints interdits ---
  r = await call('GET', '/admin/backups', null, { token: eTok, sid });
  ok(r.s === 403, 'employé → /admin/backups refusé');
  r = await call('GET', '/admin/info', null, { token: eTok, sid });
  ok(r.s === 403, 'employé → /admin/info refusé');
  r = await call('GET', '/admin/roles', null, { token: eTok, sid });
  ok(r.s === 403, 'employé → /admin/roles refusé');
  r = await call('POST', '/admin/backups', {}, { token: eTok, sid });
  ok(r.s === 403, 'employé → POST sauvegarde refusé');

  // --- Gérant : ne peut pas s'auto-attribuer ADMIN ---
  const gLogin = 'gerant_sec_' + (t % 100000);
  const gPass = 'GerantSec1!';
  r = await call('POST', '/users', {
    login: gLogin, password: gPass, role: 'GERANT', station_ids: [sid], is_global: false
  });
  ok(r.s === 201, 'gérant créé');
  r = await call('POST', '/auth/login', { login: gLogin, password: gPass }, { token: null, sid: null });
  const gTok = r.j?.token;
  ok(!!gTok, 'login gérant');

  r = await call('POST', '/users', {
    login: 'admin_fake_' + t, password: 'AdminFake1!', role: 'ADMIN', station_ids: [sid], is_global: true
  }, { token: gTok, sid });
  ok(r.s === 403, 'gérant ne peut pas créer ADMIN is_global');

  // Tentative modification de son propre rôle via patch si endpoint existe
  r = await call('PATCH', '/users/' + (me.id), { role: 'ADMIN', is_global: true }, { token: gTok, sid });
  ok(r.s === 403 || r.s === 404 || r.s === 400 || r.s === 405, 'gérant ne peut pas modifier l\'admin (' + r.s + ')');

  // --- Contrats : module RH bloqué si désactivé (smoke soft) ---
  r = await call('GET', '/hr/employees', null, { token: eTok, sid });
  // 403 si pas de permission hr, 200 si le rôle a la perm — les deux sont cohérents
  ok(r.s === 200 || r.s === 403 || r.s === 404, 'accès RH selon permissions (' + r.s + ')');

  // --- Centre d'alertes accessible authentifié ---
  r = await call('GET', '/alerts/center', null, { sid });
  ok(r.s === 200 && Array.isArray(r.j?.items || r.j), 'centre d\'alertes accessible');

  // --- Audit search permission ---
  r = await call('GET', '/audit/search?limit=5', null, { token: eTok, sid });
  ok(r.s === 403 || r.s === 200, 'audit selon permission (' + r.s + ')');

  // --- Backup logs (admin) ---
  r = await call('GET', '/admin/backups/logs?limit=5', null, { sid });
  ok(r.s === 200 && Array.isArray(r.j), 'journal sauvegardes accessible admin');

  // --- Health public ---
  r = await call('GET', '/health', null, { token: null, sid: null });
  ok(r.s === 200 && r.j?.ok, 'health public');

  // --- Mot de passe trop court refusé ---
  r = await call('POST', '/users', {
    login: 'short_pw_' + t, password: '123', role: 'CAISSIER', station_ids: [sid]
  });
  ok(r.s === 400, 'mot de passe trop court refusé');

  // Nettoyage soft (désactiver users de test si possible)
  if (empId) {
    await call('PATCH', '/users/' + empId, { active: false }).catch(() => {});
  }

  console.log(fails ? `\n✖ ${fails} échec(s) sécurité` : '\n✔ Tous les tests sécurité sont passés.');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
