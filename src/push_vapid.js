'use strict';
// Web Push sans dépendance : clés VAPID (ES256) et en-tête d'autorisation. Les notifications sont envoyées SANS contenu
// (aucun chiffrement de charge utile nécessaire) : le service worker affiche un message générique et ouvre l'application.
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');

function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  return {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')])),
    privateJwk: privateKey.export({ format: 'jwk' })
  };
}

function signJwt(keys, audience, subject, nowSec = Math.floor(Date.now() / 1000)) {
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: subject }));
  const key = crypto.createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + claims), { key, dsaEncoding: 'ieee-p1363' });
  return head + '.' + claims + '.' + b64u(sig);
}

function authorizationHeader(keys, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  return 'vapid t=' + signJwt(keys, aud, subject) + ', k=' + keys.publicKey;
}

function verifyJwt(jwt, publicKeyB64u) {
  const [h, c, s] = jwt.split('.');
  const raw = Buffer.from(publicKeyB64u, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
  return crypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
}

module.exports = { generateVapidKeys, signJwt, authorizationHeader, verifyJwt };
