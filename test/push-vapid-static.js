'use strict';
const assert = require('assert');
const fs = require('fs');
const v = require('../src/push_vapid');
const k = v.generateVapidKeys();
assert.strictEqual(Buffer.from(k.publicKey, 'base64url').length, 65);
assert.strictEqual(Buffer.from(k.publicKey, 'base64url')[0], 4);
const h = v.authorizationHeader(k, 'https://fcm.googleapis.com/fcm/send/abc', 'mailto:a@b.c');
const m = /^vapid t=([^,]+), k=(.+)$/.exec(h); assert.ok(m); assert.strictEqual(m[2], k.publicKey);
assert.ok(v.verifyJwt(m[1], k.publicKey), 'signature VAPID valide');
const claims = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url'));
assert.strictEqual(claims.aud, 'https://fcm.googleapis.com'); assert.ok(claims.exp > Date.now() / 1000);
const other = v.generateVapidKeys(); assert.ok(!v.verifyJwt(m[1], other.publicKey), 'mauvaise clé refusée');
const sw = fs.readFileSync(__dirname + '/../public/sw.js', 'utf8');
assert.match(sw, /addEventListener\('push'/); assert.match(sw, /showNotification/);
assert.match(fs.readFileSync(__dirname + '/../src/server.js', 'utf8'), /require\('\.\/push'\)\.r/);
console.log('push-vapid : OK');
// Chiffrement du contenu (RFC 8291) : aller-retour avec une clé d'appareil simulée
{
  const crypto = require('crypto'); const pc = require('../src/push_crypto');
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  const body = pc.encrypt(JSON.stringify({ title: 'Alerte', body: 'Rupture de cuve prévue é ✓' }), ua.getPublicKey().toString('base64url'), auth);
  assert.strictEqual(body[20], 65);
  assert.deepStrictEqual(JSON.parse(pc.decrypt(body, ua.getPrivateKey(), ua.getPublicKey().toString('base64url'), auth)), { title: 'Alerte', body: 'Rupture de cuve prévue é ✓' });
  assert.throws(() => pc.decrypt(body, ua.getPrivateKey(), ua.getPublicKey().toString('base64url'), crypto.randomBytes(16).toString('base64url')));
  // Vecteur officiel RFC 8291 §5
  const b = s => Buffer.from(s, 'base64url');
  const plain = 'When I grow up, I want to be a watermelon';
  const asPriv = b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw');
  const uaPub = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
  const out = pc.encrypt(plain, uaPub, 'BTBZMqHH6r4Tts7J_aSIgg', { privateKey: asPriv, salt: b('DGv6ra1nlYgDCS1FRnbzlw') });
  assert.strictEqual(out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
}
console.log('push-chiffrement : OK');
