'use strict';
// Couleurs personnalisables du menu et de l'en-tête : contrôles statiques (sans base de données).
const fs = require('fs'), assert = require('assert');
const rd = p => fs.readFileSync(p, 'utf8');
const srv = rd('src/nav_colors.js'), admin = rd('src/admin.js'), auth = rd('src/auth.js');
const js = rd('public/ext-nav-colors.js'), idx = rd('public/index.html'), v2 = rd('public/design-v2.css'), rv3 = rd('public/responsive-v3.css'), shell = rd('public/ext-shell.js');
let n = 0; const check = (l, f) => { f(); n++; console.log('✔ ' + l); };

check('serveur : schéma partagé, couleur #RRGGBB, trop claire refusée, null = défaut', () => {
  assert.match(srv, /relLum\(v\) <= MAX_LUMINANCE/); assert.match(srv, /\.nullable\(\)/); assert.match(srv, /\.strict\(\)/);
});
check('station : paramètre nav_colors (appearance.manage) + restriction contrat + lecture via /appearance', () => {
  assert.match(admin, /nav_colors: \{ perm: 'appearance\.manage'/);
  assert.match(admin, /req\.params\.key === 'nav_colors'/);
  assert.match(admin, /nav_colors: await getSetting\(req\.sid, 'nav_colors'\)/);
});
check('personnel : GET / PUT / DELETE /me/preferences/nav-colors isolés par user_id', () => {
  for (const m of ['get', 'put', 'delete']) assert.match(auth, new RegExp("priv\\." + m + "\\('/me/preferences/nav-colors'"));
  assert.match(auth, /user_id=\$1 AND key='nav_colors'/);
});
check('CSS : menu = --nav-bg, en-tête = --hd-bg, avec repli sur --sb-bg (défaut inchangé)', () => {
  assert.match(v2, /#nav\.nav2 \{ background: var\(--nav-bg, var\(--sb-bg\)\)/);
  assert.match(rv3, /background: var\(--hd-bg, var\(--sb-bg\)\)/);
});
check('UI : script chargé, entrée du menu profil, carte dans Paramètres → Apparence', () => {
  assert.match(idx, /ext-nav-colors\.js/); assert.match(shell, /personalNavColorsEditor/);
  assert.match(js, /SEC_FN\.app = async function/); assert.match(js, /can\('appearance\.manage'\)/);
});
check('priorité : personnelle > station > défaut', () => assert.match(js, /NAV\.personal && ok\(NAV\.personal\[k\]\) && NAV\.personal\[k\]\) \|\| \(NAV\.station/));
check('contraste : défaut et palettes acceptés, couleurs claires refusées (même seuil client/serveur)', () => {
  const lum = h => { const n = parseInt(h.slice(1), 16), g = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * g(n >> 16 & 255) + .7152 * g(n >> 8 & 255) + .0722 * g(n & 255); };
  for (const c of ['#0c1f45', '#0a6b5c', '#3f1d5c', '#7a1f2b', '#1f2937', '#7c2d12', '#2563eb']) assert(lum(c) <= .18, c);
  for (const c of ['#ffffff', '#fde047', '#93c5fd', '#e5e7eb']) assert(lum(c) > .18, c);
  assert.match(srv, /MAX_LUMINANCE = 0\.18/); assert.match(js, /MAX_LUM = 0\.18/);
});
console.log(`\n${n}/7 contrôles statiques réussis.`);
