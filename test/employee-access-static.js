'use strict';
// Contrôles statiques : dépenses de caisse réservées + rôle individuel par employé (câblage, migration, interface).
const assert = require('assert'), fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
const mig = rd('migrations/089_role_individuel_et_depenses.sql');
check('migration 089 : colonne personal_user_id (unique) et retrait de expense.create du rôle commun Caissier', () => {
  assert(/ADD COLUMN IF NOT EXISTS personal_user_id BIGINT REFERENCES users/.test(mig) && /CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_personal_user/.test(mig));
  assert(/code = 'CAISSIER' AND client_id IS NULL/.test(mig) && /code = 'expense\.create'/.test(mig));
  assert(!/DROP TABLE|TRUNCATE|DELETE FROM (users|roles|employees)/i.test(mig));
});
check('installation neuve : le caissier n\'a plus la saisie de dépenses ; gérant et comptable la gardent', () => {
  const m = rd('src/setup.js'); const cais = m.match(/CAISSIER: \[([\s\S]*?)\]/)[1], ger = m.match(/GERANT: \[([\s\S]*?)\]/)[1];
  assert(!/expense\.create/.test(cais) && /expense\.create/.test(ger));
});
check('la saisie d\'une dépense reste protégée côté serveur par expense.create', () => assert(/r\.post\('\/expenses', need\('expense\.create'\)/.test(rd('src/operations.js'))));
check('les rôles individuels sont masqués des listes, hors plafond de 30 rôles, et épargnés par la synchronisation fonction/rôle', () => {
  const a = rd('src/admin.js'); assert((a.match(/r\.personal_user_id IS NULL/g) || []).length >= 2 && /AND personal_user_id IS NULL', \[clientId\]/.test(a));
  assert(/r\.personal_user_id IS NULL`/.test(rd('src/auth.js')));
  const s = rd('src/role_sync.js'); assert((s.match(/personal_user_id IS NOT NULL/g) || []).length === 2);
});
check('module monté et onglet « Accès & rôle » dans la fiche employé', () => {
  assert(/require\('\.\/employee_access'\)/.test(rd('src/server.js')));
  const u = rd('public/ext-core.js'); assert(/async acces\(e\)/.test(u) && /window\.accEdit/.test(u) && /Donner un rôle individuel/.test(u) && /\['acces', '🔐', 'Accès & rôle'\]/.test(u));
});
console.log(`\n${n}/5 contrôles réussis.`);
