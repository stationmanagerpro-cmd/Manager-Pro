// Contrôles statiques de l'assistant d'activation Fiscalité : npm run test:fiscal-wizard
const fs = require('fs'), assert = require('assert');
const rd = f => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const fiscal = rd('src/fiscal.js'), wiz = rd('src/fiscal_wizard.js'), set = rd('src/fiscal_settings.js'), server = rd('src/server.js'), hr = rd('src/hr.js'),
  mig = rd('migrations/086_fiscal_wizard.sql'), ui = rd('public/ext-fiscal-wizard.js'), idx = rd('public/index.html');

// 1. Aucun calcul sans activation : toutes les estimations passent par estimateFor → requireActive
ok(/async function estimateFor[\s\S]{0,300}FS\.requireActive/.test(fiscal), 'estimateFor exige requireActive');
ok(!/estimateTVA\(cid/.test(fiscal.replace(/dispatchEstimate[\s\S]*?\n}\n/, '')), 'plus d\'appel direct aux estimateurs hors aiguillage');
ok((fiscal.match(/estimateFor\(/g) || []).length >= 4, 'estimation, mise à jour, recalcul et définition');
ok(/FISCAL_MODULE_NOT_ACTIVATED/.test(set) && /FISCAL_SETTINGS_REQUIRED/.test(set), 'garde : module non activé / paramètres non confirmés');
// 2. Activation uniquement par l'assistant
ok(/WIZARD_ONLY/.test(fiscal) && /modules\/:code\/activate'.*WIZARD_ONLY/.test(fiscal), 'anciennes routes d\'activation refusées');
ok(/r\.post\('\/fiscal\/wizard\/:code\/activate'/.test(wiz) && /r\.put\('\/fiscal\/wizard\/:code\/settings'/.test(wiz) && /wizard\/:code\/deactivate/.test(wiz) && /wizard\/:code\/simulate/.test(wiz) && /wizard\/:code\/history/.test(wiz), 'routes de l\'assistant');
ok(/app\.use\('\/api', require\('\.\/fiscal_wizard'\)\)/.test(server), 'assistant monté');
// 3. Confirmation, motif, taux nul, date d'effet, versionnement
ok(/confirm_values/.test(wiz) && /FISCAL_ZERO_RATE/.test(wiz) && /FISCAL_EFFECTIVE_DATE/.test(wiz) && /reason: z\.string\(\)\.trim\(\)\.min\(5/.test(wiz), 'confirmation, taux nul, date d\'effet, motif');
ok(/MAX\(version\)/.test(set) && /BEFORE UPDATE/.test(mig) && /fiscal_module_settings_no_update/.test(mig), 'versions immuables');
ok(/logFiscal\(cid, req\.user\.id, mode === 'activate'/.test(wiz) && /wizard_deactivate/.test(wiz), 'journalisation');
// 4. Simulation sans enregistrement
const sim = wiz.slice(wiz.indexOf("'/fiscal/wizard/:code/simulate'"), wiz.indexOf('// Paie : une seule source'));
ok(sim.length > 200 && !/saveVersion|tx\(|INSERT INTO|UPDATE fiscal/.test(sim), 'la simulation n\'écrit rien');
// 5. Paie : une seule source de paramètres
ok(/syncPayroll/.test(wiz) && /its_brackets/.test(wiz) && /inps_branches/.test(wiz) && /amo_branches/.test(wiz) && /employer_charges/.test(wiz), 'ITS, INPS, AMO, CFE, TFP alimentent la paie');
ok(/hr\.manage/.test(wiz), 'droit RH requis pour les modules de paie');
ok(/mode === 'annual'/.test(hr) && /employeeContributions: fl\(inpsEmployee \+ amoEmployee\)/.test(hr), 'paie : ITS annuel avec cotisations déduites');
// 6. Masquage « Module non activé »
ok(/maskEstimates/.test(fiscal) && /Module non activé/.test(fiscal) && /settings_version IS NOT NULL/.test(rd('src/profitability.js')), 'aucun montant sans activation');
ok(/module_not_activated/.test(rd('public/ext-fiscal.js')), 'interface : « Module non activé »');
// 7. Interface
ok(/Revenir à la valeur officielle/.test(ui) && /personnalisé/.test(ui) && /Lancer la simulation/.test(ui) && /confirm_values/.test(ui) && /sources divergentes/.test(ui), 'assistant : personnalisé, retour officiel, test, confirmation, sources divergentes');
ok(idx.indexOf('ext-fiscal-wizard.js') > idx.indexOf('/ext-fiscal.js'), 'assistant chargé après ext-fiscal.js');
console.log(`fiscal-wizard-static : ${n} vérifications OK`);
