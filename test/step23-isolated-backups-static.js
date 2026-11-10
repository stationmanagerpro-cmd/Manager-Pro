const fs = require('fs'); const path = require('path'); const assert = require('assert');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root,'src/tenant-backups.js'),'utf8');
const server = fs.readFileSync(path.join(root,'src/server.js'),'utf8');
const clientUI = fs.readFileSync(path.join(root,'public/ext-detail-pages.js'),'utf8');
const platformUI = fs.readFileSync(path.join(root,'public/ext-fin.js'),'utf8');
const migration = fs.readFileSync(path.join(root,'migrations/041_isolated_backup_operation_types.sql'),'utf8');
const checks = [
  ['routes réservées au Super Admin', src.includes('needGlobal') && /needGlobal/.test(src)],
  ['mot de passe requis avant sauvegarde/restauration', src.includes('verifyPassword(req') && src.includes('bcrypt.compare')],
  ['archive client identifiée par son client ID', src.includes('smp-client-${id}-') && src.includes('Number(pkg.client?.id)!==Number(targetId)')],
  ['archive client en format logique compressé', src.includes('station-manager-pro-logical-backup') && src.includes('gzipSync')],
  ['sélection des lignes par client_id et station_id', src.includes("t.cols.includes('client_id')") && src.includes("t.cols.includes('station_id')")],
  ['exclusion des sessions des archives', src.includes("new Set(['user_sessions', 'backup_logs'")],
  ['restauration client transactionnelle', src.includes("await c.query('BEGIN')") && src.includes("await c.query('ROLLBACK')") && src.includes('isolated-restore')],
  ['refus de restauration d’une archive d’un autre client', src.includes('Cette sauvegarde n’appartient pas au client sélectionné')],
  ['réinitialisation client avec sauvegarde préalable', src.includes("createPackage('client',id)") && src.includes('isolated-reset')],
  ['archive distincte pour la plateforme', src.includes("createPackage('platform')") && src.includes('platform-backups')],
  ['restauration plateforme sans données client', src.includes('sans données clients') && src.includes("const allowed=new Set(['users','roles','permissions','role_permissions','app_settings','settings'])")],
  ['routage ajouté au serveur', server.includes("require('./tenant-backups')")],
  ['interface maintenance client', clientUI.includes('createClientBackup') && clientUI.includes('restoreClientBackup') && clientUI.includes('resetClientData')],
  ['interface sauvegarde Super Admin dans Paramètres', platformUI.includes('createPlatformBackup') && platformUI.includes('restorePlatformBackup')],
  ['historique filtré par scope et client', src.includes("meta->>'scope'='client'") && src.includes("meta->>'client_id'=$1")],
  ['migration conserve et étend les types d’opération', migration.includes('client-backup') && migration.includes('platform-restore')]
];
let failures=0; for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failures++;}
console.log(`${checks.length-failures}/${checks.length} contrôles statiques réussis`); if(failures)process.exit(1);
