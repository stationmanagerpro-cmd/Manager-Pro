'use strict';
/** Chiffrement du contenu des notifications push (RFC 8291, aes128gcm) avec le module crypto de Node — sans dépendance. */
const crypto = require('crypto');

const b64u = s => Buffer.from(String(s), 'base64url');

/** Chiffre `plaintext` pour un abonnement {p256dh, auth} (base64url). Retourne le corps HTTP à envoyer. */
function encrypt(plaintext, p256dh, auth, opts = {}) {
  const uaPub = b64u(p256dh), authSecret = b64u(auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || authSecret.length !== 16) throw new Error('Clés d’abonnement invalides');
  const ecdh = crypto.createECDH('prime256v1');
  if (opts.privateKey) ecdh.setPrivateKey(opts.privateKey); else ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const salt = opts.salt || crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const data = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);   // 0x02 = dernier enregistrement
  if (data.length > 3990) throw new Error('Contenu trop long');
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const enc = Buffer.concat([c.update(data), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, enc]);
}

/** Déchiffrement (utilisé par les tests pour vérifier l'aller-retour côté « navigateur »). */
function decrypt(body, uaPrivate, p256dh, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), enc = body.subarray(21 + idlen);
  const uaPub = b64u(p256dh);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, b64u(auth), Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(enc.subarray(enc.length - 16));
  const plain = Buffer.concat([d.update(enc.subarray(0, enc.length - 16)), d.final()]);
  let i = plain.length - 1; while (i >= 0 && plain[i] === 0) i--;
  return plain.subarray(0, i).toString();   // retire le délimiteur 0x02
}

module.exports = { encrypt, decrypt };
