'use strict';
// Zone PUB du menu de gauche : contrôles statiques.
const fs = require('fs'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const js = rd('public/ext-sidebar-pub.js'), idx = rd('public/index.html'), css = rd('public/responsive-v3.css'), dsg = rd('public/ext-design.js'), det = rd('public/ext-detail-pages.js'), br = rd('src/branding.js');
let n = 0; const check = (l, f) => { f(); n++; console.log('✔ ' + l); };
check('données : /me/advertising (activé ET publié), délai configurable 10–3600 s, 60 s par défaut', () => {
  assert.match(js, /G\('\/me\/advertising'\)/); assert.match(br, /const visible = cfg\.enabled && cfg\.published/); assert.match(br, /interval >= 10 && interval <= 3600 \? Math\.round\(interval\) : 60/);
  assert.match(js, /Math\.max\(10, Number\(ad\.interval_sec\) \|\| 60\)/);
});
check('ordre aléatoire (Fisher-Yates) et défilement seulement s\'il y a plusieurs images', () => {
  assert.match(js, /Math\.random\(\)/); assert.match(js, /if \(urls\.length > 1\) timer = setInterval/);
});
check('essai du mélange : permutation valide', () => {
  const m = js.match(/function shuffle\(n\) \{[\s\S]*?\n  \}/)[0]; const shuffle = new Function(m + '; return shuffle;')();
  for (let k = 1; k <= 5; k++) { const a = shuffle(k); assert.deepStrictEqual([...a].sort(), Array.from({ length: k }, (_, i) => i)); }
});
check('zone dans #nav (en bas), reconstruite si le menu est redessiné, absente pour le Super Admin', () => {
  assert.match(js, /nav\.appendChild\(z\)/); assert.match(js, /MutationObserver/); assert.match(js, /ME\.is_global/);
});
check('petit pop-up d\'agrandissement (clic, croix, Échap)', () => { assert.match(js, /openPopup/); assert.match(js, /Escape/); assert.match(css, /\.pub-popup \{/); });
check('menu replié ou écran bas : zone masquée', () => { assert.match(css, /#nav\.nav2\.collapsed \.nav-pub \{ display: none/); assert.match(css, /max-height: 640px/); });
check('tableau de bord : plus d\'images (texte seulement) ; aide Super Admin mise à jour', () => {
  assert(!dsg.includes("'<!--PUB_ZONE-->' + imageZone")); assert.match(det, /tout en bas du menu de gauche/);
});
check('script chargé', () => assert.match(idx, /ext-sidebar-pub\.js/));
check('place insuffisante : la zone s\'efface pour laisser les sous-onglets (fitPub), jamais de masquage du menu', () => {
  assert.match(js, /function fitPub\(\)/); assert.match(js, /nav-pub-off/); assert.match(css, /\.nav-pub\.nav-pub-off \{ display: none !important/);
  assert.match(js, /subtree: true/);
});
console.log(`\n${n}/9 contrôles réussis.`);
