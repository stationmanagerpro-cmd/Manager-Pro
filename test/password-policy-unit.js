'use strict';
// Politique de mots de passe (audit D5) : exécute le vrai code de src/password_policy.js, sans base ni serveur.
const assert = require('assert');
const { checkPassword, minLength } = require('../src/password_policy');
delete process.env.PASSWORD_MIN_PRIVILEGED;
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✓ ' + label); }

check('compte ordinaire : 8 caractères minimum', () => {
  assert.strictEqual(minLength({ role: 'CAISSIER' }), 8);
  assert.ok(checkPassword('abc12', { role: 'CAISSIER' }));
  assert.strictEqual(checkPassword('Tr0ubadour!', { role: 'CAISSIER' }), null);
});
check('ADMIN, SUPERADMIN et compte de plateforme : 12 caractères minimum (RG-04)', () => {
  assert.strictEqual(minLength({ role: 'ADMIN' }), 12);
  assert.strictEqual(minLength({ role: 'superadmin' }), 12);
  assert.strictEqual(minLength({ role: 'GERANT', isGlobal: true }), 12);
  assert.match(checkPassword('Court123!', { role: 'ADMIN' }), /12 caractères/);   // 9 caractères : refusé
  assert.ok(checkPassword('Onze-char-1', { role: 'ADMIN' }));                    // 11 caractères : refusé
  assert.ok(checkPassword('Onze-char-1', { role: 'SUPERADMIN' }));
  assert.strictEqual(checkPassword('Onze-char-1', { role: 'CAISSIER' }), null);   // rôle ordinaire : accepté
  assert.strictEqual(checkPassword('Douze-char-12', { role: 'ADMIN' }), null);
  assert.strictEqual(checkPassword('Phrase-Longue-2026', { role: 'ADMIN' }), null);
});
check('mot de passe temporaire généré (24 caractères hexadécimaux) accepté', () => {
  const tmp = require('crypto').randomBytes(12).toString('hex');
  assert.strictEqual(tmp.length, 24);
  assert.strictEqual(checkPassword(tmp, { role: 'ADMIN', login: 'admin' }), null);
});
check('mots de passe courants refusés (casse ignorée)', () => {
  assert.match(checkPassword('PASSWORD123', { role: 'CAISSIER' }), /trop courant/);
  assert.match(checkPassword('azertyuiop', { role: 'CAISSIER' }), /trop courant/);
  assert.match(checkPassword('AdminAdmin123', { role: 'ADMIN' }), /trop courant/);
});
check('un seul caractère répété refusé', () => assert.match(checkPassword('aaaaaaaaaaaa', { role: 'ADMIN' }), /répété/));
check('identique à l’identifiant refusé', () => assert.match(checkPassword('Marie.Diarra', { role: 'CAISSIER', login: 'marie.diarra' }), /identifiant/));
check('PASSWORD_MIN_PRIVILEGED réglable, jamais sous 12', () => {
  process.env.PASSWORD_MIN_PRIVILEGED = '14'; assert.strictEqual(minLength({ role: 'ADMIN' }), 14);
  process.env.PASSWORD_MIN_PRIVILEGED = '8'; assert.strictEqual(minLength({ role: 'ADMIN' }), 12);
  process.env.PASSWORD_MIN_PRIVILEGED = 'abc'; assert.strictEqual(minLength({ role: 'ADMIN' }), 12);
  delete process.env.PASSWORD_MIN_PRIVILEGED;
});
check('auth.js applique la politique à la création de compte et au changement de mot de passe', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/auth.js'), 'utf8');
  assert.ok((src.match(/password_policy'\)\.checkPassword/g) || []).length >= 2);
});
console.log(`${passed}/${passed} contrôles réussis`);
