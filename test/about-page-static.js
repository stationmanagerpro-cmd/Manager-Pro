'use strict';
// Onglet « A propos de Manager PRO » : contrôles statiques + logique pure + rendu côté navigateur simulé (aucune base requise).
const fs = require('fs'), assert = require('assert'), vm = require('vm');
const rd = p => fs.readFileSync(p, 'utf8');
const About = require('../src/about_logic.js');
const srv = rd('src/server.js'), page = rd('src/about_page.js'), shell = rd('public/ext-shell.js'), idx = rd('public/index.html'), js = rd('public/ext-about.js'), sw = rd('public/sw.js');
let n = 0; const check = (l, f) => { f(); n++; console.log('✔ ' + l); };

check('serveur : lecture ouverte à tout compte connecté (/me/about), écriture réservée au Super Admin', () => {
  assert.match(srv, /require\('\.\/about_page'\)\.r/);
  assert.match(page, /r\.get\('\/me\/about'/);
  assert.match(page, /r\.put\('\/admin\/about', principal/);
  assert.match(page, /r\.post\('\/admin\/about\/reset', principal/);
  assert.match(page, /req\.user && req\.user\.is_global/);
  assert(srv.indexOf("require('./about_page')") > srv.indexOf("app.use('/api', auth)"), 'monté après l’authentification');
});
check('modèle par défaut valide et stable après validation (10 solutions, 3 rubriques chacune)', () => {
  const d = About.defaultDoc(); assert.deepStrictEqual(About.sanitize(d), d);
  assert.strictEqual(d.solutions.length, 10);
  assert.deepStrictEqual(d.solutions.map(s => s.name), ['STATION MANAGER PRO', 'SCHOOL MANAGER PRO', 'IKA SÔ MANAGER PRO', 'PHARMA MANAGER PRO', 'FACTURE MANAGER PRO', 'PRESSING MANAGER PRO', 'GESTOCK MANAGER PRO', 'COMMERCE MANAGER PRO', 'COUTURE MANAGER PRO', 'E-COMMERCE MANAGER PRO']);
  d.solutions.forEach(s => { assert(s.objective && s.features.length >= 7 && s.benefits.length >= 5, s.name + ' : Objectif, Solutions et Avantages renseignés'); });
  assert.strictEqual(d.approach.commitments.length, 4); assert.strictEqual(d.why.items.length, 7);
});
check('téléchargement : Android = APK hébergé (fichier réel), iOS vide, aucune adresse de store inventée, seul https:// ou /telechargements/ accepté', () => {
  const d = About.defaultDoc(); assert.strictEqual(d.downloads.android_url, '/telechargements/Ika-So.apk'); assert.strictEqual(d.downloads.ios_url, '');
  assert(fs.existsSync('public/telechargements/Ika-So.apk') && fs.statSync('public/telechargements/Ika-So.apk').size > 1e6, 'le fichier APK existe');
  assert(!/play\.google|apps\.apple/i.test(JSON.stringify(d)), 'aucune adresse de store dans le modèle');
  assert.throws(() => About.sanitize({ header: { title: 'x' }, downloads: { android_url: '/autre/a.apk' } }), /https/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, downloads: { android_url: '/telechargements/../src/server.js' } }), /https/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, downloads: { android_url: '//evil.ml/a.apk' } }), /https/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, downloads: { android_url: 'http://x.ml/a.apk' } }), /https/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, downloads: { ios_url: 'javascript:alert(1)' } }), /https/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, downloads: { ios_url: 'data:text/html,<b>' } }), /https/);
  assert.strictEqual(About.sanitize({ header: { title: 'x' }, downloads: { android_url: 'https://exemple.ml/a' } }).downloads.android_url, 'https://exemple.ml/a');
});
check('compatibilité : contenu enregistré en v1 (ancienne page) reste valide, nouveaux blocs repris du modèle', () => {
  const m = About.sanitize({ v: 1, header: { title: 'T', tagline: '', intro: '' }, sections: [{ id: 'abcd', title: 'X', body: 'y' }], contact: {} });
  assert.strictEqual(m.v, 2); assert.strictEqual(m.solutions.length, 10); assert.strictEqual(m.sections.length, 1); assert.strictEqual(m.downloads.android_url, '/telechargements/Ika-So.apk');
});
check('solutions : statut contrôlé, listes et limites vérifiées', () => {
  assert.throws(() => About.sanitize({ header: { title: 'x' }, solutions: [{ name: 'a', status: 'zzz' }] }), /Statut/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, solutions: [{ name: 'a', features: 'non' }] }), /liste/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, solutions: Array.from({ length: 21 }, () => ({ name: 'n' })) }), /Maximum 20/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, solutions: [{ name: '' }] }), /obligatoire/);
});
check('validation : titre obligatoire, limites, e-mail / téléphone / site contrôlés', () => {
  assert.throws(() => About.sanitize({ header: { title: ' ' } }), /obligatoire/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, sections: Array.from({ length: 13 }, () => ({ title: 't' })) }), /Maximum 12/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, sections: [{ title: 't', body: 'a'.repeat(4001) }] }), /4000/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, contact: { website: 'javascript:alert(1)' } }), /Site web/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, contact: { email: 'pas-un-mail' } }), /E-mail/);
  assert.throws(() => About.sanitize({ header: { title: 'x' }, contact: { phone: 'abc' } }), /Téléphone/);
  assert.throws(() => About.sanitize(null), /invalide/);
  assert.strictEqual(About.sanitize({ header: { title: 'x' }, contact: { website: 'https://exemple.ml' } }).contact.website, 'https://exemple.ml');
});
check('validation : identifiants uniques, caractères de contrôle retirés, retours à la ligne conservés', () => {
  const r = About.sanitize({ header: { title: 'T' }, sections: [{ id: 'dup1', title: 'A', body: 'l1\r\nl2\u0007' }, { id: 'dup1', title: 'B' }] });
  assert.notStrictEqual(r.sections[0].id, r.sections[1].id); assert(r.sections.every(s => About.ID_RE.test(s.id)));
  assert.strictEqual(r.sections[0].body, 'l1\nl2');
});
check('contenu enregistré corrompu : retour au modèle (jamais d’erreur sur la page)', () => {
  assert.strictEqual(About.readable({ content: { header: {} } }), null); assert.strictEqual(About.readable(null), null);
  assert.deepStrictEqual(About.readable({ content: About.defaultDoc() }), About.defaultDoc());
});
check('menu : onglet placé tout en bas (après « Autres »), pour tous les comptes, avec icône Super Admin', () => {
  assert.match(shell, /const ABOUT_NODE = \{ label: 'A propos de Manager PRO'/);
  assert(shell.indexOf('if (tail) parts.push(tail.html)') > shell.indexOf("label: 'Autres'"));
  assert(shell.indexOf('const tail = node(ABOUT_NODE') < shell.indexOf('const rest = Object.keys(V)'), 'construit avant le filet de sécurité');
  assert.match(shell, /apropos: 'apropos'/); assert.match(shell, /apropos: '<circle/);
});
check('page chargée, mise en cache hors ligne', () => {
  assert.match(idx, /ext-about\.js/); assert.match(idx, /ext-about\.css/); assert.match(sw, /'\/ext-about\.js'/); assert.match(sw, /'\/ext-about\.css'/);
});

// Rendu simulé : enregistrement de la vue, droits, échappement du texte (aucune injection), édition réservée au Super Admin.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function load(meta) {
  const V = {}, VM = {}, NAV_ICONS = {}, SUPERADMIN_VIEWS = new Set(), SHARED_VIEWS = new Set();
  const sb = { V, VM, NAV_ICONS, SUPERADMIN_VIEWS, SHARED_VIEWS, esc, G: async p => { assert.strictEqual(p, '/me/about'); return meta; }, errMsg: e => String(e), window: {}, document: { getElementById: () => null, querySelectorAll: () => [] } };
  sb.window.addEventListener = () => {}; sb.window.scrollTo = () => {};
  vm.runInNewContext(js, sb); return sb;
}
const evilRaw = { v: 1, header: { title: '<img src=x onerror=alert(1)>', tagline: '"><script>x</script>', intro: '' },
  sections: [{ id: 'aaaa1', icon: '🎯', title: '<b>T</b>', visible: true, body: '- <i>a</i>\n- b\ntexte & suite' }, { id: 'aaaa2', icon: '', title: 'Cachée', visible: false, body: 'secret' }],
  contact: { email: 'a@b.ml', phone: '+223 70 00 00 00', website: 'https://exemple.ml', address: '' } };
const evil = About.sanitize(evilRaw);   // le serveur renvoie toujours un contenu validé et complet
const later = [];
const checkA = (l, f) => later.push([l, f]);
checkA('vue enregistrée : visible par Super Admin et comptes clients, sans permission particulière', () => {
  const sb = load({ content: evil, editable: false }); assert.deepStrictEqual(Array.from(sb.V.apropos), ['A propos de Manager PRO', '*']);
  assert(sb.SUPERADMIN_VIEWS.has('apropos') && sb.SHARED_VIEWS.has('apropos')); assert.strictEqual(typeof sb.VM.apropos, 'function');
});
checkA('affichage : texte échappé, rubrique masquée absente, puces rendues, pas de bouton Modifier pour un client', async () => {
  const sb = load({ content: evil, editable: false, app_version: '1.2.3' });
  const html = await sb.VM.apropos();
  assert(!/<img src=x|<script|<b>T|<i>a/.test(html), 'aucune balise injectée'); assert.match(html, /&lt;b&gt;T&lt;\/b&gt;/);
  assert.match(html, /<li>&lt;i&gt;a&lt;\/i&gt;<\/li><li>b<\/li>/); assert.match(html, /texte &amp; suite/);
  assert(!/secret|Cachée/.test(html)); assert(!/abEdit\(\)/.test(html)); assert.match(html, /version 1\.2\.3/);
  assert.match(html, /href="https:\/\/exemple\.ml" target="_blank" rel="noopener noreferrer"/); assert.match(html, /href="tel:\+223/);
});
checkA('affichage Super Admin : bouton « Modifier la page » présent', async () => {
  const sb = load({ content: About.defaultDoc(), editable: true, customized: false });
  const html = await sb.VM.apropos(); assert.match(html, /abEdit\(\)/); assert.match(html, /modèle d’origine/);
});
(async () => {
  for (const [l, f] of later) { await f(); n++; console.log('✔ ' + l); }
  console.log(`\n${n}/${n} contrôles réussis.`);
})().catch(e => { console.error(e); process.exit(1); });
