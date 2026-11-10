'use strict';
// Contrôles structurels sans base de données : npm run test:detail-pages
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('public/index.html');
const ui = read('public/ext-detail-pages.js');
const branding = read('src/branding.js');
const catalog = read('src/catalog.js');
const contracts = read('src/contracts.js');
const contractsUi = read('public/ext-contracts.js');
const checks = [
  ['la fiche dédiée est chargée dans l’application', app.includes('src="/ext-detail-pages.js"')],
  ['les fiches client et fournisseur ont leurs propres vues', /VM\.clidet\s*=/.test(ui) && /VM\.supdet\s*=/.test(ui)],
  ['les factures client sont créées depuis un formulaire intégré', /submitCustomerInvoice/.test(ui) && /<form onsubmit="return submitCustomerInvoice/.test(ui)],
  ['les commandes fournisseur sont créées depuis un formulaire multi-lignes (comme la facture)', /poNew\(\$\{id\}\)/.test(ui) && /id="po_add"/.test(read('public/ext-purchase-order.js')) && /po-del/.test(read('public/ext-purchase-order.js')) && /ext-purchase-order\.js/.test(app)],
  ['la fiche fournisseur permet d’ouvrir le détail et la réception d’une commande', /showPO\(\$\{Number\(x\.id\)\}\)/.test(ui)],
  ['le panneau publicitaire possède une page dédiée et un accès direct depuis la liste clients', /VM\.clientads\s*=/.test(ui) && /Configurer la publicité/.test(contractsUi)],
  ['la publicité client limite les images à cinq côté serveur', /cfg\.images\.length >= 5/.test(branding)],
  ['les routes publicitaires de gestion exigent le Super Admin', /const clientAdAdmin = \(req, res, next\) =>/.test(branding) && /!req\.user\.is_global/.test(branding)],
  ['la publicité du client connecté est servie via une route propre à sa session/station', /admin\.get\('\/me\/advertising'/.test(branding) && /admin\.get\('\/me\/advertising\/images\/:index'/.test(branding)],
  ['les historiques clients prennent en charge les permissions lecture ou vente', /customers\/:id\/history', need\('customer\.view', 'sale\.create'\)/.test(catalog)],
  ['l’historique fournisseur utilise la table métier purchases', /FROM purchases pu[\s\S]*WHERE pu\.station_id=\$1 AND pu\.supplier_id=\$2/.test(catalog) && !/FROM purchase_orders WHERE station_id=\$1 AND supplier_id=\$2/.test(catalog)],
  ['l’API Super Admin des utilisateurs n’expose pas les secrets', /admin\/clients\/:id\/users/.test(contracts) && !/password_hash|token|secret/.test(contracts.slice(contracts.indexOf("r.get('/admin/clients/:id/users'"), contracts.indexOf("/** Historique licences")))],
  ['le traitement des renouvellements verrouille la demande contre les doubles décisions', /SELECT \* FROM license_renewal_requests WHERE id = \$1 FOR UPDATE/.test(contracts) && /status = 'pending' RETURNING \*/.test(contracts)],
  ['la décision et le renouvellement sont regroupés dans une transaction', /const result = await tx\(async c =>/.test(contracts.slice(contracts.indexOf("r.post('/admin/license-renewal-requests/:id/process'"), contracts.indexOf('Suppression / archivage définitif')))],
  ['un identifiant de demande invalide est rejeté', /Identifiant de demande invalide/.test(contracts)],
  ['chaque compte client de la fiche Super Admin ouvre une fiche individuelle', /VM\.clientuserdetail\s*=/.test(ui) && /go\('clientuserdetail'/.test(ui)],
  ['la création client exige les identifiants d’un administrateur local', /owner_login: z\.string\(\)\.trim\(\)\.min\(3\)/.test(contracts) && /owner_password: z\.string\(\)\.min\(8\)/.test(contracts)],
  ['le compte créé est un administrateur local non-global, et non un gérant par défaut', /SELECT id FROM roles WHERE code = 'ADMIN'/.test(contracts) && /VALUES \(\$1,\$2,\$3,FALSE,\$4\)/.test(contracts)],
  ['le formulaire identifie explicitement l’administrateur local', /Identifiant de l’administrateur local/.test(contractsUi) && /Mot de passe initial de l’administrateur/.test(contractsUi)],
];
let failed = 0;
for (const [label, pass] of checks) {
  console.log(`${pass ? '✔' : '✖'} ${label}`);
  if (!pass) failed++;
}
if (failed) process.exitCode = 1;
