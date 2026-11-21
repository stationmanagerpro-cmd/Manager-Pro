/* Décodeur QR Code (modèle 2, mode octets, versions 1 à 10) sans dépendance.
 * Rôle : lecture de secours quand BarcodeDetector n'existe pas dans le navigateur (Safari, Firefox, anciens Chrome).
 * Usage navigateur : SMPQr.decodeRGBA(imageData.data, w, h) → texte ou null.   Usage Node (tests) : require('./qr-decoder.js').
 * Limites assumées : transformation affine à partir des 3 repères (pas de correction de perspective forte), QR de face ou peu incliné. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.SMPQr = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var ECC_PER_BLOCK = [[-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18], [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26], [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24], [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28]];
  var NUM_BLOCKS = [[-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4], [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5], [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8], [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8]];
  var FMT2ECL = { 1: 0, 0: 1, 3: 2, 2: 3 };   // bits de format → indice L,M,Q,H
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]; }
  function gdiv(a, b) { return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; }

  function rawDataModules(ver) { var r = (16 * ver + 128) * ver + 64; if (ver >= 2) { var n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; } return r; }
  function alignPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2, step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2, res = [6];
    for (var pos = ver * 4 + 10; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }
  function functionMask(ver) {
    var size = ver * 4 + 17, m = [], y, i, j;
    for (y = 0; y < size; y++) m.push(new Array(size).fill(false));
    function set(x, yy) { if (x >= 0 && x < size && yy >= 0 && yy < size) m[yy][x] = true; }
    for (i = 0; i < size; i++) { set(6, i); set(i, 6); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) { for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) set(c[0] + dx, c[1] + dy); });
    var ap = alignPositions(ver), n = ap.length;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy);
    }
    for (i = 0; i < 9; i++) { set(8, i); set(i, 8); }
    for (i = 0; i < 8; i++) { set(size - 1 - i, 8); set(8, size - 1 - i); }
    if (ver >= 7) for (i = 0; i < 18; i++) { var a = size - 11 + (i % 3), b = Math.floor(i / 3); set(a, b); set(b, a); }
    return m;
  }
  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0; case 1: return y % 2 === 0; case 2: return x % 3 === 0; case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0; default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
    }
  }
  function formatCode(fmtBits, mask) { var d = (fmtBits << 3) | mask, rem = d; for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537); return ((d << 10) | rem) ^ 0x5412; }
  var FORMATS = (function () { var l = []; for (var f = 0; f < 4; f++) for (var m = 0; m < 8; m++) l.push({ code: formatCode(f, m), fmt: f, mask: m }); return l; })();
  function popcount(v) { var c = 0; while (v) { c += v & 1; v >>>= 1; } return c; }

  /* ---------- Binarisation adaptative (moyenne locale par image intégrale) ---------- */
  function binarize(gray, w, h) {
    var integral = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += gray[y * w + x]; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + row; } }
    var s = (((Math.min(w, h) / 4) | 0) | 1), half = s >> 1, out = new Uint8Array(w * h);
    for (y = 0; y < h; y++) {
      var y0 = Math.max(0, y - half), y1 = Math.min(h, y + half + 1);
      for (x = 0; x < w; x++) {
        var x0 = Math.max(0, x - half), x1 = Math.min(w, x + half + 1);
        var sum = integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        var mean = sum / ((x1 - x0) * (y1 - y0));
        out[y * w + x] = gray[y * w + x] < mean * 0.9 ? 1 : 0;
      }
    }
    return out;
  }

  /* ---------- Repères de position (motif 1:1:3:1:1) ---------- */
  function line5(bin, w, h, x, y, dx, dy) {
    var c = [0, 0, 0, 0, 0], px = x, py = y;
    function inb() { return px >= 0 && py >= 0 && px < w && py < h; }
    while (inb() && bin[py * w + px] === 1) { c[2]++; px -= dx; py -= dy; }
    if (!inb()) return null;
    var startPx = px + dx, startPy = py + dy;
    while (inb() && bin[py * w + px] === 0) { c[1]++; px -= dx; py -= dy; }
    if (!inb()) return null;
    while (inb() && bin[py * w + px] === 1) { c[0]++; px -= dx; py -= dy; }
    px = x + dx; py = y + dy;
    while (inb() && bin[py * w + px] === 1) { c[2]++; px += dx; py += dy; }
    if (!inb()) return null;
    var endPx = px - dx, endPy = py - dy;
    while (inb() && bin[py * w + px] === 0) { c[3]++; px += dx; py += dy; }
    if (!inb()) return null;
    while (inb() && bin[py * w + px] === 1) { c[4]++; px += dx; py += dy; }
    var total = c[0] + c[1] + c[2] + c[3] + c[4], mod = total / 7, v = mod * 0.6;
    if (Math.abs(c[0] - mod) > v || Math.abs(c[1] - mod) > v || Math.abs(c[2] - 3 * mod) > 3 * v || Math.abs(c[3] - mod) > v || Math.abs(c[4] - mod) > v) return null;
    return { mod: mod, cx: (startPx + endPx + 1) / 2, cy: (startPy + endPy + 1) / 2 };
  }
  function findFinders(bin, w, h) {
    var cands = [];
    for (var y = 0; y < h; y += 2) {
      var runs = [], cur = bin[y * w], len = 0, x;
      for (x = 0; x < w; x++) { if (bin[y * w + x] === cur) len++; else { runs.push({ v: cur, len: len, start: x - len }); cur = bin[y * w + x]; len = 1; } }
      runs.push({ v: cur, len: len, start: w - len });
      for (var i = 0; i + 4 < runs.length; i++) {
        if (runs[i].v !== 1) continue;
        var l = [runs[i].len, runs[i + 1].len, runs[i + 2].len, runs[i + 3].len, runs[i + 4].len], total = l[0] + l[1] + l[2] + l[3] + l[4], mod = total / 7, v = mod * 0.6;
        if (total < 7 || Math.abs(l[0] - mod) > v || Math.abs(l[1] - mod) > v || Math.abs(l[2] - 3 * mod) > 3 * v || Math.abs(l[3] - mod) > v || Math.abs(l[4] - mod) > v) continue;
        var cx = Math.floor(runs[i + 2].start + runs[i + 2].len / 2);
        var vert = line5(bin, w, h, cx, y, 0, 1); if (!vert) continue;
        var hor = line5(bin, w, h, Math.floor(vert.cx), Math.floor(vert.cy), 1, 0); if (!hor) continue;
        var m = (vert.mod + hor.mod) / 2, fx = hor.cx, fy = vert.cy, merged = false;
        for (var k = 0; k < cands.length; k++) {
          var c = cands[k];
          if (Math.abs(c.x - fx) < m * 2 && Math.abs(c.y - fy) < m * 2 && Math.abs(c.m - m) < m * 0.5) { c.x = (c.x * c.n + fx) / (c.n + 1); c.y = (c.y * c.n + fy) / (c.n + 1); c.m = (c.m * c.n + m) / (c.n + 1); c.n++; merged = true; break; }
        }
        if (!merged) cands.push({ x: fx, y: fy, m: m, n: 1 });
      }
    }
    return cands.filter(function (c) { return c.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
  }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function bestTriples(c) {
    var out = [];
    for (var i = 0; i < c.length; i++) for (var j = i + 1; j < c.length; j++) for (var k = j + 1; k < c.length; k++) {
      var p = [c[i], c[j], c[k]], d = [dist(p[1], p[2]), dist(p[0], p[2]), dist(p[0], p[1])];   // d[n] = côté opposé au point n
      var idx = [0, 1, 2].sort(function (a, b) { return d[a] - d[b]; }), a = d[idx[0]], b = d[idx[1]], hyp = d[idx[2]];
      var ms = (p[0].m + p[1].m + p[2].m) / 3;
      if (Math.abs(p[0].m - ms) > ms * 0.5 || Math.abs(p[1].m - ms) > ms * 0.5 || Math.abs(p[2].m - ms) > ms * 0.5) continue;
      var err = Math.abs(a - b) / hyp + Math.abs(hyp - Math.SQRT2 * (a + b) / 2) / hyp;
      if (err > 0.45) continue;
      var tl = p[idx[2]], o = [p[idx[0]], p[idx[1]]];   // le point opposé à l'hypoténuse est le coin haut-gauche
      var cross = (o[0].x - tl.x) * (o[1].y - tl.y) - (o[0].y - tl.y) * (o[1].x - tl.x);
      out.push({ err: err - Math.min(p[0].n, p[1].n, p[2].n) * 0.001, tl: tl, tr: cross > 0 ? o[0] : o[1], bl: cross > 0 ? o[1] : o[0], m: ms });
    }
    return out.sort(function (x, y) { return x.err - y.err; });
  }

  /* ---------- Reed-Solomon ---------- */
  function rsCorrect(cw, nsym) {   // cw : tableau (données puis correction), modifié sur place ; retourne false si irréparable
    var n = cw.length, S = new Array(nsym).fill(0), anyErr = false, i, j;
    for (j = 0; j < nsym; j++) { var s = 0; for (i = 0; i < n; i++) s = gmul(s, EXP[j]) ^ cw[i]; S[j] = s; if (s) anyErr = true; }
    if (!anyErr) return true;
    var C = [1], B = [1], L = 0, m = 1, b = 1;
    for (var r = 0; r < nsym; r++) {
      var d = S[r]; for (i = 1; i <= L; i++) if (C[i] !== undefined) d ^= gmul(C[i], S[r - i]);
      if (d === 0) { m++; continue; }
      var T = C.slice(), coef = gdiv(d, b);
      while (C.length < B.length + m) C.push(0);
      for (i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
      if (2 * L <= r) { L = r + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    if (L * 2 > nsym) return false;
    var positions = [];
    for (var p = 0; p < n; p++) {   // p = puissance de x ; racine si Λ(α^-p) = 0
      var x = EXP[(255 - (p % 255)) % 255], v = 0, pw = 1;
      for (i = 0; i <= L; i++) { v ^= gmul(C[i] || 0, pw); pw = gmul(pw, x); }
      if (v === 0) positions.push(p);
    }
    if (positions.length !== L) return false;
    var omega = new Array(nsym).fill(0);   // Ω = S·Λ mod x^nsym
    for (i = 0; i < nsym; i++) for (j = 0; j <= L && j <= i; j++) omega[i] ^= gmul(C[j] || 0, S[i - j]);
    for (var q = 0; q < positions.length; q++) {
      var pos = positions[q], X = EXP[pos % 255], Xi = EXP[(255 - (pos % 255)) % 255], num = 0, pw2 = 1;
      for (i = 0; i < nsym; i++) { num ^= gmul(omega[i], pw2); pw2 = gmul(pw2, Xi); }
      var den = 0, xi2 = gmul(Xi, Xi); pw2 = 1;   // Λ'(x) = Σ (i impair) C[i]·x^(i-1)
      for (i = 1; i <= L; i += 2) { den ^= gmul(C[i] || 0, pw2); pw2 = gmul(pw2, xi2); }
      if (den === 0) return false;
      cw[n - 1 - pos] ^= gmul(X, gdiv(num, den));
    }
    for (j = 0; j < nsym; j++) { var s2 = 0; for (i = 0; i < n; i++) s2 = gmul(s2, EXP[j]) ^ cw[i]; if (s2) return false; }
    return true;
  }

  /* ---------- Lecture d'une matrice de modules ---------- */
  function decodeMatrix(mod, ver) {
    var size = ver * 4 + 17, x, y, i;
    function bit(xx, yy) { return mod[yy][xx] ? 1 : 0; }
    var f1 = 0, f2 = 0;
    for (i = 0; i <= 5; i++) f1 |= bit(8, i) << i;
    f1 |= bit(8, 7) << 6; f1 |= bit(8, 8) << 7; f1 |= bit(7, 8) << 8;
    for (i = 9; i < 15; i++) f1 |= bit(14 - i, 8) << i;
    for (i = 0; i < 8; i++) f2 |= bit(size - 1 - i, 8) << i;
    for (i = 8; i < 15; i++) f2 |= bit(8, size - 15 + i) << i;
    var best = null, bd = 99;
    FORMATS.forEach(function (F) { var d = Math.min(popcount(F.code ^ f1), popcount(F.code ^ f2)); if (d < bd) { bd = d; best = F; } });
    if (!best || bd > 3) return null;
    var ecl = FMT2ECL[best.fmt], mask = best.mask, fn = functionMask(ver), bits = [];
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        x = right - j; var up = ((right + 1) & 2) === 0; y = up ? size - 1 - vert : vert;
        if (!fn[y][x]) bits.push(bit(x, y) ^ (maskBit(mask, x, y) ? 1 : 0));
      }
    }
    var cw = []; for (i = 0; i + 8 <= bits.length; i += 8) { var v = 0; for (j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; cw.push(v); }
    var nb = NUM_BLOCKS[ecl][ver], eccLen = ECC_PER_BLOCK[ecl][ver], rawCw = Math.floor(rawDataModules(ver) / 8);
    if (cw.length < rawCw) return null;
    var shortCount = nb - (rawCw % nb), shortLen = Math.floor(rawCw / nb), blocks = [], dl = [];
    for (i = 0; i < nb; i++) { dl.push(shortLen - eccLen + (i < shortCount ? 0 : 1)); blocks.push(new Array(dl[i] + eccLen)); }
    var idx = 0, maxData = Math.max.apply(null, dl);
    for (i = 0; i < maxData; i++) for (var b = 0; b < nb; b++) if (i < dl[b]) blocks[b][i] = cw[idx++];
    for (i = 0; i < eccLen; i++) for (b = 0; b < nb; b++) blocks[b][dl[b] + i] = cw[idx++];
    var data = [];
    for (b = 0; b < nb; b++) { if (!rsCorrect(blocks[b], eccLen)) return null; for (i = 0; i < dl[b]; i++) data.push(blocks[b][i]); }
    var dbits = []; data.forEach(function (byte) { for (var k = 7; k >= 0; k--) dbits.push((byte >> k) & 1); });
    var pos = 0; function take(n) { var v = 0; for (var k = 0; k < n; k++) v = (v << 1) | (dbits[pos++] || 0); return v; }
    var out = [];
    while (pos + 4 <= dbits.length) {
      var mode = take(4);
      if (mode === 0) break;
      if (mode !== 4) return null;   // seul le mode octets est produit par l'application
      var count = take(ver < 10 ? 8 : 16); if (pos + count * 8 > dbits.length) return null;
      for (i = 0; i < count; i++) out.push(take(8));
    }
    try { return (typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(out)) : Buffer.from(out).toString('utf8')); } catch (e) { return null; }
  }

  function sample(bin, w, h, px, py) { var x = Math.floor(px), y = Math.floor(py); return x >= 0 && y >= 0 && x < w && y < h ? bin[y * w + x] : 0; }

  /** Décode à partir d'une image en niveaux de gris (Uint8Array/Uint8ClampedArray w*h). Retourne le texte ou null. */
  function decodeGray(gray, w, h) {
    var bin = binarize(gray, w, h), finders = findFinders(bin, w, h);
    if (finders.length < 3) return null;
    var triples = bestTriples(finders);
    for (var t = 0; t < Math.min(triples.length, 4); t++) {
      var T = triples[t], span = dist(T.tl, T.tr) / T.m + 7, est = Math.round((span - 17) / 4);
      var tryVers = [est, est - 1, est + 1].filter(function (v, i, a) { return v >= 1 && v <= 10 && a.indexOf(v) === i; });
      for (var vi = 0; vi < tryVers.length; vi++) {
        var ver = tryVers[vi], dim = ver * 4 + 17, ux = (T.tr.x - T.tl.x) / (dim - 7), uy = (T.tr.y - T.tl.y) / (dim - 7), vx = (T.bl.x - T.tl.x) / (dim - 7), vy = (T.bl.y - T.tl.y) / (dim - 7);
        var mat = [];
        for (var j = 0; j < dim; j++) {
          var row = [];
          for (var i = 0; i < dim; i++) {
            var cx = T.tl.x + (i - 3) * ux + (j - 3) * vx, cy = T.tl.y + (i - 3) * uy + (j - 3) * vy, dark = 0;
            for (var s = 0; s < 5; s++) { var ox = s === 0 ? 0 : (s % 2 ? 0.25 : -0.25), oy = s === 0 ? 0 : (s < 3 ? 0.25 : -0.25); dark += sample(bin, w, h, cx + ox * (ux + vx), cy + oy * (uy + vy)); }
            row.push(dark >= 3);
          }
          mat.push(row);
        }
        var txt = decodeMatrix(mat, ver);
        if (txt !== null) return txt;
      }
    }
    return null;
  }
  function decodeRGBA(rgba, w, h) {
    var gray = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * 77 + rgba[p + 1] * 151 + rgba[p + 2] * 28) >> 8;
    return decodeGray(gray, w, h);
  }
  return { decodeGray: decodeGray, decodeRGBA: decodeRGBA, _internals: { functionMask: functionMask, alignPositions: alignPositions, rawDataModules: rawDataModules, ECC_PER_BLOCK: ECC_PER_BLOCK, NUM_BLOCKS: NUM_BLOCKS, rsCorrect: rsCorrect, decodeMatrix: decodeMatrix } };
});
