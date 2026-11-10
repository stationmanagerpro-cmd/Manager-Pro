'use strict';
// CORR-032 (audit B5) : les requêtes dont l'échec était ignoré en silence passent par swallow() (repli identique + journal).
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const dir = path.resolve(__dirname, '../src');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'safe.js');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✓ ' + l); };
check('plus aucun .catch(() => ({ rows: … })) silencieux dans src/', () => {
  const bad = files.filter(f => /\.catch\(\(\)\s*=>\s*\(\{\s*rows:/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(bad, []);
});
check('tout fichier qui appelle swallow() le déclare', () => {
  const bad = files.filter(f => { const s = fs.readFileSync(path.join(dir, f), 'utf8'); return /\bswallow\(/.test(s) && !/\{[^}]*\bswallow\b[^}]*\}\s*=\s*require\('\.\/safe'\)/.test(s); });
  assert.deepStrictEqual(bad, []);
});
check('safe.js renvoie la valeur de repli et journalise', () => {
  const { swallow } = require('../src/safe'); const w = console.warn; let logged = 0; console.warn = () => { logged++; };
  try { assert.deepStrictEqual(swallow('t:unique-' + Date.now(), { rows: [] })(new Error('x')), { rows: [] }); } finally { console.warn = w; }
  assert.strictEqual(logged, 1);
});
check('tout fichier qui appelle ignored() le déclare ; les 9 try/catch métier ne sont plus vides', () => {
  const bad = files.filter(f => { const s = fs.readFileSync(path.join(dir, f), 'utf8'); return /\bignored\(/.test(s) && !/\{[^}]*\bignored\b[^}]*\}\s*=\s*require\('\.\/safe'\)/.test(s); });
  assert.deepStrictEqual(bad, []);
  const need = { 'hr_v2.js': 2, 'messaging.js': 2, 'ops_plus.js': 2, 'fiscal.js': 2, 'platform.js': 1 };
  for (const [f, k] of Object.entries(need)) assert.ok((fs.readFileSync(path.join(dir, f), 'utf8').match(/ignored\('/g) || []).length >= k, f);
});
console.log(`\n${n}/${n} contrôles réussis.`);
