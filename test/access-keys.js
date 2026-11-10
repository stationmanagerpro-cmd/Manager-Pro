// Test d'intégration des clés d'accès (nécessite le serveur démarré + PostgreSQL migré jusqu'à 053).
// Usage : node test/access-keys.js <login_superadmin> <mot_de_passe> [http://127.0.0.1:3000]
// Le test remet la politique « clé exigée » à DÉSACTIVÉ à la fin (même en cas d'échec).
const assert = require('assert');
const [, , LOGIN, PASS, BASE = 'http://127.0.0.1:3000'] = process.argv;
if (!LOGIN || !PASS) { console.error('Usage : node test/access-keys.js <login> <mot_de_passe> [url]'); process.exit(2); }

class Jar { constructor() { this.c = {}; } set(res) { for (const s of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) { const [kv] = s.split(';'); const i = kv.indexOf('='); this.c[kv.slice(0, i)] = kv.slice(i + 1); } } header() { return Object.entries(this.c).map(([k, v]) => k + '=' + v).join('; '); } }
async function call(method, path, { jar, token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (jar && jar.header()) h.Cookie = jar.header(); if (token) h.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + '/api' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  if (jar) jar.set(res);
  let json = null; try { json = await res.json(); } catch (_) { /* corps vide */ }
  return { status: res.status, json };
}
let n = 0; const ok = (m) => { n++; console.log('✔', m); };

(async () => {
  const sa = await call('POST', '/auth/login', { body: { login: LOGIN, password: PASS } });
  assert.strictEqual(sa.status, 200, 'connexion Super Admin impossible : ' + JSON.stringify(sa.json));
  const T = sa.json.token;
  try {
    // 1. Désactivée par défaut : la connexion fonctionne sans clé.
    await call('PUT', '/admin/access-keys/settings', { token: T, body: { required: false, pass_minutes: 60 } });
    assert.strictEqual((await call('GET', '/public/access/status')).json.required, false); ok('clé non exigée par défaut');

    // 2. On ne peut pas activer l'exigence sans clé active (anti-verrouillage).
    const rows0 = (await call('GET', '/admin/access-keys', { token: T })).json;
    for (const r of rows0) if (r.status !== 'revoquee') await call('POST', `/admin/access-keys/${r.id}/revoke`, { token: T, body: {} });
    const refuse = await call('PUT', '/admin/access-keys/settings', { token: T, body: { required: true, pass_minutes: 60 } });
    assert.strictEqual(refuse.status, 409); ok('activation refusée sans clé disponible');

    // 3. Génération (provisoire) puis activation.
    const g = await call('POST', '/admin/access-keys/generate', { token: T, body: {} });
    assert.strictEqual(g.status, 200); assert(/^\d{4}$/.test(g.json.key)); assert.strictEqual(g.json.status, 'provisoire');
    const key = g.json.key;
    assert.strictEqual((await call('POST', `/admin/access-keys/${g.json.id}/confirm`, { token: T, body: {} })).status, 200); ok('clé générée (4 chiffres) puis activée');
    assert.strictEqual((await call('POST', `/admin/access-keys/${g.json.id}/reveal`, { token: T, body: {} })).json.key, key); ok('clé consultable par le Super Admin (journalisé)');
    assert.strictEqual((await call('PUT', '/admin/access-keys/settings', { token: T, body: { required: true, pass_minutes: 60 } })).status, 200);

    // 4. Sans clé : l'écran de connexion est refusé côté SERVEUR (pas seulement masqué).
    const A = new Jar();
    const noKey = await call('POST', '/auth/login', { jar: A, body: { login: LOGIN, password: PASS } });
    assert.strictEqual(noKey.status, 403); assert.strictEqual(noKey.json.code, 'ACCESS_KEY_REQUIRED'); ok('connexion refusée par le serveur sans clé');

    // 5. Mauvaise clé, puis bonne clé.
    const wrong = key === '0000' ? '0001' : '0000';
    assert.strictEqual((await call('POST', '/public/access/verify', { jar: A, body: { key: wrong } })).status, 401); ok('clé invalide refusée');
    assert.strictEqual((await call('POST', '/public/access/verify', { jar: A, body: { key: '12a' } })).status, 400); ok('format invalide refusé');
    const good = await call('POST', '/public/access/verify', { jar: A, body: { key } });
    assert.strictEqual(good.status, 200, JSON.stringify(good.json)); ok('bonne clé acceptée');
    assert.strictEqual((await call('GET', '/public/access/status', { jar: A })).json.ok, true);
    const login = await call('POST', '/auth/login', { jar: A, body: { login: LOGIN, password: PASS } });
    assert.strictEqual(login.status, 200); ok('connexion possible avec laissez-passer + mot de passe');
    assert.strictEqual((await call('POST', '/auth/login', { jar: A, body: { login: LOGIN, password: 'mauvais-mot-de-passe' } })).status === 200, false); ok('la clé ne remplace pas le mot de passe');

    // 6. Une seule utilisation par appareil : même appareil refusé, autre appareil accepté.
    const again = await call('POST', '/public/access/verify', { jar: A, body: { key } });
    assert.strictEqual(again.status, 200); assert.strictEqual(again.json.trusted, true); ok('même appareil : reconnu « de confiance », la clé n’est pas consommée une 2e fois');
    const B = new Jar();
    assert.strictEqual((await call('POST', '/public/access/verify', { jar: B, body: { key } })).status, 200); ok('même clé acceptée sur un autre appareil');

    // 7. Révocation : un nouvel appareil ne peut plus l'utiliser ; l'historique est conservé.
    await call('POST', `/admin/access-keys/${g.json.id}/revoke`, { token: T, body: {} });
    const C = new Jar();
    assert.strictEqual((await call('POST', '/public/access/verify', { jar: C, body: { key } })).status, 401); ok('clé révoquée refusée');
    const hist = (await call('GET', '/admin/access-keys', { token: T })).json.find(r => r.id === g.json.id);
    assert(hist && hist.devices === 2); ok('historique conservé (2 appareils)');

    // 7 bis. Recours Superadmin : clé révoquée (donc aucune clé active) mais politique toujours exigée → le code de secours évite le blocage.
    const badPw = await call('POST', '/admin/access-keys/recovery/generate', { token: T, body: { password: 'mauvais-mot-de-passe' } });
    assert.strictEqual(badPw.status, 400); ok('code de secours : mot de passe incorrect refusé');
    const rec = await call('POST', '/admin/access-keys/recovery/generate', { token: T, body: { password: PASS } });
    assert.strictEqual(rec.status, 200); assert(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(rec.json.code)); ok('code de secours généré (affiché une seule fois)');
    const D = new Jar();
    assert.strictEqual((await call('POST', '/auth/login', { jar: D, body: { login: LOGIN, password: PASS } })).status, 403); ok('nouvel appareil sans clé active : connexion refusée');
    assert.strictEqual((await call('POST', '/public/access/recovery', { jar: D, body: { code: 'ZZZZ-ZZZZ-ZZZZ-ZZ22' } })).status, 401); ok('faux code de secours refusé');
    assert.strictEqual((await call('POST', '/public/access/recovery', { jar: D, body: { code: rec.json.code } })).status, 200); ok('code de secours accepté');
    assert.strictEqual((await call('POST', '/auth/login', { jar: D, body: { login: LOGIN, password: PASS } })).status, 200); ok('connexion possible (laissez-passer + mot de passe)');
    const E2 = new Jar();
    assert.strictEqual((await call('POST', '/public/access/recovery', { jar: E2, body: { code: rec.json.code } })).status, 401); ok('code de secours à usage unique : 2e usage refusé');

    // 8. Droits : un compte non Super Admin ne peut pas administrer les clés (voir test de rôles existants pour les autres comptes).
    assert.strictEqual((await call('GET', '/admin/access-keys')).status, 401); ok('administration refusée sans authentification');
  } finally {
    await call('PUT', '/admin/access-keys/settings', { token: T, body: { required: false, pass_minutes: 60 } });
    console.log(`\n${n} contrôles réussis. Politique remise à « non exigée ».`);
  }
})().catch(e => { console.error('✖ ÉCHEC :', e.message); process.exit(1); });
