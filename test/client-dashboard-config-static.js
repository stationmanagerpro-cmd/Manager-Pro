'use strict';
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const reports = read('src/reports.js');
const admin = read('src/admin.js');
const core = read('src/core.js');
const ui = read('public/ext-detail-pages.js');
const migration = read('migrations/055_client_dashboard_config.sql');
const checks = [
  ['stockage dédié avec une seule configuration par client', /CREATE TABLE IF NOT EXISTS client_dashboard_configs[\s\S]*?client_id BIGINT PRIMARY KEY REFERENCES clients\(id\)[\s\S]*?config JSONB NOT NULL/.test(migration)],
  ['endpoint de lecture réservé au Super Admin et validant le client', /get\('\/admin\/clients\/:id\/dashboard-config'[\s\S]*?if \(!req\.user\.is_global\)[\s\S]*?SELECT id, name FROM clients WHERE id = \$1/.test(reports)],
  ['écriture validée par le schéma et isolée par client_id', /put\('\/admin\/clients\/:id\/dashboard-config'[\s\S]*?dashboard_config\.schema\.safeParse[\s\S]*?ON CONFLICT \(client_id\) DO UPDATE/.test(reports)],
  ['configuration client prioritaire dans le dashboard opérationnel', /if \(clientId\)[\s\S]*?FROM client_dashboard_configs WHERE client_id = \$1[\s\S]*?if \(!cfg\) cfg = await getSetting\(req\.sid, 'dashboard_config'\)/.test(reports)],
  ['client_id disponible depuis la session authentifiée', /SELECT u\.id, u\.login, u\.is_global, u\.client_id, u\.active/.test(core)],
  ['édition et réinitialisation accessibles depuis la fiche client', /Config Dashboard/.test(ui) && /saveClientDashboardConfig/.test(ui) && /resetClientDashboardConfig/.test(ui)],
  ['les clients ne peuvent plus modifier le réglage station obsolète', /req\.params\.key === 'dashboard_config' && !req\.user\.is_global/.test(admin)]
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
