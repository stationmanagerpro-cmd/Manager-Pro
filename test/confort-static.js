'use strict';
// Confort visible (A4, A5, A6, A9) : contrôles statiques + essai des fonctions de formatage (sans base de données).
const fs = require('fs'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const app = rd('public/app.js'), cf = rd('public/ext-confort.js'), idx = rd('public/index.html'), shell = rd('public/ext-shell.js'), rv3 = rd('public/responsive-v3.css'), msg = rd('src/messaging.js');
let n = 0; const check = (l, f) => { f(); n++; console.log('✔ ' + l); };

// Extraction des vraies fonctions de app.js pour les exécuter
const loc = () => 'fr-FR'; let CUR = 'FCFA';
const src = app.slice(app.indexOf('const nfr ='), app.indexOf('const errMsg'));
const fl = n => Math.round((+n || 0) * 100) / 100;
const { f, fq, dt, dts, stFr } = new Function('loc', 'CUR', 'fl', src + '; return { f, fq, dt, dts, stFr };')(loc, CUR, fl);
const norm = s => s.replace(/[\u202f\u00a0]/g, ' ');

check('A5 montants : « 2 845 000 FCFA » et « −2 500 FCFA »', () => { assert.strictEqual(norm(f(2845000)), '2 845 000 FCFA'); assert.strictEqual(norm(f(-2500)), '−2 500 FCFA'); assert.strictEqual(norm(f(0)), '0 FCFA'); });
check('A5 quantités : « 1 840,5 L » (virgule, séparateur de milliers)', () => { assert.strictEqual(norm(fq(1840.5)), '1 840,5 L'); assert.strictEqual(norm(fq(482310.5)), '482 310,5 L'); });
check('A5 dates : sans secondes dans les listes, avec secondes pour l\'audit', () => {
  const d = new Date(2026, 9, 21, 16, 53, 14);
  assert.strictEqual(norm(dt(d)).replace(',', ''), '21/10/2026 16:53'); assert.match(norm(dts(d)), /16:53:14/);
});
check('A5 statuts : cloture → Clôturé, ouvert → Ouvert, annule → Annulé, facture → Facturé, recu → Reçu, commande → Commandé', () => {
  assert.deepStrictEqual(['cloture', 'ouvert', 'annule', 'facture', 'recu', 'commande'].map(stFr), ['Clôturé', 'Ouvert', 'Annulé', 'Facturé', 'Reçu', 'Commandé']);
});
check('A5 : l\'audit garde les secondes ; l\'écart de caisse passe par f()', () => { assert.match(app, /dts\(a\.created_at\)/); assert.match(app, /f\(s\.cash_gap\)/); });
check('A5 filet : statuts exacts, litres « 1840.5 L », dates avec secondes (hors audit)', () => {
  assert.match(cf, /RE_L = /); assert.match(cf, /RE_SEC = /); assert.match(cf, /cur === 'audit'/); assert(!/characterData/.test(cf.replace(/pas characterData[^\n]*/, '')));
});
check('A6 : un seul tableau (pompe, emplacement, statut, compteur, produit, index, dernier clôturé, clôture, actions)', () => {
  assert.match(cf, /VM\.pompes = async function/); for (const t of ['Emplacement', 'Index courant', 'Dernier clôturé', 'Corriger index', 'addPump', "go('stock')", "go('quart')", 'editPump']) assert(cf.includes(t), t);
  assert.match(cf, /correctCounterIndex\(/);
});
check('A9 : un seul élément de menu « Alertes », anciens liens redirigés vers les onglets', () => {
  assert.match(shell, /'periodlock', 'alert'\] \}/); assert(!/'alert', 'alertcfg'/.test(shell));
  for (const t of ['À traiter', 'Configuration', 'Règles de notification', 'Historique']) assert(cf.includes(t), t);
  assert.match(cf, /MAP\[k\]/);
});
check('A9.3 : message clair si l\'e-mail n\'est pas configuré (route sans secret)', () => {
  assert.match(msg, /\/messaging\/email-status/); assert.match(cf, /n'est pas configuré sur le serveur/); assert(!/SMTP_PASS\s*:/.test(msg.slice(msg.indexOf('email-status'), msg.indexOf('email-status') + 300)));
});
check('A4 : barre du haut sans retour à la ligne dès 1280 px', () => { assert.match(rv3, /@media \(min-width: 1280px\) \{\s*#app-header \.top \{ flex-wrap: nowrap/); });
check('chargement : ext-confort.js après les autres modules', () => assert(idx.indexOf('ext-confort.js') > idx.indexOf('ext-push.js')));
check('Tableaux : défilement horizontal visible, plus de overflow:hidden sur .tw', () => {
  assert(!/#pg \.tw \{[^}]*overflow: hidden/.test(rv3));
  assert.match(rv3, /\.tw, \.tw-auto, \.dv2-tw, \.table-wrap[\s\S]*overflow-x: auto !important/);
  assert.match(rv3, /::-webkit-scrollbar \{ height: 12px; \}/);
});
console.log(`\n${n}/12 contrôles réussis.`);
