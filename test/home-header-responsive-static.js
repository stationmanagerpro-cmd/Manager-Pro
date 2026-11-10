'use strict';
// En-tête de l'accueil : fixe en haut, menu burger (☰) sans JavaScript sur tablette/mobile, « Se connecter » toujours visible,
// anciennes pages mises à niveau automatiquement (et jamais écrasées si l'en-tête a été retouché).
const assert = require('assert');
const fs = require('fs'), path = require('path');
const H = require('../public/home-core.js');
let n = 0, total = 0;
function check(name, fn) { total++; fn(); n++; console.log('✓ ' + name); }
const clone = o => JSON.parse(JSON.stringify(o));
const doc = H.sanitize(H.defaultDoc());
const header = d => d.nodes.find(s => s.p.tag === 'header');
const byName = (root, nm) => { let r; H.walk([root], x => { if (!r && x.p && x.p.nm === nm) r = x; }); return r; };
const login = d => { let r; H.walk(d.nodes, x => { if (x.t === 'button' && x.p.href === 'action:login') r = x; }); return r; };
/* masqué sur un appareil ? (cascade ordinateur → tablette → mobile, comme le CSS) */
const hiddenOn = (node, dev) => { const e = Object.assign({}, node.s, dev !== 'desktop' ? node.st : {}, dev === 'mobile' ? node.sm : {}); return !!e.hid; };
const mk = (burger, extra) => H.sanitize({ v: 2, meta: {}, theme: Object.assign({ font: 'sans' }, H.TOKENS), nodes: [{ id: 'h1', t: 'section', p: { tag: 'header' }, s: { pos: 'fixed', top: '0', left: '0', right: '0' }, st: {}, sm: {},
  c: [{ id: 'm1', t: 'box', p: Object.assign({ burger }, extra || {}), s: { d: 'row' }, st: {}, sm: {}, c: [{ id: 't1', t: 'text', p: { tx: 'Lien', tag: 'span', href: '#a' }, s: {}, st: {}, sm: {} }] }] }] });

check('l’en-tête du modèle est fixe en haut, sur fond marine, au-dessus de la page mais sous les fenêtres de l’appli (z-index 40 < 50)', () => {
  const h = header(doc); assert.strictEqual(h.s.pos, 'fixed'); assert.strictEqual(h.s.top, '0'); assert.strictEqual(h.s.bg, '@navy'); assert.strictEqual(h.s.z, 40);
  const css = H.render(doc, {}).css; assert.match(css, new RegExp('\\.n-' + h.id + '\\{[^}]*position:fixed'));
  assert.ok(fs.readFileSync(path.join(__dirname, '..', 'public', 'design-v2.css'), 'utf8').includes('.hp-overlay { position: fixed; inset: 0; background: rgba(8, 18, 44, .62); display: grid; place-items: center; z-index: 50'));
});
check('« Se connecter » reste visible sur ordinateur, tablette et mobile', () => {
  const b = login(doc); assert.ok(b);
  ['desktop', 'tablet', 'mobile'].forEach(d => assert.ok(!hiddenOn(b, d), d));
  let p = null; H.walk(header(doc).c, (x, par) => { if (x.id === b.id) p = par; }); ['desktop', 'tablet', 'mobile'].forEach(d => assert.ok(!hiddenOn(p, d), 'boîte « ' + p.p.nm + ' » masquée sur ' + d));
});
check('le menu du modèle est une boîte « Menu burger » (tablette et mobile ≤ 1000 px)', () => {
  const m = byName(header(doc), 'Menu'); assert.strictEqual(m.p.burger, 'tablet');
  assert.deepStrictEqual(m.c.filter(x => x.p.href && x.p.href[0] === '#').map(x => x.p.href), ['#accueil', '#fonctionnalites', '#solutions', '#tarifs', '#apropos', '#contact', '#contact']);
});
check('rendu 100 % CSS : case cachée + étiquette ☰ + panneau ; aucun script ni gestionnaire dans la page', () => {
  const r = H.render(doc, {});
  assert.match(r.html, /<input type="checkbox" class="hb-chk" id="hbk-[a-z0-9_]+" aria-label="[^"]+"><label class="hb-lbl" for="hbk-[a-z0-9_]+" aria-hidden="true"><\/label><div class="hb-panel">/);
  assert.ok(!/<script|onclick|onload|javascript:/i.test(r.html));
  assert.match(r.css, /@media\(max-width:1000px\)\{\.hpx \.hb-bp-t>\.hb-lbl\{display:inline-flex\}/);
  assert.match(r.css, /\.hb-bp-t>\.hb-chk:checked~\.hb-panel[^{]*\{display:flex\}/);
  assert.match(r.css, /\.hpx \.hb-panel\{display:contents\}/);
  assert.match(r.css, /\.hb-chk:checked\+\.hb-lbl::before[^{]*\{content:"\\2715"\}/);
});
check('le panneau se place sous l’en-tête sur toute la largeur (position absolue, haut 100 %)', () => {
  const css = H.render(doc, {}).css; assert.match(css, /\.hb-bp-t>\.hb-panel\{display:none;position:absolute;left:0;right:0;top:100%;/);
});
check('« mobile seul » : seuil 600 px ; « aucun » : pas de burger du tout', () => {
  const m = H.render(mk('mobile'), {}); assert.match(m.html, /hb-bp-m/); assert.match(m.css, /@media\(max-width:600px\)\{\.hpx \.hb-bp-m>\.hb-lbl\{display:inline-flex\}/);
  const none = H.render(mk('none'), {}); assert.ok(!/hb-chk|hb-lbl/.test(none.html)); assert.strictEqual(mk('none').nodes[0].c[0].p.burger, undefined);
  assert.ok(!/hb-chk/.test(H.render(mk(''), {}).html));
});
check('le réglage « burger » est validé côté serveur ; une boîte-lien n’en reçoit pas', () => {
  assert.throws(() => mk('toujours'), /burger/i);
  assert.ok(!/hb-chk/.test(H.render(mk('tablet', { href: '#a' }), {}).html));
});
check('sur mobile, « Essayer gratuitement » passe dans le panneau et le slogan est masqué ; sur tablette les deux boutons restent dans la barre', () => {
  const h = header(doc), menu = byName(h, 'Menu'), cta = menu.c[menu.c.length - 1], bar = byName(h, 'Boutons'), cta2 = bar.c[1];
  assert.deepStrictEqual(['desktop', 'tablet', 'mobile'].map(d => hiddenOn(cta, d)), [true, true, false]);
  assert.deepStrictEqual(['desktop', 'tablet', 'mobile'].map(d => hiddenOn(cta2, d)), [false, false, true]);
  assert.deepStrictEqual(['desktop', 'tablet', 'mobile'].map(d => hiddenOn(byName(h, 'Slogan'), d)), [false, false, true]);
});
check('« Position : fixe » et « ordre » sont validés', () => {
  const d = clone(doc); d.nodes[0].s.ord = 99; assert.strictEqual(H.sanitize(d).nodes[0].s.ord, 10);
  d.nodes[0].s.ord = 'x'; assert.throws(() => H.sanitize(d));
  const e = clone(doc); e.nodes[0].s.pos = 'fixed'; assert.strictEqual(H.sanitize(e).nodes[0].s.pos, 'fixed');
  e.nodes[0].s.pos = 'flottant'; assert.throws(() => H.sanitize(e));
});
check('les ancres tiennent compte de l’en-tête fixe (scroll-margin-top)', () => assert.match(H.render(doc, {}).css, /\.hpx \[id\^="hp-"\]\{scroll-margin-top:\d+px\}/));
check('le texte de l’en-tête (liens, boutons, logo) est lisible sur les trois appareils', () => {
  const ids = new Set(); H.walk(header(doc).c, x => { ids.add(x.id); });
  ['desktop', 'tablet', 'mobile'].forEach(d => { const hit = H.auditContrast(doc, d).issues.filter(i => ids.has(i.id)); assert.ok(hit.every(i => i.level !== 'bad' || i.ratio >= 2.6), d + ' : ' + JSON.stringify(hit.map(i => [i.id, i.ratio]))); });
  // les liens du menu (texte clair sur le panneau marine) ne sont jamais signalés
  const menu = byName(header(doc), 'Menu'); const links = new Set(menu.c.filter(x => x.t === 'text').map(x => x.id));
  ['desktop', 'tablet', 'mobile'].forEach(d => assert.deepStrictEqual(H.auditContrast(doc, d).issues.filter(i => links.has(i.id)), [], d));
});

/* ---- anciennes pages ---- */
const v71 = () => { const d = clone(doc); d.nodes[0] = H.makeSection('headerV71', new Set(['x1'])); d.nodes[1].c[0].st.pt = 150; d.nodes[1].c[0].sm.pt = 175; return d; };
check('page enregistrée avec l’en-tête précédent (identique au modèle) : passe en en-tête fixe + burger, marges du héro ajustées, identifiant conservé', () => {
  const d = v71(), id = header(d).id, out = H.sanitize(d), h = header(out);
  assert.strictEqual(h.id, id); assert.strictEqual(h.s.pos, 'fixed'); assert.strictEqual(byName(h, 'Menu').p.burger, 'tablet');
  const hero = out.nodes.find(s => s.p.an === 'accueil').c[0]; assert.strictEqual(hero.st.pt, 110); assert.strictEqual(hero.sm.pt, 100);
  assert.strictEqual(JSON.stringify(H.sanitize(out)), JSON.stringify(out));          // idempotent
});
check('très ancien en-tête (menu et connexion masqués) : corrigé, puis passé en fixe + burger', () => {
  const d = v71(), bar = header(d).c[0];
  bar.s.h = '78px'; delete bar.s.mh; bar.st = {}; bar.sm = { h: '68px', pl: 14, pr: 14 };
  const menu = byName(header(d), 'Menu'); menu.st = { hid: true }; menu.sm = {};
  const box = byName(header(d), 'Boutons'); box.st = {}; box.sm = {}; box.c[0].sm = { hid: true, pt: 10, pb: 10, pl: 12, pr: 12, fs: 11 };
  const out = H.sanitize(d), h = header(out);
  assert.strictEqual(h.s.pos, 'fixed'); assert.ok(!hiddenOn(login(out), 'mobile'));
});
check('un en-tête volontairement retouché n’est jamais écrasé', () => {
  const d = v71(); byName(header(d), 'Barre de navigation').s.gap = 31;
  const out = H.sanitize(d); assert.strictEqual(header(out).s.pos, 'absolute'); assert.strictEqual(byName(header(out), 'Barre de navigation').s.gap, 31);
  assert.strictEqual(byName(header(out), 'Menu').p.burger, undefined);
  const e = v71(); byName(header(e), 'Boutons').c[0].sm.hid = true;                 // « Se connecter » masqué par choix, menu visible
  assert.deepStrictEqual([header(H.sanitize(e)).s.pos, byName(header(H.sanitize(e)), 'Menu').st.hid], ['absolute', undefined]);
});
check('l’éditeur propose la position « Fixe » et le réglage « Menu burger », et garde le panneau ouvert pendant la sélection', () => {
  const ed = fs.readFileSync(path.join(__dirname, '..', 'public', 'home-editor.js'), 'utf8');
  ['Fixe (reste en haut au défilement)', "'burger'", 'Menu burger (☰)', 'syncBurger', 'hb-open'].forEach(k => assert.ok(ed.includes(k), k));
  const home = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-home.js'), 'utf8');
  ['hb-chk:checked', 'Escape', 'closeBurgers'].forEach(k => assert.ok(home.includes(k), k));
});
console.log(`${n}/${total} contrôles réussis.`);
