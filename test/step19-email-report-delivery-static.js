'use strict';
const fs=require('fs'),path=require('path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const route=read('src/scheduled_reports.js'),migration=read('migrations/037_scheduled_report_delivery.sql'),ui=read('public/ext-messaging.js');
const checks=[
 ['migration ajoute les rapports choisis et les canaux email/application',/report_types TEXT\[\]/.test(migration)&&/delivery_channels TEXT\[\]/.test(migration)],
 ['migration interdit tout canal autre que app/email tant que WhatsApp est indisponible',/ARRAY\['app','email'\]::TEXT\[\]/.test(migration)],
 ['adresses email stockées séparément et limitées au programme',/email_recipients TEXT\[\]/.test(migration)],
 ['API valide les emails et exige une adresse si email sélectionné',/z\.string\(\)\.trim\(\)\.email\(\)/.test(route)&&/delivery_channels.includes\('email'\)/.test(route)&&/email_recipients.length/.test(route)],
 ['choix de rapports limités à la liste autorisée',/financial_summary','operational_alerts','stock_summary','hr_summary/.test(route)],
 ['situation financière protégée par une permission métier',/Permission de consultation financière/.test(route)&&/finance\.view/.test(route)],
 ['situation financière calculée sur le mois précédent depuis ventes et dépenses réelles',/previousMonthWindow/.test(route)&&/FROM sales WHERE status='valide'/.test(route)&&/FROM expenses WHERE deleted_at IS NULL/.test(route)],
 ['rapport précise que CA moins dépenses ne certifie pas le bénéfice comptable',/n’est pas un bénéfice comptable certifié/.test(route)],
 ['envoi email passe par le service mail existant et SMTP configuré',/require\('\.\/mailer'\)/.test(route)&&/await sendMail\(/.test(route)&&/!process\.env\.SMTP_HOST/.test(route)],
 ['envoi interne conditionné au canal app',/delivery_channels\|\|\['app'\]\)\.includes\('app'\)/.test(route)],
 ['interface fournit une liste de sélection multiple des rapports',/id="report-types" multiple/.test(ui)&&/selectedOptions/.test(ui)],
 ['interface présente Email comme canal prioritaire',/Email \(prioritaire\)/.test(ui)],
 ['WhatsApp est clairement indisponible et désactivé',/WhatsApp — Pas dispo actuellement/.test(ui)&&/type="checkbox" disabled/.test(ui)],
 ['programmation mensuelle et choix du jour du mois disponibles',/Mensuelle/.test(ui)&&/report-monthday/.test(ui)],
 ['interface valide destinataires email et au moins un rapport/canal',/Ajoutez au moins une adresse email/.test(ui)&&/Choisissez au moins un rapport dans la liste/.test(ui)&&/Choisissez au moins un canal disponible/.test(ui)],
];
let failed=0;for(const [label,ok] of checks){console.log(`${ok?'✔':'✘'} ${label}`);if(!ok)failed++;}console.log(`${checks.length-failed}/${checks.length} contrôles statiques réussis.`);if(failed)process.exit(1);
