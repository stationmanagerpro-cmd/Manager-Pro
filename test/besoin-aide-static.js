'use strict';
// Besoin d'aide : bouton permanent dans la bannière et vue en cartes par module (sans contenu inventé).
const fs = require('fs'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const idx = rd('public/index.html'), help = rd('public/ext-help.js'), css = rd('public/responsive-v3.css');
const bar = idx.slice(idx.indexOf('class="brandbar-right"'), idx.indexOf('id="live-clock"'));
assert(bar.includes('id="help-top-btn"') && bar.includes("go('aide')"), 'bouton « Besoin d\'aide » dans la bannière (brandbar-right)');
assert(idx.indexOf('ext-help.js') > idx.indexOf('ext-confort.js') && idx.indexOf('ext-help.js') > 0, 'ext-help.js chargé après app.js et ext-confort.js');
assert(help.includes("V.aide = [\"Besoin d'aide\", '*']") && help.includes('VM.aide'), 'vue aide enregistrée');
assert(help.includes('canView(k)'), 'seuls les modules accessibles sont affichés');
assert(!/https?:\/\//.test(help), 'aucun lien vidéo inventé');
assert(/#app-header \.help-top-btn/.test(css) && /\.help-grid/.test(css), 'styles du bouton et des cartes');
console.log('✔ besoin d\'aide : bouton bannière, vue par module, sans contenu inventé');
console.log('OK besoin-aide-static (6 assertions)');
