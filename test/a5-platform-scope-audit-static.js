const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const backups = fs.readFileSync(path.join(root, 'src/tenant-backups.js'), 'utf8');
const maintenance = fs.readFileSync(path.join(root, 'src/maintenance.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/ext-p12.js'), 'utf8');
const checks = [
  ['le paquet logique plateforme utilise une liste explicite de tables', /if \(platform\) \{\s*for \(const name of \['users','roles','permissions','role_permissions','app_settings','settings'\]/s.test(backups)],
  ['les utilisateurs inclus dans la sauvegarde plateforme sont uniquement globaux', /name==='users'\) rows=\(await client\.query\('SELECT \* FROM public\.users WHERE is_global=true'\)\)\.rows/.test(backups)],
  ['la restauration logique plateforme utilise une liste autorisée limitée', /const allowed=new Set\(\['users','roles','permissions','role_permissions','app_settings','settings'\]\)/.test(backups)],
  ['les paramètres rattachés à un client ou une station sont ignorés lors de la restauration', /t\.cols\.includes\('client_id'\)&&row\.client_id!=null/.test(backups) && /t\.cols\.includes\('station_id'\)&&row\.station_id!=null/.test(backups)],
  ['la réinitialisation globale SQL reste suspendue côté API', maintenance.includes('global_reset_enabled: false') && maintenance.includes('Réinitialisation globale suspendue par sécurité')],
  ['la route de reset ne contient plus de suppression générique', (() => { const a=maintenance.indexOf("r.post('/admin/maintenance/reset-global'"); const b=maintenance.indexOf('\nmodule.exports = r;', a); const route=maintenance.slice(a,b); return !route.includes('DELETE FROM public.') && !route.includes('planOrder(tables'); })()],
  ['la restauration SQL complète exige deux verrous explicites (RESTORE_ENABLED et RESTORE_TARGET_ISOLATED)', /process\.env\.RESTORE_ENABLED !== '1' \|\| process\.env\.RESTORE_TARGET_ISOLATED !== '1'/.test(maintenance) && /restore_enabled: process\.env\.RESTORE_ENABLED === '1' && process\.env\.RESTORE_TARGET_ISOLATED === '1'/.test(maintenance)],
  ['la restauration SQL complète remplace le schéma public et doit être réservée à une base de reprise isolée', maintenance.includes('DROP SCHEMA IF EXISTS public CASCADE') && maintenance.includes('--single-transaction')],
  ['l’interface présente la restauration globale comme désactivée selon la configuration', ui.includes('Restauration SQL complète désactivée ou cible isolée non confirmée')]
];
let failed = 0;
for (const [label, check] of checks) { try { assert(check); console.log('PASS ' + label); } catch (e) { failed++; console.error('FAIL ' + label); } }
console.log(`${checks.length - failed}/${checks.length} contrôles A5 plateforme réussis.`);
if (failed) process.exit(1);
