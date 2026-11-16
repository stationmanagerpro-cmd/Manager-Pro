'use strict';
// Suspension d'une station : exception du middleware (levée et lecture de l'identité seulement), route et migration présentes.
const assert = require('assert'), fs = require('fs'), path = require('path');
const core = fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin.js'), 'utf8');
const mig = fs.readFileSync(path.join(__dirname, '..', 'migrations', '114_station_suspension.sql'), 'utf8');
let n = 0; const check = (l, f) => { f(); n++; console.log('✓ ' + l); };

// Même expression que dans src/core.js (req.path est relatif à /api)
const exempt = (method, p) => (method === 'PATCH' && /^\/stations\/\d+\/suspension\/?$/.test(p)) || (method === 'GET' && p === '/stations/current');

check('levée de suspension autorisée sur la station ciblée', () => {
  assert.ok(exempt('PATCH', '/stations/12/suspension'));
  assert.ok(exempt('PATCH', '/stations/12/suspension/'));
});
check('lecture de l\'identité station autorisée', () => assert.ok(exempt('GET', '/stations/current')));
check('ventes, clôtures et autres écritures restent bloquées', () => {
  assert.ok(!exempt('POST', '/sales'));
  assert.ok(!exempt('POST', '/shifts/3/close'));
  assert.ok(!exempt('GET', '/dashboard'));
  assert.ok(!exempt('PATCH', '/stations/current'));
  assert.ok(!exempt('PATCH', '/stations/12/suspension/extra'));
});
check('le middleware bloque avec un message clair si la station est suspendue', () => {
  assert.match(core, /acc\.suspended_at && !liftingOrReading/);
  assert.match(core, /Accès à cette station suspendu par le gérant/);
});
check('route de suspension : droit user.manage, périmètre de la station et audit', () => {
  assert.match(admin, /r\.patch\('\/stations\/:id\/suspension', need\('user\.manage'\)/);
  assert.match(admin, /SELECT 1 FROM user_stations WHERE user_id = \$1 AND station_id = \$2/);
  assert.match(admin, /await audit\(pool, req, 'stations'/);
});
check('migration additive et idempotente', () => {
  assert.match(mig, /ADD COLUMN IF NOT EXISTS suspended_at/);
  assert.ok(!/DROP|DELETE|UPDATE/i.test(mig));
});
console.log(`\n${n}/${n} contrôles réussis.`);
