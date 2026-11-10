'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const messaging = read('src/messaging.js');
const server = read('src/server.js');
const ui = read('public/ext-messaging.js');
const migration = read('migrations/035_alert_lifecycle.sql');
const checks = [
  ['migration additive ajoute le statut et les métadonnées de suivi', /ADD COLUMN IF NOT EXISTS alert_status[\s\S]*acknowledged_by[\s\S]*resolved_by[\s\S]*resolution_note/.test(migration)],
  ['statuts limités aux valeurs prévues', /CHECK \(alert_status IN \('open', 'acknowledged', 'resolved'\)\)/.test(migration)],
  ['centre des alertes réservé aux utilisateurs locaux autorisés', /r\.get\('\/messaging\/system-alerts', need\('settings\.edit', 'user\.manage'\)/.test(messaging)],
  ['centre client refuse explicitement les comptes globaux', /if \(req\.user\.is_global\) throw new HttpError\(403, 'Le centre client est réservé aux responsables du compte client\.'\)/.test(messaging)],
  ['liste filtrée par client et appartenance au destinataire', /m\.client_id = \$1 AND m\.is_system = TRUE/.test(messaging) && /JOIN conversation_members cm ON cm\.conversation_id = c\.id AND cm\.user_id = \$2/.test(messaging)],
  ['mise à jour réservée à une alerte système du client et à un membre', /UPDATE messages m SET[\s\S]*m\.client_id = \$2 AND m\.is_system = TRUE[\s\S]*cm\.user_id = \$3/.test(messaging)],
  ['actions de prise en charge et de résolution contrôlées', /action: z\.enum\(\['acknowledge', 'resolve'\]\)/.test(messaging) && /alert_status <> 'resolved'/.test(messaging)],
  ['modifications journalisées sans enregistrer le texte du mot de passe ou données sensibles', /audit\(pool, req, 'alertes',[\s\S]*note_present: !!req\.body\.note/.test(messaging)],
  ['contrôle central accepte le centre alertes même si la messagerie générale est désactivée', /const alertCenterPath = path === '\/messaging\/system-alerts'[\s\S]*if \(alertConfigPath \|\| alertCenterPath \|\| reportSchedulePath\)/.test(server)],
  ['interface propose le centre des alertes et les actions', /msgAlertCenterOpen[\s\S]*msgAlertAction[\s\S]*Prendre en charge[\s\S]*Résoudre/.test(ui)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
