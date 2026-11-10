'use strict';
const fs=require('fs'),path=require('path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const route=read('src/scheduled_reports.js'), server=read('src/server.js'), migration=read('migrations/036_scheduled_operational_reports.sql'), ui=read('public/ext-messaging.js');
const checks=[
 ['migration stocke fréquence unique/hebdomadaire/mensuelle',/frequency IN \('once','weekly','monthly'\)/.test(migration)],
 ['migration distingue heure fixe et aléatoire',/send_mode IN \('fixed','random'\)/.test(migration)&&/random_start IS NOT NULL AND random_end IS NOT NULL AND random_start < random_end/.test(migration)],
 ['destinataires non vides imposés par la base',/cardinality\(recipient_user_ids\) > 0/.test(migration)],
 ['programmation réservée aux contrats auto-alerts actifs',/featureOn\(contract,'can_use_auto_alerts'\)/.test(route)&&/contract\?\.suspended/.test(route)],
 ['destinataires actifs validés dans le même client',/WHERE client_id=\$1 AND active AND deleted_at IS NULL AND id=ANY\(\$2::bigint\[\]\)/.test(route)],
 ['station sélectionnée validée dans le compte client',/stations WHERE id=\$1 AND client_id=\$2 AND active/.test(route)],
 ['API prend en charge créer/lister/suspendre/supprimer',/r\.get\('\/messaging\/report-schedules'/.test(route)&&/r\.post\('\/messaging\/report-schedules'/.test(route)&&/r\.patch\('\/messaging\/report-schedules\/:id'/.test(route)&&/r\.delete\('\/messaging\/report-schedules\/:id'/.test(route)],
 ['verrou PostgreSQL empêche le double traitement des rapports',/pg_try_advisory_lock\(74120319\)/.test(route)&&/pg_advisory_unlock\(74120319\)/.test(route)],
 ['rapports envoyés seulement aux destinataires vérifiés du client',/SELECT id FROM users WHERE client_id=\$1 AND id=ANY\(\$2::bigint\[\]\) AND active/.test(route)&&/INSERT INTO conversation_members/.test(route)],
 ['rapport unique désactivé après son envoi',/frequency==='once'\) await pool\.query\('UPDATE alert_report_schedules SET active=FALSE/.test(route)],
 ['route autorisée par le garde contrat auto-alerts, pas par messagerie générale',/reportSchedulePath/.test(server)&&/alertConfigPath \|\| alertCenterPath \|\| reportSchedulePath/.test(server)],
 ['planificateur de rapports démarré au lancement',/require\('\.\/scheduled_reports'\)\.startScheduler\(\)/.test(server)],
 ['interface propose périodicité, mode fixe/aléatoire et destinataires',/Hebdomadaire/.test(ui)&&/Mensuelle/.test(ui)&&/Heure aléatoire dans une plage/.test(ui)&&/report-recipient/.test(ui)],
 ['interface permet suspendre et supprimer une programmation',/msgReportScheduleToggle/.test(ui)&&/msgReportScheduleDelete/.test(ui)],
 ['fuseau horaire de Bamako documenté et appliqué',/Africa\/Bamako/.test(route)&&/UTC\+0/.test(route)],
];
let failed=0;for(const [label,ok] of checks){console.log(`${ok?'✔':'✘'} ${label}`);if(!ok)failed++;}console.log(`${checks.length-failed}/${checks.length} contrôles statiques réussis.`);if(failed)process.exit(1);
