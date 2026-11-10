'use strict';
// Garde-fou : src/credits.js ne doit jamais redevenir vide (audit 2026-11-06 : fichier vide => 500 sur /credits/apply et facturation fournisseur).
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'credits.js'), 'utf8');
assert(src.length > 500, 'credits.js vide');
assert(/module\.exports\s*=\s*\{\s*applyCustomerCredits\s*,\s*applySupplierCredits\s*\}/.test(src), 'exports manquants');
for (const f of ['catalog.js', 'purchases.js']) {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert(/require\('\.\/credits'\)/.test(s), f + ' n\'importe pas credits');
}
console.log('credits-static OK');
