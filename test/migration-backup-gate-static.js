// Contrôles statiques A1 : aucune migration sur base peuplée ne doit contourner la sauvegarde.
const fs = require('fs');
const assert = require('assert');
const runner = fs.readFileSync('src/migrate.js', 'utf8');
const backup = fs.readFileSync('src/backup.js', 'utf8');
assert(/pending\.length && hasData/.test(runner), 'le garde-fou cible toute base contenant des données avec migrations en attente');
assert(/information_schema\.tables/.test(runner) && /SELECT EXISTS \(SELECT 1 FROM public\./.test(runner), 'le contrôle examine les tables publiques au lieu de dépendre uniquement de stations');
assert(/--no-backup est interdit/.test(runner), 'le contournement --no-backup est refusé');
assert(/Aucune migration n’a été lancée/.test(runner), 'l’échec de sauvegarde bloque les migrations');
assert(/await verifyDump\(file\)/.test(backup), 'le dump est vérifié avant d’être déclaré réussi');
assert(/createGunzip\(\)/.test(backup), 'le contenu gzip est effectivement décompressé pour validation');
assert(/PostgreSQL database dump/.test(backup), 'la signature SQL PostgreSQL est exigée');
console.log('A1 migration-backup-gate-static: 7/7 contrôles réussis.');
