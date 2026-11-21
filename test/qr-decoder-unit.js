'use strict';
// Décodeur QR de secours (public/qr-decoder.js) : aller-retour avec l'encodeur du projet sur des images synthétiques
// (rotation, bruit, flou, dégradé de lumière, modules inversés réparés par Reed-Solomon) + cohérence des tables avec l'encodeur.
// Ce test NE remplace PAS un essai à la caméra réelle (voir SUIVI_EXECUTION : « Caméra Web » reste à exécuter sur appareil).
const assert = require('assert');
const path = require('path');
const enc = require('../src/qr_encoder');
const dec = require(path.join(__dirname, '..', 'public', 'qr-decoder.js'));
let n = 0, fails = 0;
const check = (name, fn) => { try { fn(); n++; console.log('✓ ' + name); } catch (e) { fails++; console.log('✗ ' + name + '\n   ' + e.message); } };

// PRNG déterministe
let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => { let s = 0; for (let i = 0; i < 6; i++) s += rnd(); return (s - 3) / Math.sqrt(0.5); };

/** Rend un QR en niveaux de gris : échelle `sc` px/module, marge 4 modules, rotation `deg`, placé dans une toile w×h. */
function render(qr, { sc = 6, deg = 0, w = 0, h = 0, noise = 0, blur = false, gradient = false, offx = 0, offy = 0 } = {}) {
  const dim = qr.size + 8, side = Math.ceil(dim * sc * 1.5);
  w = w || side; h = h || side;
  const cx = w / 2 + offx, cy = h / 2 + offy, a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx, dy = y - cy, u = (dx * ca + dy * sa) / sc + dim / 2, v = (-dx * sa + dy * ca) / sc + dim / 2;
    let val = 225;
    const mx = Math.floor(u) - 4, my = Math.floor(v) - 4;
    if (u >= 0 && v >= 0 && u < dim && v < dim) val = (mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.modules[my][mx]) ? 30 : 225;
    if (gradient) val = val * (0.55 + 0.45 * (x / w));
    if (noise) val += gauss() * noise;
    g[y * w + x] = Math.max(0, Math.min(255, val));
  }
  if (!blur) return g;
  const o = new Uint8Array(g);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += g[(y + j) * w + x + i]; o[y * w + x] = s / 9; }
  return o;
}
const TOKEN = 'SMP1:' + 'Zk3_9aXq-LmN0pRsT7uVwYb2cDeFgH1j';   // même forme que les étiquettes réelles (37 octets)
const qr = enc.encode(TOKEN, { ecl: 'M' });
const dg = (g, w, h) => dec.decodeGray(g, w, h);

check('aller-retour sans déformation (échelle 6)', () => { const s = render(qr); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
check('petite image (échelle 3 px/module)', () => { const s = render(qr, { sc: 3 }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
check('grande image (échelle 12 px/module)', () => { const s = render(qr, { sc: 12 }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
for (const deg of [90, 180, 270]) check('rotation de ' + deg + '°', () => { const s = render(qr, { deg }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
for (const deg of [7, -12, 25, 40]) check('rotation oblique de ' + deg + '°', () => { const s = render(qr, { deg, sc: 7 }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
check('bruit gaussien (σ = 25)', () => { const s = render(qr, { noise: 25 }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
check('flou 3×3', () => { const s = render(qr, { blur: true, sc: 5 }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
check('éclairage inégal (dégradé 55 % → 100 %)', () => { const s = render(qr, { gradient: true }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN); });
check('QR décentré dans une image de 640×480', () => { const s = render(qr, { w: 640, h: 480, sc: 5, offx: 120, offy: -60 }); assert.strictEqual(dg(s, 640, 480), TOKEN); });
check('image sans QR → null (pas de faux positif)', () => { const g = new Uint8Array(300 * 300); for (let i = 0; i < g.length; i++) g[i] = 128 + gauss() * 30; assert.strictEqual(dg(g, 300, 300), null); });
check('image blanche → null', () => { assert.strictEqual(dg(new Uint8Array(200 * 200).fill(255), 200, 200), null); });

check('réparation Reed-Solomon : 6 modules de données inversés', () => {
  const copy = { ...qr, modules: qr.modules.map(r => r.slice()) }, fn = enc.functionMask(qr.version); let flipped = 0;
  for (let y = 0; y < qr.size && flipped < 6; y += 5) for (let x = 0; x < qr.size && flipped < 6; x += 7) if (!fn[y][x]) { copy.modules[y][x] = !copy.modules[y][x]; flipped++; }
  assert.strictEqual(flipped, 6);
  const s = render(copy, { sc: 6 }); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), TOKEN);
});
check('trop de modules inversés (60) → refus, jamais un texte faux', () => {
  const copy = { ...qr, modules: qr.modules.map(r => r.slice()) }, fn = enc.functionMask(qr.version); let flipped = 0;
  for (let y = 0; y < qr.size && flipped < 60; y++) for (let x = 0; x < qr.size && flipped < 60; x += 2) if (!fn[y][x]) { copy.modules[y][x] = !copy.modules[y][x]; flipped++; }
  const s = render(copy, { sc: 6 }); const side = Math.sqrt(s.length); const r = dg(s, side, side);
  assert.ok(r === null || r === TOKEN, 'texte erroné retourné : ' + r);
});
check('versions 1 à 9, niveaux L/M/Q/H : aller-retour', () => {
  let tested = 0;
  for (const ecl of ['L', 'M', 'Q', 'H']) for (const len of [4, 20, 45, 80]) {
    const text = Array.from({ length: len }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789'[(i * 7 + len) % 36]).join('');
    const q = enc.encode(text, { ecl }); if (q.version > 10) continue;
    const s = render(q, { sc: 6 }); const side = Math.sqrt(s.length);
    assert.strictEqual(dg(s, side, side), text, 'v' + q.version + ' ' + ecl + ' ' + len + ' octets'); tested++;
  }
  assert.ok(tested >= 14, 'cas testés : ' + tested);
});
check('accents UTF-8', () => { const q = enc.encode('SMP1:é à ü — Pompe n°3', { ecl: 'M' }); const s = render(q); const side = Math.sqrt(s.length); assert.strictEqual(dg(s, side, side), 'SMP1:é à ü — Pompe n°3'); });
check('tables du décodeur identiques à celles de l’encodeur (versions 1 à 10)', () => {
  assert.deepStrictEqual(dec._internals.ECC_PER_BLOCK, enc.ECC_PER_BLOCK); assert.deepStrictEqual(dec._internals.NUM_BLOCKS, enc.NUM_BLOCKS);
  for (let v = 1; v <= 10; v++) { assert.strictEqual(dec._internals.rawDataModules(v), enc.rawDataModules(v)); assert.deepStrictEqual(dec._internals.alignPositions(v), enc.alignPositions(v)); assert.deepStrictEqual(dec._internals.functionMask(v), enc.functionMask(v)); }
});
console.log(`\n${n}/${n + fails} contrôles réussis.`); process.exit(fails ? 1 : 0);
