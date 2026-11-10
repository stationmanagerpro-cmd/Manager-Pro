// Simulation des routes de src/access_keys.js SANS PostgreSQL ni express : les modules externes et la base sont remplacés par des doublures.
// Elle vérifie les FLUX (appareil de confiance, expiration, révocation, code de secours à usage unique, verrouillage),
// pas la validité du SQL réel (à valider sur une vraie base : voir LIMITES dans le changelog). Lancer : node test/access-keys-gate-sim.js
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
const assert = require('assert'), Module = require('module');
const L = require('../src/access_keys_logic');

// ---- Base factice, pilotée par motifs SQL ----
const st = { settings: new Map(), keys: [], uses: [], events: [], users: { 1: { password_hash: 'hash:secret', name: 'Modibo' } } };
const live = k => k.status === 'disponible' && (!k.expires_at || k.expires_at > Date.now());
const pool = { async query(sql, p = []) {
  sql = sql.replace(/\s+/g, ' ');
  let m;
  if (/SELECT value FROM app_settings WHERE key = \$1/.test(sql)) return { rows: st.settings.has(p[0]) ? [{ value: st.settings.get(p[0]) }] : [] };
  if (/SELECT COUNT\(\*\)::int AS n FROM access_keys WHERE status = 'disponible'/.test(sql)) return { rows: [{ n: st.keys.filter(live).length }] };
  if (/SELECT id, status, expires_at FROM access_keys WHERE key_hash = \$1/.test(sql)) return { rows: st.keys.filter(k => k.key_hash === p[0]) };
  if (/INSERT INTO access_key_uses/.test(sql)) {
    const k = st.keys.find(x => x.id === p[0]);
    if (!k || !live(k) || st.uses.some(u => u.key_id === p[0] && u.device_hash === p[1])) return { rows: [] };
    st.uses.push({ key_id: p[0], device_hash: p[1] }); return { rows: [{ id: st.uses.length }] };
  }
  if (/SELECT 1 FROM access_key_uses WHERE key_id = \$1 AND device_hash = \$2/.test(sql)) return { rows: st.uses.some(u => u.key_id === p[0] && u.device_hash === p[1]) ? [{}] : [] };
  if (/FROM access_key_uses u JOIN access_keys k/.test(sql)) return { rows: st.uses.some(u => u.device_hash === p[0] && st.keys.find(k => k.id === u.key_id).status !== 'revoquee') ? [{}] : [] };
  if (/INSERT INTO access_key_events/.test(sql)) { st.events.push(p[0]); return { rows: [] }; }
  if (/^UPDATE app_settings SET value = jsonb_build_object/.test(sql)) {
    const v = st.settings.get(p[0]);
    if (v && v.hash === p[1]) { st.settings.set(p[0], { hint: v.hint, created_at: v.created_at, created_by_name: v.created_by_name, used_at: new Date().toISOString() }); return { rows: [{ key: p[0] }] }; }
    return { rows: [] };
  }
  if (/^INSERT INTO app_settings/.test(sql)) { st.settings.set(p[0], JSON.parse(p[1])); return { rows: [] }; }
  if (/SELECT password_hash, COALESCE/.test(sql)) return { rows: [st.users[p[0]]] };
  if (/^DELETE FROM app_settings/.test(sql)) { st.settings.delete(p[0]); return { rows: [] }; }
  throw new Error('SQL non prévu par la simulation : ' + sql.slice(0, 90));
} };

// ---- Doublures des modules externes ----
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const routers = [];
const Router = () => { const r = { routes: {}, use() {} }; ['get', 'post', 'put', 'delete'].forEach(m => { r[m] = (path, ...h) => { r.routes[m.toUpperCase() + ' ' + path] = h; }; }); routers.push(r); return r; };
const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
const stubs = {
  express: { Router }, 'express-rate-limit': () => (req, res, next) => next(), zod: { z: chain }, bcryptjs: { compare: async (a, b) => b === 'hash:' + a },
  './core': { pool, wrap: fn => fn, body: () => (req, res, next) => next(), audit: async () => {}, HttpError }
};
const orig = Module._load; Module._load = function (r, ...a) { return stubs[r] || orig.call(this, r, ...a); };
const K = require('../src/access_keys'); Module._load = orig;
const [pub, admin] = routers, last = (r, k) => { const h = r.routes[k]; assert(h, 'route absente : ' + k); return h[h.length - 1]; };

// ---- Navigateur simulé (jar de cookies) ----
const browser = (ip = '10.0.0.1') => { const jar = {};
  const mk = (body, user) => ({ headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('; ') }, body: body || {}, ip, secure: false, user });
  const rs = () => ({ cookies: [], statusCode: 200, body: null, headers: {}, append(k, v) { this.cookies.push(v); }, set(k, v) { this.headers[k] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
  const absorb = res => res.cookies.forEach(c => { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); });
  return { jar,
    async call(router, key, body, user) { const res = rs(); await last(router, key)(mk(body, user), res); absorb(res); return res; },
    async gate() { const res = rs(); let opened = false; await K.requireGate(mk(), res, () => { opened = true; }); absorb(res); return { opened, res }; } };
};
let n = 0; const ok = async (name, fn) => { await fn(); n++; console.log('✔', name); };
const reset = () => { st.settings.clear(); st.keys.length = 0; st.uses.length = 0; st.events.length = 0; };
const policy = (required = true) => { st.settings.set('access_key_policy', { required, pass_minutes: 60 }); };
const addKey = (key, o = {}) => { const k = { id: st.keys.length + 1, key_hash: L.hashKey(key), status: 'disponible', expires_at: null, ...o }; st.keys.push(k); return k; };
const SA = { id: 1, is_global: true };
const dropPolicyCache = async () => { await last(admin, 'GET /admin/access-keys/settings')({ user: SA }, { json() {} }); };   // force=true : vide le cache de politique

(async () => {
  await ok('SCÉNARIO UTILISATEUR : clé expirée + laissez-passer échu → l’appareil déjà enrôlé reste admis, sans ressaisie', async () => {
    reset(); policy(); const key = addKey('4821', { expires_at: Date.now() + 3600e3 }); await dropPolicyCache();
    const A = browser(); const r = await A.call(pub, 'POST /access/verify', { key: '4821' });
    assert.strictEqual(r.statusCode, 200); assert(A.jar.smp_gate && A.jar.smp_dev);
    key.expires_at = Date.now() - 1000;                    // la clé expire
    delete A.jar.smp_gate;                                  // le laissez-passer (60 min) est échu
    const g = await A.gate(); assert(g.opened, 'appareil de confiance refusé'); assert(A.jar.smp_gate, 'laissez-passer non renouvelé');
    const s = await A.call(pub, 'GET /access/status'); assert.strictEqual(s.body.ok, true);
    delete A.jar.smp_gate; const v = await A.call(pub, 'POST /access/verify', { key: '0000' }); assert.strictEqual(v.statusCode, 200); assert.strictEqual(v.body.trusted, true);
  });
  await ok('un NOUVEL appareil ne peut plus utiliser une clé expirée (l’enrôlement se ferme)', async () => {
    const B = browser('10.0.0.2'); const r = await B.call(pub, 'POST /access/verify', { key: '4821' });
    assert.strictEqual(r.statusCode, 401); assert.strictEqual(r.body.code, 'EXPIRED');
    const g = await B.gate(); assert(!g.opened); assert.strictEqual(g.res.statusCode, 403); assert.strictEqual(g.res.body.code, 'ACCESS_KEY_REQUIRED');
  });
  await ok('une clé enrôle chaque appareil UNE seule fois : pas de 2e utilisation enregistrée pour le même appareil', async () => {
    reset(); policy(); addKey('1111'); await dropPolicyCache();
    const A = browser(); assert.strictEqual((await A.call(pub, 'POST /access/verify', { key: '1111' })).statusCode, 200);
    assert.strictEqual(st.uses.length, 1);
    delete A.jar.smp_gate; assert.strictEqual((await A.call(pub, 'POST /access/verify', { key: '1111' })).statusCode, 200); assert.strictEqual(st.uses.length, 1, 'le même appareil ne doit pas consommer la clé une 2e fois');
    const B = browser('10.0.0.3'); assert.strictEqual((await B.call(pub, 'POST /access/verify', { key: '1111' })).statusCode, 200); assert.strictEqual(st.uses.length, 2);
  });
  await ok('la RÉVOCATION de la clé retire la confiance des appareils enrôlés avec elle', async () => {
    const A = browser(); await A.call(pub, 'POST /access/verify', { key: '1111' });   // enrôle A (clé 1 disponible)
    st.keys[0].status = 'revoquee'; delete A.jar.smp_gate;
    const g = await A.gate(); assert(!g.opened);
  });
  await ok('politique non exigée : la porte reste ouverte', async () => {
    reset(); policy(false); await dropPolicyCache(); const X = browser(); assert((await X.gate()).opened);
    assert.strictEqual((await X.call(pub, 'POST /access/verify', { key: '9999' })).body.required, false);
  });

  await ok('CODE DE SECOURS : génération protégée par mot de passe, code jamais stocké en clair', async () => {
    reset(); policy(); await dropPolicyCache();
    await assert.rejects(last(admin, 'POST /admin/access-keys/recovery/generate')({ user: SA, body: { password: 'mauvais' } }, { json() {} }), /Mot de passe incorrect/);
    assert(!st.settings.has('access_key_recovery'));
    let out; await last(admin, 'POST /admin/access-keys/recovery/generate')({ user: SA, body: { password: 'secret' } }, { json: b => { out = b; } });
    assert(L.isValidRecovery(out.code)); const stored = st.settings.get('access_key_recovery');
    assert(!JSON.stringify(stored).replace(/-/g, '').includes(L.normalizeRecovery(out.code))); assert.strictEqual(stored.hash, L.hashRecovery(out.code));
    st.code = out.code;
  });
  await ok('code de secours : ouvre l’écran de connexion une seule fois (2e usage refusé)', async () => {
    const B = browser('10.0.0.4'); assert(!(await B.gate()).opened);
    const r = await B.call(pub, 'POST /access/recovery', { code: st.code.toLowerCase() });      // casse tolérée
    assert.strictEqual(r.statusCode, 200); assert.strictEqual(r.body.recovery_used, true); assert((await B.gate()).opened);
    assert(st.events.includes('recovery'));
    const C = browser('10.0.0.5'); const r2 = await C.call(pub, 'POST /access/recovery', { code: st.code });
    assert.strictEqual(r2.statusCode, 401); assert(!(await C.gate()).opened);
    const info = await (async () => { let o; await last(admin, 'GET /admin/access-keys/recovery')({ user: SA }, { json: b => { o = b; } }); return o; })();
    assert.strictEqual(info.configured, false); assert(info.used_at);
  });
  await ok('code de secours : faux code / mauvais format refusés, verrou propre au secours, la saisie de clé n’est pas affectée', async () => {
    reset(); policy(); await dropPolicyCache(); st.settings.set('access_key_recovery', { hash: L.hashRecovery('ABCD-EFGH-JKLM-NP23'), hint: 'x' });
    const D = browser('10.0.0.6'); assert.strictEqual((await D.call(pub, 'POST /access/recovery', { code: 'abc' })).statusCode, 400);
    for (let i = 0; i < 4; i++) assert.strictEqual((await D.call(pub, 'POST /access/recovery', { code: 'ZZZZ-ZZZZ-ZZZZ-ZZ22' })).statusCode, 401);
    const six = await D.call(pub, 'POST /access/recovery', { code: 'ZZZZ-ZZZZ-ZZZZ-ZZ22' }); assert.strictEqual(six.statusCode, 401);   // 6e échec cumulé : verrou déclenché
    const locked = await D.call(pub, 'POST /access/recovery', { code: 'ABCD-EFGH-JKLM-NP23' }); assert.strictEqual(locked.statusCode, 429);
    const keyTry = await D.call(pub, 'POST /access/verify', { key: '1234' }); assert.strictEqual(keyTry.statusCode, 401, 'la saisie de clé ne doit pas être verrouillée par le secours');
  });
  await ok('paramètres Super Admin : clés actives et code de secours signalés ; exiger sans clé active reste refusé', async () => {
    reset(); policy(false); await dropPolicyCache(); let o; await last(admin, 'GET /admin/access-keys/settings')({ user: SA }, { json: b => { o = b; } });
    assert.strictEqual(o.live_keys, 0); assert.strictEqual(o.recovery_configured, false);
    await assert.rejects(last(admin, 'PUT /admin/access-keys/settings')({ user: SA, body: { required: true, pass_minutes: 60 } }, { json() {} }), /au moins une clé/);
    let del; await last(admin, 'POST /admin/access-keys/recovery/revoke')({ user: SA }, { json: b => { del = b; } }); assert.strictEqual(del.ok, true);
  });
  console.log(`\n${n}/${n} scénarios réussis.`);
})().catch(e => { console.error('✘ ÉCHEC :', e.message, '\n', e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
