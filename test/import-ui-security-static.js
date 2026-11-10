'use strict';
const fs = require('fs');
const assert = require('assert');
const ui = fs.readFileSync('public/ext-import.js', 'utf8');
const sw = fs.readFileSync('public/sw.js', 'utf8');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✔ ' + label); }
check('la liste des types d’import est contrôlée par une liste blanche', () => assert.match(ui, /filter\(k => k && k\.allowed && validKind\(k\.key\)\)/));
check('les libellés des colonnes sont échappés avant insertion HTML', () => assert.match(ui, /map\(c => esc\(c && c\.label\)/));
check('le téléchargement du modèle rejette les types inconnus', () => assert.match(ui, /impDownload = async function \(kind\) \{\s*if \(!validKind\(kind\)\)/));
check('le formulaire d’import rejette les types inconnus', () => assert.match(ui, /impStart = function \(kind\) \{\s*if \(!validKind\(kind\)\)/));
check('les clés interpolées dans les gestionnaires inline sont des valeurs autorisées', () => assert.match(ui, /impDownload\('\$\{esc\(k\.key\)\}'\)/) && assert.match(ui, /impStart\('\$\{esc\(k\.key\)\}'\)/));
check('le cache statique est versionné pour invalider les anciens assets', () => assert.match(sw, /const CACHE = 'smp-static-b[0-9a-f]{10}'/));
check('les réponses API restent explicitement network-only', () => assert.match(sw, /if \(isApi\(url\)\) \{\s*event\.respondWith\(fetch\(req\)\)/));
console.log(`\n${passed}/7 contrôles statiques réussis.`);
