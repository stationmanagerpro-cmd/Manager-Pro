'use strict';
// Contrôles statiques : historique des actions, rejet, dettes clients, permission de vente à crédit.
const assert = require('assert'), fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
const mig = rd('migrations/090_historique_actions_et_credit.sql'), ops = rd('src/operations.js'), fuel = rd('src/fuelsales.js'), sh = rd('src/shifts.js'), hr = rd('src/hr.js'), acc = rd('src/employee_access.js'), ui = rd('public/ext-core.js');
check('migration 090 : journal sans suppression (statut rejeté), unicité par vente/dette/écart/anomalie, permission sale.credit', () => {
  assert(/CREATE TABLE IF NOT EXISTS employee_actions/.test(mig) && /status IN \('actif','rejete'\)/.test(mig) && /rejected_reason/.test(mig) && /review_note/.test(mig));
  assert(/CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_actions_ref/.test(mig));
  assert(/'sale\.credit'/.test(mig) && /'ADMIN','GERANT','SUPERVISEUR'/.test(mig)); assert(!/DROP TABLE|TRUNCATE|DELETE FROM/i.test(mig));
});
check('vente à crédit (produits ET carburant) : permission sale.credit exigée côté serveur', () => {
  for (const src of [ops, fuel]) assert(/req\.user\.perms\.has\('sale\.credit'\)/.test(src) && /Vendre à crédit/.test(src));
});
check('journal branché : ventes, clôture, anomalies déclarées, décisions d\'écart, dettes employé, changements de rôle', () => {
  assert((ops.match(/employee_actions'\)\.afterSale/g) || []).length === 1 && (fuel.match(/employee_actions'\)\.afterSale/g) || []).length === 1);
  assert(/employee_actions'\)\.afterClose/.test(sh) && /kind: 'anomalie'/.test(sh));
  assert(/kind: 'decision_ecart'/.test(hr) && /kind: 'dette_employe'/.test(hr) && (acc.match(/kind: 'role'/g) || []).length === 2);
});
check('le journal ne supprime jamais : aucune requête DELETE sur employee_actions', () => assert(!/DELETE FROM employee_actions/i.test(rd('src/employee_actions.js'))));
check('interface : historique avec Rejeter / Répondre, dettes clients, accès depuis « Mon espace »', () => {
  assert(/window\.actReject/.test(ui) && /window\.actReview/.test(ui) && /async actions\(e\)/.test(ui) && /async creances\(e\)/.test(ui));
  assert(/Historique de mes actions/.test(ui) && /action rejetée|Rejetée/.test(ui));
});
check('fiche client : employé à l\'origine de la vente / dette', () => {
  assert(/AS employee,/.test(rd('src/catalog.js')) && /Vente à crédit \(dette\)/.test(rd('public/ext-detail-pages.js')));
});
console.log(`\n${n}/6 contrôles réussis.`);
