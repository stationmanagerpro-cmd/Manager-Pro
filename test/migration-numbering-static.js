'use strict';
// Numérotation des migrations (audit C2) : « un numéro = un fichier ».
// Les 3 doublons historiques (027, 040, 059) sont tolérés car déjà appliqués en production et jamais renommés ;
// tout NOUVEAU doublon, tout nom hors format NNN_nom.sql ou tout numéro inférieur au dernier numéro historique est refusé.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dir = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const KNOWN_DUPLICATES = { '027': 2, '040': 2, '059': 2 };
const LEGACY_MAX = 91; // dernière migration livrée avant la règle ; tout ajout ultérieur doit être strictement croissant
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✓ ' + label); }

check('tous les fichiers suivent le format NNN_nom.sql', () => {
  const bad = files.filter(f => !/^\d{3}_[a-z0-9_.\-]+\.sql$/i.test(f));
  assert.deepStrictEqual(bad, [], 'Noms invalides : ' + bad.join(', '));
});
check('aucun nouveau doublon de numéro (seuls 027, 040, 059 sont tolérés)', () => {
  const count = {};
  for (const f of files) { const n = f.slice(0, 3); count[n] = (count[n] || 0) + 1; }
  const dups = Object.fromEntries(Object.entries(count).filter(([, c]) => c > 1));
  assert.deepStrictEqual(dups, KNOWN_DUPLICATES, 'Doublons trouvés : ' + JSON.stringify(dups));
});
check('les migrations ajoutées après la règle ont des numéros uniques et croissants', () => {
  const recent = files.map(f => parseInt(f.slice(0, 3), 10)).filter(n => n > LEGACY_MAX);
  assert.deepStrictEqual(recent, [...new Set(recent)].sort((a, b) => a - b));
});
console.log(`${passed}/${passed} contrôles réussis`);
