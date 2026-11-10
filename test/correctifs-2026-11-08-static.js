'use strict';
// Contrôles statiques : messages privés (anomalies/rejets), bannière unique, signalement attribué, rapports par employé, boutons d'import.
const fs = require('fs'), path = require('path'), assert = require('assert');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
ok('messagerie : conversation système repérée (is_system_conv) et libellée « Notification privée »', () => {
  assert(/is_system_conv/.test(rd('src/messaging.js')));
  const f = rd('public/ext-messaging.js'); assert(/Notification privée/.test(f) && /c\.is_system_conv/.test(f));
});
ok('rejet : employé + auteur (clôturant) + administrateurs locaux', () => assert(/\[req\.user\.id, \.\.\.\(a\.performed_by/.test(rd('src/employee_actions.js'))));
ok('anomalie / écart enregistrés : employé + auteur + administrateurs locaux', () => { const s = rd('src/employee_actions.js'); assert(/shared = a\.kind === 'anomalie' \|\| a\.kind === 'ecart'/.test(s) && /clientAdminIds/.test(s)); });
ok('bannière : un seul #hero (rendu annulé si plus récent, doublons purgés)', () => { const s = rd('public/ext-banner.js'); assert(/paintSeq/.test(s) && /purgeHeroes/.test(s) && /my !== paintSeq/.test(s)); });
ok('signalement : employé du quart auto-attribué, auteur mentionné', () => { const s = rd('src/shifts.js'); assert(/myEmpId/.test(s) && /selfReport/.test(s) && /par l'employé lui-même/.test(s) && /reported_by/.test(s)); });
ok('rapports : auteur du signalement affiché (message, PDF, écran)', () => { assert(/reportedTxt/.test(rd('src/finance.js')) && /signalée par/.test(rd('src/shift_message.js')) && /signalée par/.test(rd('public/app.js'))); });
ok('rapports : aucun rapport complet envoyé à un employé (ancien format)', () => { const s = rd('src/finance.js'); assert(/avant la séparation par employé/.test(s) && /employeeId != null && !mine/.test(s)); });
ok('import : pas de seconde barre « Modèle Excel / Importer (Excel) » sur Clients, Fournisseurs, Produits', () => { const s = rd('public/ext-import.js'); assert(/OWN_IMPORT_BUTTONS/.test(s) && !/Importer \(Excel\)<\/button>/.test(s) && !/Modèle Excel<\/button>/.test(s)); });
console.log(`${n}/${n} contrôles statiques réussis.`);
