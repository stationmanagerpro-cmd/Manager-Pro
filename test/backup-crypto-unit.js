'use strict';
// Chiffrement des sauvegardes (audit D3-B) : exécute le vrai code de src/backup_crypto.js et du script de déchiffrement.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const zlib = require('zlib');
const { encryptBuffer, decryptBuffer, isConfigured } = require('../src/backup_crypto');
const KEY = 'une-phrase-secrete-longue-2026';
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✓ ' + label); }
const dump = zlib.gzipSync(Buffer.from('-- dump SQL de test\nCREATE TABLE t(id int);\n'.repeat(500)));

check('aller-retour : le contenu déchiffré est identique', () => assert.ok(decryptBuffer(encryptBuffer(dump, KEY), KEY).equals(dump)));
check('le fichier chiffré ne contient pas le contenu en clair et commence par SMPENC1', () => {
  const enc = encryptBuffer(Buffer.from('MOT-DE-PASSE-SECRET-ABCDEFGH'), KEY);
  assert.ok(enc.subarray(0, 7).toString() === 'SMPENC1');
  assert.ok(!enc.includes('MOT-DE-PASSE-SECRET'));
});
check('deux chiffrements du même contenu diffèrent (sel et IV aléatoires)', () => assert.ok(!encryptBuffer(dump, KEY).equals(encryptBuffer(dump, KEY))));
check('mauvaise clé refusée', () => assert.throws(() => decryptBuffer(encryptBuffer(dump, KEY), 'une-autre-phrase-secrete-xx'), /clé incorrecte ou fichier altéré/));
check('fichier altéré refusé (intégrité GCM)', () => {
  const enc = encryptBuffer(dump, KEY); enc[enc.length - 5] ^= 0xff;
  assert.throws(() => decryptBuffer(enc, KEY), /altéré/);
});
check('fichier sans en-tête refusé', () => assert.throws(() => decryptBuffer(Buffer.from('pas un fichier chiffré du tout, vraiment pas'.repeat(3)), KEY), /invalide/));
check('clé absente ou trop courte refusée', () => {
  assert.throws(() => encryptBuffer(dump, ''), /BACKUP_ENCRYPTION_KEY/);
  assert.throws(() => encryptBuffer(dump, 'court'), /16 caractères/);
  assert.strictEqual(isConfigured('court'), false); assert.strictEqual(isConfigured(KEY), true);
});
check('script scripts/decrypt-backup.js : restitue le fichier et refuse d’écraser', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')), src = path.join(d, 'smp.sql.gz.enc'), out = path.join(d, 'smp.sql.gz');
  fs.writeFileSync(src, encryptBuffer(dump, KEY));
  const run = () => execFileSync('node', [path.join(__dirname, '../scripts/decrypt-backup.js'), src], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY }, stdio: 'pipe' });
  run(); assert.ok(fs.readFileSync(out).equals(dump));
  assert.throws(run, /./);
});
check('backup.js : chiffre la pièce jointe, et ne joint rien en clair sans clé ni choix explicite', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/backup.js'), 'utf8');
  assert.match(src, /crypt\.isConfigured\(\)/); assert.match(src, /crypt\.encryptBuffer\(/);
  assert.match(src, /BACKUP_EMAIL_ATTACH_PLAINTEXT === '1'/);
});
console.log(`${passed}/${passed} contrôles réussis`);
