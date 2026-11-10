'use strict';
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'ops_plus.js'), 'utf8');
const checks = [
  ['les échecs de sauvegarde sont protégés par la condition Super Admin', /if\s*\(req\.user\.is_global\)\s*\{[\s\S]{0,250}SELECT id, kind, error_message, started_at, finished_at FROM backup_logs/.test(source)],
  ['le commentaire documente que backup_logs est global et non isolé par station', /journal des sauvegardes est global à la plateforme, pas isolé par station/.test(source)],
  ['les autres sources d’alertes restent filtrées par la station active', /FROM notifications WHERE station_id = \$1 AND read_at IS NULL/.test(source)],
  ['les alertes RH restent filtrées par la station active', /FROM hr_alerts a LEFT JOIN employees e ON e\.id = a\.employee_id[\s\S]{0,180}WHERE a\.station_id = \$1/.test(source)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
