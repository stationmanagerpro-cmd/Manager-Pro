// Contrôles statiques du module Comptabilité : câblage contrat Superadmin, serveur, menu, isolation par station.
const fs = require('fs');
const assert = require('assert');
const rd = p => fs.readFileSync(__dirname + '/../' + p, 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };

const server = rd('src/server.js'), contracts = rd('src/contracts.js'), premium = rd('src/premium.js'), acc = rd('src/accounting.js');
const extC = rd('public/ext-contracts.js'), app = rd('public/app.js'), shell = rd('public/ext-shell.js'), idx = rd('public/index.html'), sw = rd('public/sw.js'), mig = rd('migrations/079_comptabilite.sql');

// Serveur : route montée + accès conditionné au contrat
ok(/require\('\.\/accounting'\)/.test(server), 'routeur comptabilité non monté');
ok(/isPath\('\/accounting'\)[\s\S]{0,160}can_access_accounting[\s\S]{0,80}module:accounting/.test(server), 'accès API non conditionné au contrat');
// Contrat : désactivé par défaut + cohérence sous-modules
ok(/accounting: false/.test(contracts) && /can_access_accounting: false/.test(contracts), 'module comptabilité doit être désactivé par défaut');
['accounting_entries', 'accounting_assets', 'accounting_vat', 'accounting_closing', 'accounting_export'].forEach(k => {
  ok(contracts.includes(k + ': false'), k + ' absent des défauts du contrat');
  ok(premium.includes("code: '" + k + "'"), k + ' absent du catalogue des modules');
  ok(extC.includes("'" + k + "'"), k + ' absent du formulaire Superadmin');
  ok(acc.includes("'" + k + "'"), k + ' non contrôlé côté API');
});
ok(/accSub[\s\S]{0,300}f\.modules\.accounting = true/.test(contracts), 'un sous-module comptable doit activer le module');
// Superadmin : formulaire de contrat (champ, valeur par défaut, construction, pack)
ok(extC.includes("['can_access_accounting'"), 'champ d’autorisation absent du formulaire de contrat');
ok(/can_access_accounting: on\(/.test(extC) && /accounting: t\('can_access_accounting'\)/.test(extC), 'lecture / écriture du contrat incomplètes');
ok(/comptabilite: \{/.test(extC), 'pack « Complet + Comptabilité » absent');
// Client : menu, accès par contrat, ressources hors-ligne
ok(/startsWith\('compta'\)/.test(app), 'contractAllowsView ne gère pas la comptabilité');
ok(/keys: \['compta'\]/.test(shell), 'entrée de menu absente');
ok(idx.includes('ext-accounting.js') && idx.includes('ext-accounting.css'), 'scripts non chargés');
ok(sw.includes('ext-accounting.js') && sw.includes('ext-accounting.css'), 'ressources absentes du cache hors-ligne');
// Permissions
ok(/accounting\.view/.test(mig) && /accounting\.manage/.test(mig), 'permissions absentes de la migration');
ok(/need\('accounting\.manage'\)/.test(acc) && /need\('accounting\.view'\)/.test(acc), 'permissions non appliquées à l’API');
// Isolation : toute requête sur une table acc_* ou source est bornée par station_id (ou jointure sur un id déjà borné)
const re = /(FROM|INTO|UPDATE|JOIN) acc_(entries|assets|fiscal_years|accounts)\b/g;
let m;
while ((m = re.exec(acc))) {
  const win = acc.slice(Math.max(0, m.index - 120), m.index + 520);
  ok(/station_id/.test(win) || /FROM acc_entries e ON e\.id|JOIN acc_entries e ON e\.id/.test(win), 'requête sans station_id près de : ' + acc.slice(m.index, m.index + 80).replace(/\n/g, ' '));
}
// Écritures protégées : exercice clos + verrous de période + équilibre
ok(/assertNotLocked/.test(acc) && /assertOpen/.test(acc) && /déséquilibrée/.test(acc), 'garde-fous d’écriture manquants');
ok(/CONSTRAINT TRIGGER acc_entry_lines_balance/.test(mig), 'trigger d’équilibre absent');
// Immobilisation payée : décaissement réel via la Trésorerie
ok(/settle\(c, \{[^}]*ref: \['acc_assets'/.test(acc), 'l’acquisition doit créer le mouvement de trésorerie réel');
console.log(`✔ Comptabilité (câblage statique) : ${n} contrôles réussis`);
