#!/usr/bin/env node
// ANO-10 / RG-12 : génère la liste de pré-chargement du service worker et dérive le nom du cache d'un identifiant de build.
//  - PRECACHE = tous les scripts, feuilles de style et icônes locaux référencés par public/index.html (+ page d'accueil, manifest, pwa) ;
//  - CACHE = 'smp-static-b' + empreinte SHA-1 (10 car.) du contenu de ces fichiers : un seul octet modifié dans un JS/CSS de l'interface
//    change le nom du cache, donc l'ancienne version n'est plus jamais servie après un correctif.
// Usage : npm run build:sw   (écrit public/sw.js)   |   node scripts/build-sw.js --check   (échoue si sw.js n'est pas à jour)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pub = path.resolve(__dirname, '..', 'public');
const swPath = path.join(pub, 'sw.js');
const BEGIN = '/* PRECACHE:BEGIN (généré par scripts/build-sw.js — ne pas modifier à la main) */';
const END = '/* PRECACHE:END */';
const EXTRA = ['/', '/index.html', '/manifest.json', '/pwa.js', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

function collect() {
  const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  const urls = new Set(EXTRA);
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g)) urls.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*\brel="stylesheet"/g)) urls.add(m[1]);
  const list = [], missing = [];
  for (const u of [...urls].sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)))) {
    if (!u.startsWith('/') || u.startsWith('//') || u.startsWith('/api/')) continue;     // externes et API : jamais pré-chargés
    const file = u === '/' ? 'index.html' : u.split('?')[0].replace(/^\//, '');
    if (!fs.existsSync(path.join(pub, file))) { missing.push(u); continue; }
    list.push(u);
  }
  return { list, missing };
}
const readPublic = file => fs.readFileSync(path.join(pub, file));
function buildId(list, read = readPublic) {
  const h = crypto.createHash('sha1');
  for (const u of list) {
    const file = u === '/' ? 'index.html' : u.split('?')[0].replace(/^\//, '');
    h.update(u + '\0'); h.update(read(file)); h.update('\0');
  }
  return 'smp-static-b' + h.digest('hex').slice(0, 10);
}
function render(src) {
  const { list, missing } = collect();
  const id = buildId(list);
  const block = BEGIN + '\nconst PRECACHE = [\n' + list.map(u => `  '${u}'`).join(',\n') + '\n];\n' + END;
  let out = src.replace(/const CACHE = '[^']*';/, `const CACHE = '${id}';`);
  const a = out.indexOf(BEGIN), b = out.indexOf(END);
  if (a >= 0 && b > a) out = out.slice(0, a) + block + out.slice(b + END.length);
  else out = out.replace(/const PRECACHE = \[[\s\S]*?\n\];/, block);   // première génération : remplace l'ancienne liste manuelle
  return { out, id, count: list.length, missing };
}
module.exports = { collect, buildId, render, swPath };

if (require.main === module) {
  const src = fs.readFileSync(swPath, 'utf8');
  const r = render(src);
  if (process.argv.includes('--check')) {
    if (r.out !== src) { console.error('public/sw.js n\'est pas à jour (cache attendu : ' + r.id + '). Lancez : npm run build:sw'); process.exit(1); }
    console.log('sw.js à jour : ' + r.id + ' (' + r.count + ' fichiers pré-chargés)');
  } else {
    fs.writeFileSync(swPath, r.out);
    console.log('sw.js généré : ' + r.id + ' (' + r.count + ' fichiers pré-chargés)');
  }
  if (r.missing.length) console.warn('Fichiers référencés mais absents (non pré-chargés) : ' + r.missing.join(', '));
}
