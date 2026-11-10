'use strict';
const fs = require('fs');
const s = fs.readFileSync('src/core.js', 'utf8');
const checks = [
  ['missing table handled', /'42P01': \[503, schemaMismatch\]/.test(s)],
  ['missing column handled', /'42703': \[503, schemaMismatch\]/.test(s)],
  ['backup warning included', /sauvegarde indépendante/.test(s)],
  ['migration history verification included', /schema_migrations/.test(s)],
  ['no automatic migration instruction', !/exécutez « npm run migrate » puis redémarrez/.test(s)],
  ['explicit stop if existing data and empty history', /arrêtez-vous et faites auditer le schéma/.test(s)],
];
for (const [label, ok] of checks) console.log(`${ok ? 'OK' : 'FAIL'} ${label}`);
if (checks.some(([, ok]) => !ok)) process.exit(1);
console.log(`${checks.length}/${checks.length} contrôles réussis`);
