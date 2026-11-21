'use strict';
// Encodeur QR Code (modèle 2, mode octets, versions 1 à 10, niveaux L/M/Q/H) sans dépendance.
// Utilisé pour les étiquettes de pompes (PDF) : aucune bibliothèque QR n'est installée dans le projet.
// Algorithme conforme à ISO/IEC 18004 ; validé par décodage indépendant (voir scripts/dev/verify-qr-opencv.py).

const ECL = { L: { ord: 0, fmt: 1 }, M: { ord: 1, fmt: 0 }, Q: { ord: 2, fmt: 3 }, H: { ord: 3, fmt: 2 } };
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];
const MAX_VERSION = 10;

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}
const dataCodewords = (ver, ecl) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ECL[ecl].ord][ver] * NUM_BLOCKS[ECL[ecl].ord][ver];

function alignPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = ver * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

// ---- Corps de Galois GF(256), polynôme 0x11D ----
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); }
    g = next;
  }
  return g;   // g[0] = 1 (coefficient de plus haut degré)
}
function rsRemainder(data, gen) {
  const deg = gen.length - 1, rem = new Array(deg).fill(0);
  for (const b of data) {
    const factor = b ^ rem.shift(); rem.push(0);
    for (let i = 0; i < deg; i++) rem[i] ^= gmul(gen[i + 1], factor);
  }
  return rem;
}

/** Matrice des modules « fonction » (motifs, synchronisation, formats) pour une version : true = non réservé aux données. */
function functionMask(ver) {
  const size = ver * 4 + 17, m = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y) => { if (x >= 0 && x < size && y >= 0 && y < size) m[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i); set(i, 6); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
  const ap = alignPositions(ver), n = ap.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy);
  }
  for (let i = 0; i < 9; i++) { set(8, i); set(i, 8); }
  for (let i = 0; i < 8; i++) { set(size - 1 - i, 8); set(8, size - 1 - i); }
  if (ver >= 7) for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b); set(b, a); }
  return m;
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

function penalty(mod) {
  const size = mod.length; let p = 0, dark = 0;
  const line = get => {   // une ligne ou colonne : séries (N1) et motif 1:1:3:1:1 (N3)
    let run = 1, s = '';
    for (let i = 0; i < size; i++) {
      const v = get(i); s += v ? '1' : '0';
      if (i > 0 && v === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; } else run = 1;
    }
    for (let i = 0; i + 11 <= size; i++) { const w = s.substr(i, 11); if (w === '10111010000' || w === '00001011101') p += 40; }
  };
  for (let y = 0; y < size; y++) { line(i => mod[y][i]); line(i => mod[i][y]); }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (mod[y][x]) dark++;
    if (x < size - 1 && y < size - 1 && mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3;
  }
  const total = size * size;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/** Encode un texte (UTF-8) en QR Code. Retourne { version, size, mask, ecl, modules } (modules[y][x] === true : module sombre). */
function encode(text, { ecl = 'M', minVersion = 1 } = {}) {
  if (!ECL[ecl]) throw new Error('Niveau de correction inconnu : ' + ecl);
  const bytes = Buffer.from(String(text), 'utf8');
  let ver = Math.max(1, minVersion);
  for (;; ver++) {
    if (ver > MAX_VERSION) throw new Error('Texte trop long pour un QR Code version ≤ ' + MAX_VERSION + ' (' + bytes.length + ' octets)');
    const cap = dataCodewords(ver, ecl) * 8, need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (need <= cap) break;
  }
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  const capBits = dataCodewords(ver, ecl) * 8;
  put(0, Math.min(4, capBits - bits.length)); while (bits.length % 8) bits.push(0);
  for (let pad = 0xEC; bits.length < capBits; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }

  // Blocs, correction d'erreur Reed-Solomon, entrelacement
  const nb = NUM_BLOCKS[ECL[ecl].ord][ver], eccLen = ECC_PER_BLOCK[ECL[ecl].ord][ver];
  const rawCw = Math.floor(rawDataModules(ver) / 8), shortCount = nb - (rawCw % nb), shortLen = Math.floor(rawCw / nb);
  const gen = rsGenerator(eccLen), blocks = []; let k = 0;
  for (let i = 0; i < nb; i++) {
    const d = data.slice(k, k + shortLen - eccLen + (i < shortCount ? 0 : 1)); k += d.length;
    blocks.push(d.concat(rsRemainder(d, gen)));
    blocks[i].dataLen = d.length;
  }
  // Entrelacement explicite : d'abord les octets de données, puis ceux de correction
  const inter = [], maxData = Math.max(...blocks.map(b => b.dataLen));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dataLen) inter.push(b[i]);
  for (let i = 0; i < eccLen; i++) for (const b of blocks) inter.push(b[b.dataLen + i]);

  // Matrice
  const size = ver * 4 + 17, fn = functionMask(ver);
  const mod = Array.from({ length: size }, () => new Array(size).fill(false));
  const setF = (x, y, dark) => { if (x >= 0 && x < size && y >= 0 && y < size) mod[y][x] = dark; };
  for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); setF(cx + dx, cy + dy, d !== 2 && d !== 4); }
  const ap = alignPositions(ver), n = ap.length;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const drawFormat = mask => {
    const d = (ECL[ecl].fmt << 3) | mask; let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bitsF = ((d << 10) | rem) ^ 0x5412, bit = i => ((bitsF >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setF(8, i, bit(i));
    setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
    for (let i = 9; i < 15; i++) setF(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setF(8, size - 15 + i, bit(i));
    setF(8, size - 8, true);
  };
  if (ver >= 7) {
    let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const vb = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) { const c = ((vb >>> i) & 1) !== 0, a = size - 11 + (i % 3), b = Math.floor(i / 3); setF(a, b, c); setF(b, a, c); }
  }
  drawFormat(0);
  // Placement en zigzag
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
      if (!fn[y][x] && bi < inter.length * 8) { mod[y][x] = ((inter[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
    }
  }
  const applyMask = mask => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskBit(mask, x, y)) mod[y][x] = !mod[y][x]; };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const p = penalty(mod); if (p < bestP) { bestP = p; best = m; } applyMask(m); }
  applyMask(best); drawFormat(best);
  return { version: ver, size, mask: best, ecl, modules: mod };
}

/** Chemin SVG (unités = modules) de tous les modules sombres, avec marge (quiet zone) de `border` modules. */
function toSvg(qr, { border = 4, dark = '#000', light = '#fff' } = {}) {
  const parts = [];
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) parts.push(`M${x + border},${y + border}h1v1h-1z`);
  const dim = qr.size + border * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${light}"/><path d="${parts.join('')}" fill="${dark}"/></svg>`;
}

module.exports = { encode, toSvg, functionMask, maskBit, alignPositions, dataCodewords, rawDataModules, ECL, ECC_PER_BLOCK, NUM_BLOCKS, MAX_VERSION, EXP, LOG, gmul, rsGenerator, rsRemainder };
