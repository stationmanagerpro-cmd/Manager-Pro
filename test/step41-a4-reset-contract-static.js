// Étape 41 — garde-fous statiques ciblés sur la fiche A4.
// Ce test ne remplace pas une recette d'intégration PostgreSQL.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/tenant-backups.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/059_audited_client_reset_closed_shifts.sql'), 'utf8');
const checks = [
  ['réinitialisation désactivée sauf activation explicite CLIENT_RESET_ENABLED=1', /process\.env\.CLIENT_RESET_ENABLED!=='1'[\s\S]{0,180}Réinitialisation client désactivée par sécurité/.test(route)],
  ['données identité/contrat/stations/utilisateurs exclues du nettoyage', /const protectedTables = new Set\(\['clients','client_contracts','stations','users','roles','permissions','role_permissions','licenses','client_licenses','schema_migrations','migrations','app_migrations','app_settings','settings'\]\)/.test(route)],
  ['nettoyage limité aux tables présentes dans le paquet isolé courant', /const current = await scopedRows\(client, targetId\)[\s\S]{0,450}if \(protectedTables\.has\(name\) \|\| !current\.tables\[name\]\) continue/.test(route)],
  ['sauvegarde client créée avant le début de la transaction destructive', /const b=await createPackage\('client',id\);const c=await pool\.connect\(\);let result;try\{await c\.query\('BEGIN'\)/.test(route)],
  ['auditeur et nettoyage sont validés dans la même transaction', /applyPackage\(c,pkg,id,\{reset:true\}\);await audit\(c,req,'maintenance'[\s\S]{0,350}await c\.query\('COMMIT'\)/.test(route)],
  ['toute erreur déclenche un rollback avant libération de connexion', /catch\(e\)\{await c\.query\('ROLLBACK'\)\.catch\(\(\)=>\{\}\);throw e;\}finally\{c\.release\(\);\}/.test(route)],
  ['exception aux quarts clôturés limitée au DELETE et au contexte transactionnel', /TG_OP\s*=\s*'DELETE'[\s\S]*current_setting\('station_manager\.audited_client_reset', true\) = 'on'[\s\S]*RETURN OLD/.test(migration) && /RAISE EXCEPTION 'Quart % clôturé : modification interdite/.test(migration)],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
console.log(`${checks.length - failed}/${checks.length} contrôles A4 étape 41 réussis`);
if (failed) process.exit(1);
