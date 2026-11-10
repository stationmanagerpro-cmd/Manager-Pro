'use strict';
const fs = require('fs');
const assert = require('assert');
const css = fs.readFileSync('public/design-v2.css', 'utf8');
const home = fs.readFileSync('public/ext-home.js', 'utf8');
let n = 0;
function check(name, fn) { fn(); n++; console.log('✓ ' + name); }
check('les styles mobiles ciblent les écrans de 600 px ou moins', () => assert.match(css, /@media\s*\(max-width:\s*600px\)\s*\{[^}]*\.hp-nav/s));
check('la navigation mobile peut revenir à la ligne sans déborder', () => { assert.match(css, /\.hp-nav\s*\{[^}]*align-items:\s*stretch/s); assert.match(css, /\.hp-brand b\s*\{[^}]*overflow-wrap:\s*anywhere/s); });
check('les liens et boutons de navigation ont une cible tactile adaptée', () => assert.match(css, /\.hp-links a, \.hp-links \.hp-btn\s*\{[^}]*min-height:\s*44px/s));
check('le contenu hero et la galerie passent en une colonne sur mobile', () => { assert.match(css, /\.hp-hero-text\s*\{\s*flex-basis:\s*100%/); assert.match(css, /\.hp-grid, \.hp-gal\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/); });
check('la boîte de dialogue de clé reste dans la hauteur visible', () => assert.match(css, /\.hp-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 32px\)/s));
check('le champ de clé prend la largeur disponible sur mobile', () => assert.match(css, /\.hp-dialog input\s*\{[^}]*width:\s*100%/s));
check('les deux actions du dialogue restent accessibles au toucher', () => assert.match(css, /\.hp-dlg-actions button\s*\{\s*flex:\s*1 1 130px;\s*min-height:\s*44px/s));
check('le flux de vérification de clé existant est conservé', () => assert.match(home, /\/api\/public\/access\/verify/));
console.log(`${n}/8 contrôles réussis.`);
