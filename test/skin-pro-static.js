'use strict';
// Habillage « Pro » : fichiers présents et branchés, retour au design précédent possible, texte explicite sur chaque fond coloré.
const fs = require('fs'), path = require('path'), assert = require('assert');
const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const css = pub('ext-skin-pro.css'), js = pub('ext-skin-pro.js'), html = pub('index.html'), sw = pub('sw.js');
ok(html.indexOf('ext-skin-pro.css') > html.indexOf('responsive-phone.css'), 'la feuille Pro doit être chargée en dernier');
ok(/ext-skin-pro\.js/.test(html) && /ext-skin-pro\.css/.test(sw) && /ext-skin-pro\.js/.test(sw), 'index.html et service worker');
ok(/smp-skin/.test(js) && /classic/.test(js), 'retour au design précédent');
ok(/html\[data-skin=pro\]/.test(css), 'thème Pro présent');
const loose = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map(x => x.split('{')[0].trim()).filter(x => x && !/^@/.test(x) && x.split(/,(?![^(]*\))/).some(sel => !/data-skin/.test(sel)));
ok(loose.length === 0, 'règle hors thème Pro : ' + loose[0]);
// chaque dégradé de marque est accompagné de --on-p
const blocks = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}');
for (const b of blocks) if (/linear-gradient\(\s*(100|110)deg,\s*var\(--p\)/.test(b)) ok(/var\(--on-p\)/.test(b), 'texte --on-p manquant : ' + b.slice(0, 80));
// orange « Annuler » : blanc sur #c2410c ≥ 4.5:1
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
ok(1.05 / (lum('#c2410c') + .05) >= 4.5, 'contraste orange');
const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin.js'), 'utf8');
ok(/banner_path/.test(admin) && /has_banner/.test(admin), 'routes de photo de bandeau');
ok(fs.existsSync(path.join(__dirname, '..', 'migrations', '098_station_banner.sql')), 'migration 098');
console.log(n + ' contrôles OK');
