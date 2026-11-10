'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const messaging = read('src/messaging.js');
const server = read('src/server.js');
const shifts = read('src/shifts.js');
const ui = read('public/ext-messaging.js');
const migration = read('migrations/033_alert_threshold_rules.sql');
const checks = [
  ['migration additive pour seuils et unités', /ADD COLUMN IF NOT EXISTS threshold_value[\s\S]*ADD COLUMN IF NOT EXISTS threshold_unit[\s\S]*ADD COLUMN IF NOT EXISTS threshold_percent/.test(migration)],
  ['types d’alertes explicitement autorisés', /const ALERT_KINDS = new Set\(\[[\s\S]*'cash_variance'[\s\S]*'incident_note'/.test(messaging)],
  ['destinataires obligatoires dans le schéma API', /copy_user_ids:\s*z\.array\(z\.number\(\)\.int\(\)\.positive\(\)\)\.default\(\[\]\)/.test(messaging) && /!b\.copy_user_ids\.length && b\.active/.test(messaging)],
  ['seuil positif et unité obligatoires pour les écarts', /THRESHOLD_KINDS\.has\(b\.alert_kind\)[\s\S]*threshold_value[\s\S]*threshold_unit[\s\S]*ALERT_UNITS/.test(messaging)],
  ['station cible vérifiée dans le compte client', /SELECT 1 FROM stations WHERE id = \$1 AND client_id = \$2/.test(messaging)],
  ['utilisateurs destinataires limités au même client', /for \(const uid of b\.copy_user_ids\) await assertSameClient\(uid, clientId\)/.test(messaging)],
  ['configuration alertes autorisée par contrat sans exiger le module messagerie', /const alertConfigPath = path === '\/messaging\/alert-config'[\s\S]*featureOn\(contract, 'can_use_auto_alerts'\)/.test(server)],
  ['configuration UI exige destinataire et seuil positif', /Sélectionnez au moins un destinataire[\s\S]*threshold > 0/.test(ui)],
  ['règle d’écart appliquée avant envoi', /if \(THRESHOLD_KINDS\.has\(kind\)\)[\s\S]*below_threshold/.test(messaging)],
  ['clôture de quart déclenche l’alerte d’écart de caisse', /sendSystemAlert\(\{[\s\S]*kind: 'cash_variance'[\s\S]*metricUnit: 'XOF'/.test(shifts)],
  ['échec de notification ne fait pas échouer la clôture', /catch \(alertError\) \{ console\.warn\('\[alertes\]/.test(shifts)],
  ['déduplication par type et référence métier', /duplicate_event/.test(messaging) && /system_kind = \$2 AND ref_table = \$3 AND ref_id = \$4/.test(messaging)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
