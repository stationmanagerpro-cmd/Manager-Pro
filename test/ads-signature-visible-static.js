// Publicité et signature imposée : doivent rester visibles quelle que soit la disposition (menu masqué, téléphone, écran bas).
const fs = require('fs'), path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pub = read('public/ext-sidebar-pub.js'), css = read('public/responsive-v3.css'), shell = read('public/ext-shell.js'), det = read('public/ext-detail-pages.js'), core = read('public/ext-core.js');
const checks = [
  ['la bannière pub s\'affiche dès que la zone du menu n\'est pas visible', /function syncPub\(\)/.test(pub) && /classList\.toggle\('show', !zoneVisible\)/.test(pub)],
  ['la bannière pub n\'est plus limitée aux écrans ≤ 860 px', /\.pub-mobile\.show \{ display: flex/.test(css) && !/@media \(max-width: 860px\) \{\s*\.pub-mobile \{ display: flex/.test(css)],
  ['la synchronisation suit redimensionnement et changements du menu', /addEventListener\('resize', \(\) => \{ syncPub\(\); fitPub\(\); \}\)/.test(pub) && /attributeFilter: \['class', 'style'\]/.test(pub)],
  ['l\'envoi d\'image réduit automatiquement les photos lourdes', /function adCompress/.test(det) && /1\.5 \* 1024 \* 1024/.test(det)],
  ['la signature imposée est affichée en haut sous le nom du client', /tenant-sig/.test(shell) && /forced_signature/.test(shell)],
  ['la signature imposée reste affichée en pied de page', /forced-sig/.test(core)],
];
let bad = 0; for (const [n, ok] of checks) { console.log((ok ? '✔ ' : '✖ ') + n); if (!ok) bad++; }
console.log(`\n${checks.length - bad}/${checks.length} contrôles réussis`); process.exit(bad ? 1 : 0);
