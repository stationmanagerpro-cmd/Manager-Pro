// Étape 36 — Test d'intégration en lecture seule de l'isolation entre clients.
// Usage: définir ISO_TEST_LOGIN_A, ISO_TEST_PASSWORD_A, ISO_TEST_STATION_A,
// ISO_TEST_LOGIN_B, ISO_TEST_PASSWORD_B, ISO_TEST_STATION_B puis lancer le script.
// Cible une API locale de test. L'authentification crée des sessions et des journaux de connexion.
const assert = require('assert');
const BASE = process.env.API || 'http://localhost:3000/api';
let parsed;
try { parsed = new URL(BASE); } catch { console.error('API doit être une URL valide'); process.exit(2); }
if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
  console.error('REFUS DE SÉCURITÉ : utiliser une URL HTTP(S) locale sans identifiants, paramètres ni fragment.'); process.exit(2);
}
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
if (!localHosts.has(parsed.hostname.replace(/^\[|\]$/g, ''))) {
  console.error('REFUS DE SÉCURITÉ : ce test est limité à localhost/127.0.0.1/::1.'); process.exit(2);
}
const loginA = process.env.ISO_TEST_LOGIN_A, passA = process.env.ISO_TEST_PASSWORD_A;
const stationA = process.env.ISO_TEST_STATION_A, loginB = process.env.ISO_TEST_LOGIN_B;
const passB = process.env.ISO_TEST_PASSWORD_B, stationB = process.env.ISO_TEST_STATION_B;
if (![loginA, passA, stationA, loginB, passB, stationB].every(Boolean) || !/^\d+$/.test(stationA || '') || !/^\d+$/.test(stationB || '')) {
  console.error('Variables requises : ISO_TEST_LOGIN_A, ISO_TEST_PASSWORD_A, ISO_TEST_STATION_A, ISO_TEST_LOGIN_B, ISO_TEST_PASSWORD_B, ISO_TEST_STATION_B.'); process.exit(2);
}
if (stationA === stationB) { console.error('Les identifiants de station A et B doivent être différents.'); process.exit(2); }
async function call(method, path, token, station, body) {
  const response = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(station ? { 'X-Station-Id': String(station) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}
function check(condition, message) { assert.ok(condition, message); console.log('✔ ' + message); }
(async () => {
  console.log('=== Étape 37 : isolation multi-clients (données métier en lecture seule) ===');
  const noToken = await call('GET', '/me', null, stationA);
  check(noToken.status === 401, `GET /me sans jeton est refusé (HTTP ${noToken.status})`);
  const invalidToken = await call('GET', '/me', 'jeton-invalide-test', stationA);
  check(invalidToken.status === 401, `GET /me avec jeton invalide est refusé (HTTP ${invalidToken.status})`);
  const a = await call('POST', '/auth/login', null, null, { login: loginA, password: passA });
  check(a.status === 200 && typeof a.json?.token === 'string', 'connexion du compte client A');
  const b = await call('POST', '/auth/login', null, null, { login: loginB, password: passB });
  check(b.status === 200 && typeof b.json?.token === 'string', 'connexion du compte client B');
  const meA = await call('GET', '/me', a.json.token, stationA);
  const meB = await call('GET', '/me', b.json.token, stationB);
  check(meA.status === 200, 'compte A peut consulter son profil avec sa station');
  check(meB.status === 200, 'compte B peut consulter son profil avec sa station');
  check(!meA.json?.is_global && !meB.json?.is_global, 'les deux comptes sont des comptes non globaux');
  const assignedA = (meA.json?.stations || []).some(s => String(s.id) === stationA);
  const assignedB = (meB.json?.stations || []).some(s => String(s.id) === stationB);
  check(assignedA && assignedB, 'chaque compte est affecté à sa station de test');
  const ownProducts = await call('GET', '/products', a.json.token, stationA);
  check(ownProducts.status === 200, `le compte A peut lire les produits de sa station (HTTP ${ownProducts.status})`);
  const cross = await call('GET', '/products', a.json.token, stationB);
  check([400, 403, 404].includes(cross.status), `A ne peut pas lire les produits de la station B (HTTP ${cross.status})`);
  console.log('\n✔ Test terminé. Aucune donnée métier n’est créée/modifiée ; les connexions créent des sessions et des journaux d’audit.');
})().catch(error => { console.error('✖ Test interrompu : ' + error.message); process.exit(1); });
