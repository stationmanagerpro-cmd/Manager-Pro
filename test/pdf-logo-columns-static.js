'use strict';
const fs = require('fs');
const assert = require('assert');
const docs = fs.readFileSync('src/docs.js', 'utf8');
const tests = [];
function check(name, fn) { try { fn(); tests.push({ name, ok: true }); } catch (e) { tests.push({ name, ok: false, error: e.message }); } }
check('PDF charge uniquement le logo de la station, sans repli sur le logo application', () => {
  assert.match(docs, /const stationLogo = st\?\.photo_path \? await files\.read\(st\.photo_path\) : null/);
  assert.match(docs, /logo: stationLogo \|\| null/);
  assert.doesNotMatch(docs, /files\.read\(app\.logo_path\)/);
});
check('Logo inséré dans en-tête PDF', () => assert.match(docs, /if\s*\(b\.logo\)\s*\{\s*try\s*\{\s*doc\.image\(b\.logo/));
check('Orientation paysage à partir de six colonnes', () => assert.match(docs, /s\.head\.length\s*>\s*5/));
check('Colonnes numériques détectées depuis les intitulés', () => assert.match(docs, /const numericHeader\s*=\s*\/.*montant.*total.*prix/s));
check('Colonnes numériques détectées depuis les valeurs', () => assert.match(docs, /const numericCell\s*=\s*v\s*=>\s*typeof v === 'number'/));
check('Largeurs calculées une seule fois et normalisées à la largeur disponible', () => assert.match(docs, /const cw\s*=\s*lens\.map[\s\S]*?const factor = W \/ cw\.reduce[\s\S]*?cw\[i\] \*= factor/));
check('En-têtes et totaux alignés selon le type de colonne', () => assert.match(docs, /align:\s*rightCols\[i\]\s*\?\s*'right'\s*:\s*'left'/));
check('Les tableaux multi-pages réaffichent leurs en-têtes', () => assert.match(docs, /if\s*\(doc\.y \+ h > bottom\(\)\)\s*\{\s*doc\.addPage\(\);\s*if\s*\(kind === 'body'\)\s*row\(s\.head, 'head'\)/));
const failed = tests.filter(t => !t.ok);
for (const t of tests) console.log(`${t.ok ? 'OK' : 'FAIL'} - ${t.name}${t.error ? ': ' + t.error : ''}`);
console.log(`\n${tests.length - failed.length}/${tests.length} contrôles réussis`);
if (failed.length) process.exit(1);
