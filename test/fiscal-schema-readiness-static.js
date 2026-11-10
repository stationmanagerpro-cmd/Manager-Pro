'use strict';
const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, '..', 'src/server.js'), 'utf8');
const migrate = fs.readFileSync(path.join(__dirname, '..', 'src/migrate.js'), 'utf8');
function ok(condition, message) { if (!condition) throw new Error(message); }
for (const table of ['fiscal_profiles', 'fiscal_module_activations', 'fiscal_periods', 'fiscal_rules', 'fiscal_deadlines', 'fiscal_documents', 'fiscal_checklist_items']) {
  ok(server.includes(`public.${table}`), `Le contrôle de démarrage doit vérifier ${table}`);
}
for (const migration of ['046_fiscalite.sql', '050_fiscal_checklist.sql', '057_fiscal_access_permission.sql']) {
  ok(server.includes(migration), `Le diagnostic doit identifier la migration ${migration}`);
}
ok(server.includes("permissions WHERE code='fiscal.access'"), 'Le diagnostic doit vérifier la permission fiscale');
ok(server.includes("console.warn('[FISCALITÉ]"), 'Le diagnostic doit afficher un avertissement exploitable');
ok(migrate.includes('Historique de migrations vide alors que la table stations existe.'), 'Le mécanisme de migration doit conserver son arrêt de sécurité sur historique inconnu');
console.log('OK fiscal-schema-readiness-static (14 assertions)');
