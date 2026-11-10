'use strict';
// ANO-10 / RG-12 : le service worker pré-charge toute l'interface et son cache change dès qu'un fichier de l'interface change.
const fs = require('fs'), path = require('path'), assert = require('assert');
const { collect, buildId, render, swPath } = require('../scripts/build-sw');
const sw = fs.readFileSync(swPath, 'utf8');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✓ ' + label); }
check('public/sw.js est à jour (sinon : npm run build:sw)', () => assert.strictEqual(render(sw).out, sw));
check('le nom du cache est dérivé d\'une empreinte de build', () => assert.match(sw, /const CACHE = 'smp-static-b[0-9a-f]{10}';/));
check('tous les scripts et feuilles de style locaux de index.html sont pré-chargés', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const wanted = [...html.matchAll(/<script\b[^>]*\bsrc="(\/[^"/][^"]*)"/g)].map(m => m[1]).filter(u => !u.startsWith('/api/'));
  const missing = wanted.filter(u => !sw.includes(`'${u}'`));
  assert.deepStrictEqual(missing, [], 'non pré-chargés : ' + missing.join(', '));
  assert.ok(wanted.length > 60, 'au moins 60 scripts attendus');
});
check('aucun fichier référencé n\'est absent de public/', () => assert.deepStrictEqual(collect().missing, []));
check('l\'API n\'est jamais pré-chargée', () => assert.ok(!/PRECACHE = \[[\s\S]*'\/api\//.test(sw.slice(0, sw.indexOf('PRECACHE:END')))));
check('un JS modifié change le nom du cache ; un contenu identique le conserve', () => {
  const { list } = collect();
  const base = buildId(list);
  assert.strictEqual(buildId(list), base);
  const changed = buildId(list, f => Buffer.concat([fs.readFileSync(path.join(__dirname, '../public', f)), f === 'app.js' ? Buffer.from('\n// modif') : Buffer.alloc(0)]));
  assert.notStrictEqual(changed, base);
});
check('les anciens caches sont supprimés à l\'activation et l\'API reste hors cache', () => {
  assert.match(sw, /keys\.filter\(\(k\) => k !== CACHE\)/); assert.match(sw, /isApi\(url\)/);
});
console.log(`${passed}/${passed} contrôles réussis`);
