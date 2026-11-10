'use strict';
// Alerte de lisibilité de l'éditeur d'accueil : le moteur repère les textes trop proches de leur fond (WCAG), appareil par appareil.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const H = require('../public/home-core.js');
let n = 0, total = 0;
function check(name, fn) { total++; fn(); n++; console.log('✓ ' + name); }
const doc = () => H.sanitize(H.defaultDoc());
const textNode = (d, start) => { let r; H.walk(d.nodes, x => { if (!r && x.t === 'text' && x.p.tx && x.p.tx.startsWith(start)) r = x; }); return r; };
const mk = (nodes, theme) => H.sanitize({ v: 2, meta: {}, theme: Object.assign({ font: 'sans' }, H.TOKENS, theme || {}), nodes });
const sec = (s, c) => ({ id: 's1', t: 'section', p: {}, s, st: {}, sm: {}, c });
const txt = (id, tx, s, st, sm) => ({ id, t: 'text', p: { tx, tag: 'p' }, s: s || {}, st: st || {}, sm: sm || {} });

check('rapport de contraste WCAG exact (noir/blanc = 21:1)', () => {
  assert.ok(Math.abs(H.contrastRatio('#000000', '#ffffff') - 21) < 0.01);
  assert.ok(Math.abs(H.contrastRatio('#777777', '#ffffff') - 4.48) < 0.02);
});
check('le cas d’origine : « Texte discret » rouge sur le fond marine du héro est signalé', () => {
  const d = doc(); d.theme.muted = '#ff0000'; textNode(d, 'Une plateforme pensée').s.color = '@muted';
  const hit = H.auditContrast(d, 'desktop').issues.filter(i => i.fgTok === 'muted' && i.id === textNode(d, 'Une plateforme pensée').id);
  assert.strictEqual(hit.length, 1); assert.strictEqual(hit[0].level, 'bad'); assert.ok(hit[0].ratio < 3); assert.ok(hit[0].suggest);
});
check('texte et fond proches : illisible (< 3:1) ; moyen (3 à 4,5:1) : « peu lisible »', () => {
  let a = H.auditContrast(mk([sec({ bgT: 'color', bg: '#04152f' }, [txt('t1', 'Bonjour', { color: '#0a2147' })])]), 'desktop').issues;
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].level, 'bad'); assert.strictEqual(a[0].bgHex, '#04152f');
  a = H.auditContrast(mk([sec({ bgT: 'color', bg: '#ffffff' }, [txt('t1', 'Bonjour', { color: '#8a8a8a' })])]), 'desktop').issues;
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].level, 'low');
  assert.deepStrictEqual(H.auditContrast(mk([sec({ bgT: 'color', bg: '#ffffff' }, [txt('t1', 'Bonjour', { color: '#222222' })])]), 'desktop').issues, []);
});
check('la couleur du texte est héritée du parent, et le fond du premier parent opaque', () => {
  const a = H.auditContrast(mk([sec({ bgT: 'color', bg: '#04152f', color: '#0a2147' }, [{ id: 'b1', t: 'box', p: {}, s: {}, st: {}, sm: {}, c: [txt('t1', 'Hérité', {})] }])]), 'desktop').issues;
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].id, 't1'); assert.strictEqual(a[0].fgHex, '#0a2147');
});
check('un dégradé est mesuré sur sa pire couleur', () => {
  const g = { bgT: 'gradient', gr: [{ c: '#000000', p: 0 }, { c: '#ffffff', p: 100 }], ang: 90 };
  const a = H.auditContrast(mk([sec(g, [txt('t1', 'Sur dégradé', { color: '#ffffff' })])]), 'desktop').issues;
  assert.strictEqual(a.length, 1); assert.strictEqual(a[0].bgHex, '#ffffff');
});
check('les réglages tablette / mobile sont évalués appareil par appareil', () => {
  const d = mk([sec({ bgT: 'color', bg: '#04152f' }, [txt('t1', 'Titre', { color: '#ffffff' }, {}, { color: '#0a2147' })])]);
  assert.strictEqual(H.auditContrast(d, 'desktop').issues.length, 0);
  assert.strictEqual(H.auditContrast(d, 'tablet').issues.length, 0);
  assert.strictEqual(H.auditContrast(d, 'mobile').issues.length, 1);
});
check('un texte masqué sur l’appareil n’est pas évalué', () => {
  const d = mk([sec({ bgT: 'color', bg: '#04152f' }, [txt('t1', 'Titre', { color: '#0a2147' }, {}, { hid: true })])]);
  assert.strictEqual(H.auditContrast(d, 'desktop').issues.length, 1); assert.strictEqual(H.auditContrast(d, 'mobile').issues.length, 0);
});
check('le grand texte tolère 3:1 ; les couleurs de thème (@jeton) suivent le thème', () => {
  const big = H.auditContrast(mk([sec({ bgT: 'color', bg: '#ffffff' }, [txt('t1', 'Grand', { color: '#8a8a8a', fs: 40 })])]), 'desktop').issues;
  assert.deepStrictEqual(big, []);
  const d = mk([sec({ bgT: 'color', bg: '@navy' }, [txt('t1', 'Jeton', { color: '@muted' })])], { muted: '#0b2a55' });
  const a = H.auditContrast(d, 'desktop').issues; assert.strictEqual(a.length, 1); assert.strictEqual(a[0].fgTok, 'muted'); assert.deepStrictEqual(a[0].bgToks, ['navy']);
});
check('un élément « absolu » sans fond propre n’est pas évalué (fond inconnu) ; un fond translucide l’est', () => {
  assert.deepStrictEqual(H.auditContrast(mk([sec({ pos: 'absolute', color: '#ffffff' }, [txt('t1', 'Flotte', {})])]), 'desktop').issues, []);
  assert.strictEqual(H.auditContrast(mk([sec({ bgT: 'color', bg: '#ffffff80' }, [txt('t1', 'Translucide', { color: '#fafafa' })])]), 'desktop').issues.length, 1);
});
check('boutons : le fond du style de base est pris en compte', () => {
  const b = { id: 'bt1', t: 'button', p: { lb: 'Clic', vr: 'white', href: '' }, s: { color: '#ffffff' }, st: {}, sm: {} };
  const a = H.auditContrast(mk([sec({}, [b])]), 'desktop').issues; assert.strictEqual(a.length, 1); assert.strictEqual(a[0].bgHex, '#ffffff');
});
check('la couleur proposée respecte le contraste demandé', () => {
  const a = H.auditContrast(mk([sec({ bgT: 'color', bg: '#04152f' }, [txt('t1', 'Bonjour', { color: '#0a2147' })])]), 'desktop').issues[0];
  assert.ok(a.suggest && H.contrastRatio(a.suggest, '#04152f') >= 4.5);
});
check('pictogrammes décoratifs (emoji, symboles) ignorés ; lettres d’une icône évaluées', () => {
  const ic = (id, gl) => ({ id, t: 'icon', p: { gl, src: '' }, s: { color: '#ffffff' }, st: {}, sm: {} });
  const a = H.auditContrast(mk([sec({ bgT: 'color', bg: '#ffffff' }, [ic('i1', '🛒'), ic('i2', '▤'), ic('i3', 'SM')])]), 'desktop').issues;
  assert.deepStrictEqual(a.map(x => x.id), ['i3']);
});
check('l’éditeur affiche les alertes (badge, bannière, correction en un clic) et prévient avant de publier', () => {
  const ed = fs.readFileSync(path.join(__dirname, '..', 'public', 'home-editor.js'), 'utf8');
  ['auditContrast', 'hbe-warn', 'hbe-aud', 'data-c="fixc"', 'data-thw', "c === 'fixc'", 'illisibles'].forEach(k => assert.ok(ed.includes(k), k));
  assert.match(ed, /Publier cette version[^\n]*warn/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'home-editor.css'), 'utf8');
  ['.hbe-w.bad', '.hbe-wbox', '#hbe .hbe-aud[hidden]'].forEach(k => assert.ok(css.includes(k), k));
});
console.log(`${n}/${total} contrôles réussis.`);
