// Contrôles statiques : les modules contractuels doivent être appliqués côté API.
const fs = require('fs');
const assert = require('assert');
const server = fs.readFileSync('src/server.js', 'utf8');
const contracts = fs.readFileSync('src/contracts.js', 'utf8');

assert(/featureOn\(contract, 'module:sales'\)/.test(server), 'Le module Ventes doit être contrôlé côté serveur');
assert(/featureOn\(contract, 'module:stock'\)/.test(server), 'Le module Stocks/Achats doit être contrôlé côté serveur');
assert(/featureOn\(contract, 'module:finance'\)/.test(server), 'Le module Finance doit être contrôlé côté serveur');
assert(/featureOn\(contract, 'module:hr'\)/.test(server), 'Le module RH doit être contrôlé côté serveur');
assert(/isPath\('\/cash'\)/.test(server), 'Les routes de caisse doivent être couvertes par le contrôle Finance');
assert(/isPath\('\/expenses'\)/.test(server), 'Les dépenses doivent être couvertes par le contrôle Finance');
assert(/customers.*payments/.test(server), 'Les paiements clients doivent être couverts par le contrôle Finance');
assert(/function featureOn\(contract, key\)/.test(contracts), 'Le calcul partagé des fonctionnalités contractuelles doit exister');
console.log('✔ Contrôles statiques des modules contractuels : 8/8');
