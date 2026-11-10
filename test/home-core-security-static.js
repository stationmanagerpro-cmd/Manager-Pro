'use strict';
const assert = require('assert');
const H = require('../public/home-core.js');
let n = 0;
function check(name, fn) { fn(); n++; console.log('✓ ' + name); }
const base = () => H.clone(H.defaultDoc());
const throws = (mut, re) => { const d = base(); mut(d); assert.throws(() => H.sanitize(d), re); };
check('un lien javascript: est refusé', () => throws(d => { d.nodes[1].p.href = 'javascript:alert(1)'; }, /Lien non autorisé/));
check('une couleur arbitraire est refusée', () => throws(d => { d.nodes[1].s.color = 'red;background:url(x)'; }, /Couleur invalide/));
check('une dimension piégée est refusée', () => throws(d => { d.nodes[1].s.w = '1px;position:fixed'; }, /Dimension invalide/));
check('des colonnes avec url() sont refusées', () => throws(d => { d.nodes[1].c[0].s.tpl = 'url(x)'; }, /Colonnes invalides/));
check('les identifiants en double sont refusés', () => throws(d => { d.nodes[1].id = d.nodes[0].id; }, /double/));
check('un élément hors section à la racine est refusé', () => throws(d => { d.nodes.push({ id: 'zz', t: 'text', p: { tx: 'x' }, s: {} }); }, /sections/));
check('le HTML saisi dans un texte est échappé', () => { const d = base(); d.nodes[1].c[0].c[0].c[0].p.tx = '<img src=x onerror=alert(1)>'; const h = H.render(H.sanitize(d), {}).html; assert.ok(!h.includes('<img src=x')); });
check('les clés de style inconnues sont ignorées', () => { const d = base(); d.nodes[0].s.evil = 'x'; assert.ok(!('evil' in H.sanitize(d).nodes[0].s)); });
check('tous les modèles de sections et d’éléments sont valides', () => { H.SECTION_TEMPLATES.forEach(t => H.sanitize({ v: 2, nodes: [H.makeSection(t.key, new Set())] })); H.ELEMENT_TEMPLATES.forEach(t => H.sanitize({ v: 2, nodes: [{ id: 's1', t: 'section', p: {}, s: {}, c: [H.makeElement(t.key, new Set())] }] })); });
check('les surcharges tablette et mobile produisent des media queries', () => { const css = H.render(H.sanitize(base()), {}).css; assert.match(css, /@media\(max-width:1000px\)/); assert.match(css, /@media\(max-width:600px\)/); });
console.log(`${n}/10 contrôles réussis.`);
