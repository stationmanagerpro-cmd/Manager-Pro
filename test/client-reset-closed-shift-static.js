const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'src/tenant-backups.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/059_audited_client_reset_closed_shifts.sql'), 'utf8');
const checks = [
  ['réinitialisation réservée au Super Admin et protégée par mot de passe', /isolated-reset[^\n]*needGlobal/.test(route) && route.includes('verifyPassword(req,req.body?.superadmin_password)')],
  ['phrase de confirmation exacte exigée', route.includes("req.body?.confirmation!=='REINITIALISER CE CLIENT'")],
  ['sauvegarde isolée préalable créée avant transaction', route.includes("const b=await createPackage('client',id);const c=await pool.connect()")],
  ['exception au verrou de quart limitée à la transaction dédiée', route.includes("set_config('station_manager.audited_client_reset','on',true)")],
  ['migration ne permet que DELETE en contexte de réinitialisation auditée', /TG_OP\s*=\s*'DELETE'[\s\S]*current_setting\('station_manager\.audited_client_reset', true\) = 'on'[\s\S]*RETURN OLD/.test(migration)],
  ['verrou maintenu pour toute autre modification d’un quart clôturé', migration.includes("RAISE EXCEPTION 'Quart % clôturé : modification interdite")],
  ['audit inscrit dans la transaction avant validation', /applyPackage\(c,pkg,id,\{reset:true\}\);await audit\(c,req,'maintenance'/.test(route) && /await audit\(c,req,'maintenance'[\s\S]*await c\.query\('COMMIT'\)/.test(route)],
  ['transaction annulée en cas d’erreur', /await c\.query\('ROLLBACK'\)\.catch\(\(\)=>\{\}\);throw e/.test(route)],
];
let failures = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failures++; }
console.log(`${checks.length - failures}/${checks.length} assertions statiques réussies`);
if (failures) process.exit(1);
