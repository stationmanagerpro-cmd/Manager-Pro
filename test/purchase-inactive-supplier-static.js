'use strict';
// Contrôles structurels sans base de données : npm run test:purchase-inactive-supplier
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const purchases = read('src/purchases.js');
const start = purchases.indexOf("r.post('/purchases', need('purchase.manage')");
const end = purchases.indexOf('// 2. RÉCEPTION');
const create = purchases.slice(start, end);
const receive = purchases.slice(end, purchases.indexOf('// 5. ARCHIVAGE'));
const checks = [
  ['la création de commande lit l’état actif du fournisseur', /COALESCE\(active, TRUE\) AS active FROM suppliers/.test(create)],
  ['un fournisseur archivé est refusé (409) avant toute écriture', /sup\.active === false\) throw new HttpError\(409, 'Fournisseur inactif/.test(create) && create.indexOf('sup.active === false') < create.indexOf('INSERT INTO purchases')],
  ['un fournisseur inconnu reste refusé (400)', /if \(!sup\) throw new HttpError\(400, 'Fournisseur inconnu'\)/.test(create)],
  ['la réception et le paiement des commandes existantes ne sont pas bloqués', !/Fournisseur inactif/.test(receive)],
  ['le message est cohérent avec la vente à crédit client', /Client inactif \(archivé\)/.test(read('src/operations.js'))],
];
let failed = 0;
for (const [label, pass] of checks) { console.log(`${pass ? '✔' : '✖'} ${label}`); if (!pass) failed++; }
if (failed) process.exitCode = 1;
