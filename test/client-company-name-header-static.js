'use strict';
const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('public/index.html', 'utf8');
const shell = fs.readFileSync('public/ext-shell.js', 'utf8');
const shellCss = fs.readFileSync('public/ext-shell.css', 'utf8');
const designCss = fs.readFileSync('public/design-v2.css', 'utf8');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log(`✓ ${label}`); }
check('une barre de marque dédiée existe au-dessus du contenu', () => {
  assert.match(html, /<div class="tenant-brandbar" id="tenant-brandbar">[\s\S]*?id="tenant-brand"/);
  assert.ok(html.indexOf('id="tenant-brandbar"') < html.indexOf('id="topbar-ctx"'));
});
check('le nom affiché vient de la station active, puis du compte client', () => assert.match(shell, /name\s*=\s*st\.name\s*\|\|\s*st\.client_name\s*\|\|/));
check('la barre est visible sur écran large aussi', () => {
  assert.doesNotMatch(designCss, /@media\s*\(min-width:\s*861px\)\s*\{\s*#tenant-brandbar\s*\{\s*display:\s*none/);
  assert.match(designCss, /#tenant-brandbar\s*\{\s*display:\s*flex/);
});
check('le nom utilise une grande taille adaptative', () => {
  assert.match(shellCss, /\.tenant-brand-copy b\s*\{[^}]*font-size:\s*clamp\(21px,\s*2vw,\s*28px\)/s);
  assert.match(shellCss, /\.tenant-brand-copy b\s*\{[^}]*font-weight:\s*850/s);
});
check('la barre est masquée pour le Superadmin multi-clients', () => assert.match(shell, /tenantBar\.hidden\s*=\s*!!\(ME\s*&&\s*ME\.is_global\)/));
check('le nom long peut revenir à la ligne sans déborder', () => assert.match(shellCss, /overflow-wrap:\s*anywhere/));
check('le style tient compte des petits écrans', () => assert.match(shellCss, /\.tenant-brand-copy b\s*\{\s*font-size:\s*clamp\(19px,\s*5vw,\s*23px\)/));
check('le logo réel du compte/station est chargé depuis son image enregistrée', () => {
  assert.match(shell, /st\.has_logo\s*&&\s*typeof SID !== 'undefined'\s*&&\s*SID/);
  assert.match(shell, /api\/images\/stations/);
  assert.match(shell, /Logo \$\{esc\(name\)\}/);
  assert.match(shell, /logoHtml\s*=\s*brandMarkInner\(\)/);
});
check('le logo est plus visible sur ordinateur', () => assert.match(shellCss, /\.tenant-brand-mark\s*\{[^}]*width:\s*60px;\s*height:\s*60px/s));
check('le logo reste assez grand sur mobile', () => assert.match(shellCss, /\.tenant-brand-mark\s*\{\s*width:\s*46px;\s*height:\s*46px/s));
console.log(`\n${passed}/10 contrôles réussis.`);
