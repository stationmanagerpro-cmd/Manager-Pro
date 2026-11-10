'use strict';
// Durée de session (audit D1) : exécute le vrai code de src/session_policy.js et vérifie son branchement dans auth.js.
const assert = require('assert');
const { sessionHours } = require('../src/session_policy');
const src = require('fs').readFileSync(require('path').join(__dirname, '../src/auth.js'), 'utf8');
let passed = 0;
function check(label, fn) { delete process.env.SESSION_HOURS; delete process.env.SESSION_HOURS_PRIVILEGED; fn(); passed++; console.log('✓ ' + label); }
check('compte ordinaire : 12 h par défaut', () => assert.strictEqual(sessionHours({ role: 'CAISSIER' }), 12));
check('ADMIN, SUPERADMIN et compte de plateforme : 4 h par défaut', () => {
  assert.strictEqual(sessionHours({ role: 'ADMIN' }), 4);
  assert.strictEqual(sessionHours({ role: 'superadmin' }), 4);
  assert.strictEqual(sessionHours({ role: 'GERANT', isGlobal: true }), 4);
});
check('variables d’environnement prises en compte', () => {
  process.env.SESSION_HOURS = '10'; process.env.SESSION_HOURS_PRIVILEGED = '2';
  assert.strictEqual(sessionHours({ role: 'CAISSIER' }), 10); assert.strictEqual(sessionHours({ role: 'ADMIN' }), 2);
});
check('valeurs invalides ou hors 1–24 : retour au défaut', () => {
  for (const v of ['0', '25', 'abc', '-3', '']) { process.env.SESSION_HOURS_PRIVILEGED = v; assert.strictEqual(sessionHours({ role: 'ADMIN' }), 4); }
});
check('auth.js : session en base et jeton partagent la même durée', () => {
  assert.match(src, /sessionHours\(\{ role: u\.role, isGlobal: u\.is_global \}\)/);
  assert.match(src, /make_interval\(hours => \$3::int\)/);
  assert.match(src, /expiresIn: hours \+ 'h'/);
  assert.doesNotMatch(src, /interval '12 hours'/);
});
console.log(`${passed}/${passed} contrôles réussis`);
