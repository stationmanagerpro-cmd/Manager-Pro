'use strict';
// Bandeau : l'ancien en-tête ne doit pas s'afficher avant la décision du bandeau (contrôle statique).
const fs = require('fs'), path = require('path'), assert = require('assert');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const b = read('ext-banner.js'), css = read('ext-skin-pro.css');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
check('le marqueur data-hero-pending est posé dès le chargement', () => {
  assert(b.includes("d.dataset.heroPending = '1';"));
});
check('chaque décision (bandeau affiché ou non) retire le marqueur : 5 points', () => {
  assert.strictEqual(b.split('decided();').length - 1, 5);
  assert(b.includes("function decided() { if (d.dataset.heroPending) delete d.dataset.heroPending; }"));
});
check("l'ancien en-tête est masqué tant que le marqueur est présent", () => {
  assert(css.includes('html[data-skin=pro][data-hero-pending] #app-header #tenant-brandbar { visibility: hidden;'));
});
check("repli : l'en-tête redevient visible après 2,5 s si aucune décision n'est prise", () => {
  assert(css.includes('animation: heroPendingReveal 0s linear 2.5s forwards;'));
  assert(css.includes('@keyframes heroPendingReveal { to { visibility: visible; } }'));
});
check('versions de chargement incrémentées (cache navigateur)', () => {
  const html = read('index.html');
  assert(html.includes('/ext-skin-pro.css?v=4') && html.includes('/ext-banner.js?v=3'));
});
console.log(`\n${n}/5 contrôles réussis.`);
