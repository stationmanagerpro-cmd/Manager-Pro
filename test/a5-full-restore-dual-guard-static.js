const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
// Les documents de livraison sont rangés dans « Dossier CHANGELOG » (ou à la racine selon l'archive).
const docPath = name => [path.join(root, name), path.join(root, 'Dossier CHANGELOG', name)].find(p => fs.existsSync(p)) || path.join(root, name);
const api = fs.readFileSync(path.join(root, 'src/maintenance.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/ext-fin.js'), 'utf8') + fs.readFileSync(path.join(root, 'public/ext-p12.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, '.env.pc.example'), 'utf8');
const guide = fs.readFileSync(docPath('PROCEDURE_EXPLOITATION_ETAPE_30.md'), 'utf8');
const preflight = fs.readFileSync(path.join(root, 'scripts/windows/preflight-pc-server.ps1'), 'utf8');
const checks = [
  ['la route refuse si RESTORE_ENABLED est absent', /process\.env\.RESTORE_ENABLED !== '1' \|\| process\.env\.RESTORE_TARGET_ISOLATED !== '1'/.test(api)],
  ['la route refuse si RESTORE_TARGET_ISOLATED est absent', /process\.env\.RESTORE_ENABLED !== '1' \|\| process\.env\.RESTORE_TARGET_ISOLATED !== '1'/.test(api)],
  ['le statut UI ne déclare la restauration active que si les deux variables valent 1', /restore_enabled: process\.env\.RESTORE_ENABLED === '1' && process\.env\.RESTORE_TARGET_ISOLATED === '1'/.test(api)],
  ['la route avertit du remplacement complet du schéma et du risque pour les données clients', /remplace tout le schéma public et peut effacer les données de tous les clients/.test(api)],
  ['l’interface avertit de la nécessité d’une base isolée', /RESTORE_TARGET_ISOLATED=1/.test(ui) && /base isolée/.test(ui)],
  ['le remplacement du schéma reste transactionnel', api.includes('DROP SCHEMA IF EXISTS public CASCADE') && api.includes("'--single-transaction'")],
  ['la configuration exemple désactive les deux verrous', /RESTORE_ENABLED=0/.test(envExample) && /RESTORE_TARGET_ISOLATED=0/.test(envExample)],
  ['la procédure d’exploitation documente le double verrou et l’isolement', guide.includes('RESTORE_TARGET_ISOLATED=1') && /base de production/.test(guide)],
  ['le préflight Windows surveille aussi le verrou d’isolation', /'RESTORE_TARGET_ISOLATED'/.test(preflight)],
  ['le guide de livraison ne recommande plus un seul verrou', !/optionnel `RESTORE_ENABLED=1` \/ `RESET_GLOBAL_ENABLED=1`/.test(fs.readFileSync(docPath('README_LIVRAISON_COMPLETE_2026-10-13.md'), 'utf8'))]
];
let failed = 0;
for (const [label, ok] of checks) { try { assert(ok); console.log('PASS ' + label); } catch { failed++; console.error('FAIL ' + label); } }
console.log(`${checks.length - failed}/${checks.length} contrôles restauration complète réussis.`);
if (failed) process.exit(1);
