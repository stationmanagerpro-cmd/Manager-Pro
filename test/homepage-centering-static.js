'use strict';
// Accueil « éditeur visuel » : modèle par défaut = copie du fichier HTML fourni ; section À propos centrée ; tout est personnalisable.
const fs = require('fs');
const assert = require('assert');
const H = require('../public/home-core.js');
const server = fs.readFileSync('src/home_page.js', 'utf8');
const editor = fs.readFileSync('public/home-editor.js', 'utf8');
let n = 0;
function check(name, fn) { fn(); n++; console.log('✓ ' + name); }
const doc = H.sanitize(H.defaultDoc());
const find = fn => { let r = null; H.walk(doc.nodes, x => { if (!r && fn(x)) r = x; }); return r; };
check('le modèle par défaut est valide et déterministe', () => assert.strictEqual(JSON.stringify(H.defaultDoc()), JSON.stringify(H.defaultDoc())));
check('les 7 sections du fichier fourni sont présentes', () => assert.deepStrictEqual(doc.nodes.map(s => s.p.an || s.p.tag), ['header', 'accueil', 'fonctionnalites', 'solutions', 'apropos', 'contact', 'tarifs']));
check('les textes du fichier fourni sont repris', () => { const h = H.render(doc, {}).html; ['Simplifiez, organisez', 'Clients &amp; employés', 'Sauvegarde &amp; récupération', 'Station-service', 'Essayer gratuitement', 'stationmanagerpro@gmail.com'].forEach(t => assert.ok(h.includes(t), t)); });
check('le contenu de « À propos » est centré', () => { const a = doc.nodes.find(s => s.p.an === 'apropos'); const grid = a.c[0]; assert.strictEqual(grid.s.ta, 'center'); grid.c.forEach(c => { assert.strictEqual(c.s.ai, 'center'); assert.strictEqual(c.s.ta, 'center'); }); });
check('la taille du texte est réglable pour chaque élément (panneau de droite, par appareil)', () => { assert.ok(H.STYLE.fs); assert.match(editor, /fNum\(n, 'fs'/); assert.match(editor, /layerKey/); });
check('les images sont en nombre libre (aucun emplacement fixe côté serveur)', () => { assert.doesNotMatch(server, /SLOTS/); assert.match(server, /LIMITS\.images/); });
check('l’éditeur propose texte, couleur, tailles, images, position, effets et mobile', () => ['Typographie', 'Remplissage', 'Bordure', 'Effets', 'Position', 'Taille', 'Disposition', 'Tablette', 'Mobile', 'Importer'].forEach(k => assert.ok(editor.includes(k), k)));
check('l’éditeur propose un panneau de gauche, la page en direct et un panneau de droite', () => ['hbe-left', 'hbe-stage', 'hbe-right', 'srcdoc'].forEach(k => assert.ok(editor.includes(k), k)));
check('le bouton de connexion du modèle ouvre la saisie de clé', () => assert.ok(find(x => x.t === 'button' && x.p.href === 'action:login')));
console.log(`${n}/9 contrôles réussis.`);
