'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const scheduler = read('src/alerts_scheduler.js');
const server = read('src/server.js');
const messaging = read('src/messaging.js');
const ui = read('public/ext-messaging.js');
const hr = read('src/hr_v2.js');
const migration = read('migrations/034_alert_dedup_index.sql');
const checks = [
  ['planificateur d’alertes démarré avec le serveur', /require\('\.\/alerts_scheduler'\)\.startScheduler\(\)/.test(server)],
  ['scan périodique toutes les cinq minutes', /setInterval\(tick, 5 \* 60 \* 1000\)/.test(scheduler)],
  ['verrou PostgreSQL empêche deux instances de scanner en même temps', /pg_try_advisory_lock\(74120318\)/.test(scheduler) && /pg_advisory_unlock\(74120318\)/.test(scheduler)],
  ['planificateur limité aux stations actives et comptes clients', /WHERE s\.active AND s\.client_id IS NOT NULL/.test(scheduler)],
  ['stock bas déclenché seulement sous le minimum positif', /p\.min_stock > 0 AND st\.quantity <= p\.min_stock/.test(scheduler)],
  ['inactivité configurée en jours et limitée au client', /last_login_at <= now\(\) - \(\$2::text \|\| ' days'\)::interval/.test(scheduler) && /client_id = \$1 AND active/.test(scheduler)],
  ['expiration contrat configurée en jours', /end_date <= CURRENT_DATE \+ \$2::int/.test(scheduler)],
  ['paies en brouillon détectées par station', /FROM payslips WHERE station_id = \$1 AND status = 'brouillon'/.test(scheduler)],
  ['les règles périodiques passent par le moteur contractuel de notification', /sendSystemAlert\(\{[\s\S]*actorUserId: station\.actor_id/.test(scheduler)],
  ['contrats suspendus ne déclenchent pas d’alertes client', /contract\.suspended[\s\S]*contract_suspended/.test(messaging)],
  ['unités jours/minutes disponibles dans le formulaire', /value="days"[\s\S]*value="minutes"/.test(ui)],
  ['retard soumis au seuil en minutes', /'late_arrival'/.test(messaging) && /metricValue: Number\(b\.late_minutes \|\| 0\), metricUnit: 'minutes'/.test(hr)],
  ['déduplication limitée à une fenêtre de 24 heures', /created_at > now\(\) - interval '24 hours'/.test(messaging)],
  ['inactivité filtrée sur les utilisateurs de la station ou son responsable', /user_stations us WHERE us.user_id = users.id AND us.station_id = \$3/.test(scheduler)],
  ['index partiel ajouté pour les alertes système', /messages_system_alert_dedup[\s\S]*WHERE is_system = TRUE AND deleted_at IS NULL/.test(migration)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
