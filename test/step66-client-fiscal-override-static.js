'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/062_restore_client_admin_fiscal_permission.sql'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public/ext-contracts.js'), 'utf8');
const contracts = fs.readFileSync(path.join(root, 'src/contracts.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
const fiscal = fs.readFileSync(path.join(root, 'src/fiscal.js'), 'utf8');
const checks = [
  [migration.includes("r.code = 'ADMIN'") && migration.includes("p.code = 'fiscal.access'") && migration.includes('ON CONFLICT DO NOTHING'), 'permission fiscale ADMIN rétablie de façon idempotente'],
  [migration.includes("r.code IN ('SUPERADMIN', 'SUPER_ADMIN')"), 'Superadmin plateforme exclu des opérations fiscales'],
  [ui.includes('accès individuel pour CE compte client (indépendant du pack)'), 'autorisation individuelle clairement indiquée dans le formulaire contrat'],
  [ui.includes("can_access_fiscal: t('can_access_fiscal')") && ui.includes('fiscal: t(\'can_access_fiscal\')'), 'le formulaire enregistre l’autorisation fiscale dans les droits du compte'],
  [contracts.includes('f.can_access_fiscal = true') && contracts.includes("key.startsWith('module:')"), 'le contrat conserve le contrôle d’accès individuel'],
  [server.includes("featureOn(contract, 'can_access_fiscal')") && server.includes("featureOn(contract, 'module:fiscal')"), 'API bloque la Fiscalité si le contrat individuel ne l’autorise pas'],
  [fiscal.includes("req.user.perms.has('fiscal.access')") && fiscal.includes("featureOn(contract, 'can_access_fiscal')"), 'l’accès opérationnel exige permission de rôle et autorisation du contrat']
];
for (const [ok, label] of checks) { if (!ok) throw new Error('ÉCHEC : ' + label); console.log('OK — ' + label); }
console.log(`OK — ${checks.length} contrôles statiques étape 66`);
