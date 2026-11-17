'use strict';
// Arbre de navigation (ext-shell.js, TREE) : chaque vue apparaît une seule fois, aucune rubrique vide.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-shell.js'), 'utf8');
const a = src.indexOf('const TREE = ['), b = src.indexOf('// Arbre du Superadmin');
assert(a > 0 && b > a, 'bloc TREE introuvable');
const block = src.slice(a, b);
const keys = [];
for (const m of block.matchAll(/keys: \[([^\]]*)\]/g)) for (const k of m[1].matchAll(/'([^']+)'/g)) keys.push(k[1]);
const seen = {};
keys.forEach(k => { seen[k] = (seen[k] || 0) + 1; });
const dups = Object.keys(seen).filter(k => seen[k] > 1);
assert.deepStrictEqual(dups, [], 'vues présentes plusieurs fois dans le menu : ' + dups.join(', '));
assert(keys.length > 0, 'aucune vue dans le menu');
const empty = [...block.matchAll(/label: '([^']+)'[^\n]*?keys: \[\], children: \[\s*\]/g)].map(m => m[1]);
assert.deepStrictEqual(empty, [], 'rubriques sans vue ni sous-rubrique');
console.log('ok nav-tree : ' + keys.length + ' occurrences, aucune vue en double');
