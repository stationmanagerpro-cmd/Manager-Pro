// Contrôle statique : accès par onglet au compte client (option contrat view_<onglet>, vrai par défaut).
// node test/contract-onglets-static.js
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const assert = require('assert');

const ONGLETS = ['direction', 'moidash', 'consolidee', 'parstation', 'factures', 'prixjour', 'cuves', 'histcompteurs',
  'previsions', 'transferts', 'bcommande', 'risque', 'periodlock', 'reconcile', 'flotte', 'fidelite', 'espaceclient',
  'vendeurs', 'treso', 'mmcomm', 'finevents', 'profit', 'ctrlfin', 'archive', 'imports', 'teamroles', 'msgroles',
  'carte', 'alertcfg', 'notifrules'];

const contracts = read('src/contracts.js');
const app = read('public/app.js');
const ui = read('public/ext-contracts.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✔', name); };

ok('défauts serveur : chaque onglet a une option view_<onglet> à vrai', () => {
  for (const k of ONGLETS) assert.ok(new RegExp('\\n  view_' + k + ': true,').test(contracts), 'défaut absent : view_' + k);
});

ok('affichage client : canView refuse un onglet coupé par le contrat', () => {
  assert.ok(/\('view_' \+ k\) in f && featOff\(f\['view_' \+ k\]\)\) return false;/.test(app), 'garde absente dans contractAllowsView');
});

ok('formulaire super admin : une ligne Oui/Non par onglet et une section dédiée', () => {
  for (const k of ONGLETS) assert.ok(ui.includes("['view_" + k + "',"), 'ligne formulaire absente : view_' + k);
  assert.ok(ui.includes("onglets_client: { title: 'Onglets accessibles au compte client'"), 'section absente');
});

ok("l'interrupteur global « Activation globale des modules » ignore les onglets", () => {
  assert.ok(ui.includes("f[0].indexOf('view_') !== 0"), 'filtre absent');
});

ok('navigation : go() refuse un onglet coupé, quel que soit le point d\'entrée', () => {
  assert.ok(/async function go\(k, a\) \{\n  \/\/ Onglet coupé[\s\S]*?\('view_' \+ k\) in cf && featOff\(cf\['view_' \+ k\]\)\) \{ toast/.test(app), 'garde absente dans go()');
});

console.log('\n' + n + '/' + n + ' contrôles réussis.');
