'use strict';
// Bandeau : l'ancien en-tête ne doit pas s'afficher avant la décision du bandeau (contrôle statique).
const fs = require('fs'), path = require('path'), assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const b = read('ext-banner.js'), css = read('ext-skin-pro.css');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
check('le marqueur data-hero-pending est posé dès le chargement', () => {
  assert(b.includes("d.dataset.heroPending = '1';"));
});
check('chaque décision (bandeau affiché ou non) retire le marqueur : 6 points', () => {
  assert.strictEqual(b.split('decided();').length - 1, 6);
  assert(b.includes("function decided() { if (d.dataset.heroPending) delete d.dataset.heroPending; }"));
});
check("l'ancien en-tête est masqué tant que le marqueur est présent", () => {
  assert(css.includes('html[data-skin=pro][data-hero-pending] #app-header #tenant-brand { visibility: hidden;'));
});
check("pas de repli temporisé : l'en-tête reste masqué tant que le bandeau n'est pas posé", () => {
  assert(!css.includes('heroPendingReveal'));
});
check('versions de chargement incrémentées (cache navigateur)', () => {
  const html = read('index.html');
  assert(html.includes('/ext-skin-pro.css?v=5') && html.includes('/ext-banner.js?v=3'));
});
console.log(`\n${n}/5 contrôles réussis.`);
