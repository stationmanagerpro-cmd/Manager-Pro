'use strict';
// Audit statique des liens entre profils et opérations; aucune connexion DB.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const schema = read('migrations/001_initial.sql');
const invoices = read('migrations/042_customer_invoices.sql');
const hr = read('migrations/003_hr_payroll_finance.sql');
const checks = [
  ['identifiant technique auto-généré des employés', /CREATE TABLE employees\s*\([\s\S]*?id\s+BIGSERIAL PRIMARY KEY/.test(schema)],
  ['matricule employé unique par station', /UNIQUE \(station_id, matricule\)/.test(schema)],
  ['ventes reliées à un employé et éventuellement à un client', /CREATE TABLE sales\s*\([\s\S]*?employee_id\s+BIGINT NOT NULL REFERENCES employees\(id\)[\s\S]*?customer_id\s+BIGINT REFERENCES customers\(id\)/.test(schema)],
  ['achats reliés à un fournisseur', /CREATE TABLE purchases\s*\([\s\S]*?supplier_id\s+BIGINT NOT NULL REFERENCES suppliers\(id\)/.test(schema)],
  ['lignes d’achat reliées à un achat et un produit', /CREATE TABLE purchase_details\s*\([\s\S]*?purchase_id\s+BIGINT NOT NULL REFERENCES purchases\(id\)[\s\S]*?product_id\s+BIGINT NOT NULL REFERENCES products\(id\)/.test(schema)],
  ['factures client reliées au client et potentiellement à la vente', /customer_id\s+BIGINT REFERENCES customers\(id\)[\s\S]*?sale_id\s+BIGINT REFERENCES sales\(id\)/.test(invoices)],
  ['numéro de facture unique par station', /UNIQUE \(station_id, invoice_no\)/.test(invoices)],
  ['dettes employés reliées au profil employé', /CREATE TABLE IF NOT EXISTS employee_debts\s*\([\s\S]*?employee_id BIGINT NOT NULL REFERENCES employees\(id\)/.test(hr)],
];
let failed = 0;
for (const [label, pass] of checks) { console.log(`${pass ? '✔' : '✖'} ${label}`); if (!pass) failed++; }
if (failed) process.exitCode = 1;
