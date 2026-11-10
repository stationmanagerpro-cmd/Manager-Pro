// Contrôles statiques anti-régression pour les migrations dangereuses.
const fs = require('fs');
const assert = require('assert');
const migration = fs.readFileSync('migrations/025_license_warnings_renewal_requests.sql', 'utf8');
const runner = fs.readFileSync('src/migrate.js', 'utf8');

assert(!/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?license_renewal_requests/i.test(migration),
  'La migration 025 ne doit jamais supprimer la table des demandes de renouvellement');
assert(/CREATE TABLE IF NOT EXISTS license_renewal_requests/i.test(migration),
  'La table doit être créée uniquement si elle n’existe pas');
assert(/ADD COLUMN IF NOT EXISTS processed_by/i.test(migration),
  'Le schéma historique doit être étendu sans recréer la table');
assert(/ADD COLUMN IF NOT EXISTS handled_by/i.test(migration),
  'Les colonnes utilisées par les anciennes routes doivent être conservées');
assert(/'accepted'.*'approved'.*'rejected'/s.test(migration),
  'Les statuts utilisés par les deux handlers doivent être compatibles');
assert(/ARRÊT DE SÉCURITÉ/.test(runner),
  'Le lanceur doit bloquer un schéma existant sans historique de migrations');
assert(!/INSERT INTO schema_migrations\(name\) VALUES \(\$1\).*files\[0\]/s.test(runner),
  'Le lanceur ne doit plus marquer automatiquement la migration initiale sur la seule présence de stations');
console.log('✔ Contrôles de sécurité des migrations : 7/7');
