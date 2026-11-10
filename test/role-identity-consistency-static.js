// Contrôles statiques de la cohérence des identités de rôle. node test/role-identity-consistency-static.js
const fs = require('fs'), assert = require('assert');
const read = p => fs.readFileSync(p, 'utf8');
let n = 0; const ok = (label, fn) => { fn(); n++; console.log('✔ ' + label); };
const core = read('src/core.js'), auth = read('src/auth.js'), mig = read('migrations/063_role_identity_consistency.sql'), scope = read('src/roles_scope.js');
ok('authentification refuse un compte global sans SUPERADMIN', () => assert(/u\.is_global && u\.role !== 'SUPERADMIN'/.test(core)));
ok('authentification refuse SUPERADMIN sur un compte local', () => assert(/!u\.is_global && u\.role === 'SUPERADMIN'/.test(core)));
ok('création interdit une identité globale avec rôle ADMIN', () => assert(/b\.is_global && b\.role !== 'SUPERADMIN'/.test(auth)));
ok('création interdit SUPERADMIN pour les comptes locaux', () => assert(/!b\.is_global && b\.role === 'SUPERADMIN'/.test(auth)));
ok('changement de rôle ne peut pas dégrader un compte de plateforme', () => assert(/target\.is_global && newRole !== 'SUPERADMIN'/.test(auth)));
ok('changement de rôle ne peut pas promouvoir un compte local en Superadmin', () => assert(/!target\.is_global && newRole === 'SUPERADMIN'/.test(auth)));
ok('migration normalise les comptes globaux', () => assert(/UPDATE users[\s\S]*WHERE is_global = TRUE/.test(mig)));
ok('migration normalise les comptes locaux mal affectés', () => assert(/WHERE is_global = FALSE[\s\S]*SUPERADMIN/.test(mig)));
ok('le périmètre de délégation reste appliqué', () => assert(/assertDelegable/.test(scope) && /assertAssignableRole/.test(scope)));
console.log(`\n${n}/${n} contrôles statiques réussis.`);
