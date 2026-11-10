// Tests unitaires de la logique des clés d'accès (sans base de données) : node test/access-keys-unit.js
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
const assert = require('assert');
const L = require('../src/access_keys_logic');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };

ok('clé : toujours 4 chiffres, zéros initiaux conservés', () => {
  assert.strictEqual(L.generateKey(() => 7), '0007'); assert.strictEqual(L.generateKey(() => 9999), '9999'); assert.strictEqual(L.generateKey(() => 0), '0000');
  for (let i = 0; i < 2000; i++) assert(/^\d{4}$/.test(L.generateKey()));
});
ok('validation du format', () => { ['1234', '0000'].forEach(k => assert(L.isValidKey(k))); ['123', '12345', 'abcd', '12 4', '', null, 1234].forEach(k => assert(!L.isValidKey(k))); });
ok('la clé n’est jamais stockée en clair : hachage stable, distinct par clé', () => {
  assert.strictEqual(L.hashKey('1234'), L.hashKey('1234')); assert.notStrictEqual(L.hashKey('1234'), L.hashKey('1235')); assert(!L.hashKey('1234').includes('1234'));
  assert.strictEqual(L.hintOf('1234'), '••34');
});
ok('chiffrement réversible (AES-GCM) et résistant à l’altération', () => {
  const e = L.encryptKey('4821'); assert.strictEqual(L.decryptKey(e), '4821'); assert(!e.includes('4821'));
  const parts = e.split('.'); parts[2] = Buffer.from('xxxx').toString('base64'); assert.throws(() => L.decryptKey(parts.join('.')));
  assert.notStrictEqual(L.encryptKey('4821'), L.encryptKey('4821'));   // IV aléatoire
});
ok('cookies : lecture et écriture sécurisées', () => {
  assert.deepStrictEqual(L.parseCookies('a=1; smp_dev=abc%20d'), { a: '1', smp_dev: 'abc d' });
  const c = L.cookie('smp_gate', 'v', { maxAgeSec: 60, secure: true }); assert(/HttpOnly/.test(c) && /SameSite=Lax/.test(c) && /Secure/.test(c) && /Max-Age=60/.test(c));
});
ok('laissez-passer : valide sur le bon appareil, refusé sinon, expire, rejette la falsification', () => {
  const dev = L.deviceHash('a'.repeat(48)), other = L.deviceHash('b'.repeat(48));
  const t = L.signPass({ devHash: dev, keyId: 5, expiresAt: Date.now() + 60000 });
  assert(L.verifyPass(t, dev)); assert(!L.verifyPass(t, other));
  assert(!L.verifyPass(t, dev, Date.now() + 61000));
  const [p, s] = t.split('.'); const forged = Buffer.from(JSON.stringify({ d: dev, k: 5, e: Date.now() + 9e9 })).toString('base64url') + '.' + s;
  assert(!L.verifyPass(forged, dev)); assert(!L.verifyPass('x', dev)); assert(!L.verifyPass(undefined, dev)); assert(!L.verifyPass(p + '.' + 'ab', dev));
});
ok('limiteur d’essais : 3 échecs libres puis délai doublant, plafonné, réinitialisable', () => {
  const lk = new L.Lockout(); const t0 = 1e12;
  assert.strictEqual(lk.fail('x', t0), 0); assert.strictEqual(lk.fail('x', t0), 0); assert.strictEqual(lk.fail('x', t0), 0);
  assert.strictEqual(lk.fail('x', t0), 60); assert.strictEqual(lk.check('x', t0 + 1000), 59);
  assert.strictEqual(lk.fail('x', t0 + 61000), 120); assert.strictEqual(lk.fail('x', t0 + 200000), 240);
  let t = t0 + 300000, last = 0; for (let i = 0; i < 12; i++) { last = lk.fail('x', t); t += 1000; } assert(last <= 1800 && last > 1700);
  lk.reset('x'); assert.strictEqual(lk.check('x', t), 0);
  assert.strictEqual(lk.check('x', t0 + 99 * 3600000), 0);
});
ok('statut effectif : une clé disponible dont la date est passée devient expirée', () => {
  const now = Date.now();
  assert.strictEqual(L.effectiveStatus({ status: 'disponible', expires_at: new Date(now - 1000) }, now), 'expiree');
  assert.strictEqual(L.effectiveStatus({ status: 'disponible', expires_at: new Date(now + 1000) }, now), 'disponible');
  assert.strictEqual(L.effectiveStatus({ status: 'disponible', expires_at: null }, now), 'disponible');
  assert.strictEqual(L.effectiveStatus({ status: 'revoquee', expires_at: null }, now), 'revoquee');
});
ok('code de secours : 16 caractères sans I/O/0/1, groupes de 4, normalisation tolérante', () => {
  for (let i = 0; i < 2000; i++) { const c = L.generateRecoveryCode(); assert(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/.test(c), c); assert(L.isValidRecovery(c)); }
  const c = 'ABCD-EFGH-JKLM-NP23';
  assert.strictEqual(L.hashRecovery(c), L.hashRecovery(' abcd efgh-jklm np23 ')); assert.notStrictEqual(L.hashRecovery(c), L.hashRecovery('ABCD-EFGH-JKLM-NP24'));
  assert(!L.hashRecovery(c).includes('ABCD')); assert.strictEqual(L.hintRecovery(c), '••••-••••-••••-NP23');
  ['', null, undefined, 'ABCD', 'ABCD-EFGH-JKLM-NP2I', 'ABCD-EFGH-JKLM-NP20', 'ABCD-EFGH-JKLM-NP234'].forEach(x => assert(!L.isValidRecovery(x), String(x)));
});
ok('code de secours : le hachage diffère de celui d’une clé (étiquettes séparées)', () => {
  assert.notStrictEqual(L.hashRecovery('1234'), L.hashKey('1234'));
});
console.log(`\n${n}/${n} tests réussis.`);
