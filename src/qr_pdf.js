'use strict';
// PDF d'étiquettes de QR Codes (planche A4 groupée ou étiquette individuelle A5).
// Écrivain PDF minimal SANS dépendance : QR dessiné en rectangles vectoriels (net à toute taille d'impression),
// polices Helvetica / Courier standard (WinAnsi). Choix documenté : pdfkit n'est pas installable dans l'environnement de
// vérification ; ce module est donc rendu et relu (pdftoppm + décodage OpenCV) dans test/qr-pdf-static.js et scripts/dev.
const { encode } = require('./qr_encoder');

const A4 = { w: 595.28, h: 841.89 }, A5 = { w: 419.53, h: 595.28 };
const HELV = { 32: 278, 33: 278, 34: 355, 35: 556, 36: 556, 37: 889, 38: 667, 39: 191, 40: 333, 41: 333, 42: 389, 43: 584, 44: 278, 45: 333, 46: 278, 47: 278, 58: 278, 59: 278, 60: 584, 61: 584, 62: 584, 63: 556, 64: 1015,
  65: 667, 66: 667, 67: 722, 68: 722, 69: 667, 70: 611, 71: 778, 72: 722, 73: 278, 74: 500, 75: 667, 76: 556, 77: 833, 78: 722, 79: 778, 80: 667, 81: 778, 82: 722, 83: 667, 84: 611, 85: 722, 86: 667, 87: 944, 88: 667, 89: 667, 90: 611,
  91: 278, 92: 278, 93: 278, 94: 469, 95: 556, 96: 333, 97: 556, 98: 556, 99: 500, 100: 556, 101: 556, 102: 278, 103: 556, 104: 556, 105: 222, 106: 222, 107: 500, 108: 222, 109: 833, 110: 556, 111: 556, 112: 556, 113: 556, 114: 333, 115: 500, 116: 278, 117: 556, 118: 500, 119: 722, 120: 500, 121: 500, 122: 500, 123: 334, 124: 260, 125: 334, 126: 584 };
for (let c = 48; c <= 57; c++) HELV[c] = 556;
const CP1252 = { '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85, '€': 0x80, '•': 0x95 };

/** Texte → chaîne « latin1 » WinAnsi (caractères hors jeu remplacés par ?). */
function winAnsi(s) {
  let o = '';
  for (const ch of String(s == null ? '' : s)) {
    const c = ch.codePointAt(0);
    if (CP1252[ch] != null) o += String.fromCharCode(CP1252[ch]); else if (c >= 32 && c <= 255) o += ch; else o += '?';
  }
  return o;
}
const esc = s => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
function textWidth(s, size, font) { if (font === 'F3') return s.length * 0.6 * size; let w = 0; for (const ch of s) w += (HELV[ch.charCodeAt(0)] || (ch.charCodeAt(0) > 127 ? 556 : 556)); return w / 1000 * size * (font === 'F2' ? 1.06 : 1); }
function fit(s, size, font, maxW) { s = winAnsi(s); if (textWidth(s, size, font) <= maxW) return s; while (s.length > 1 && textWidth(s + '...', size, font) > maxW) s = s.slice(0, -1); return s + '...'; }
const n2 = v => (Math.round(v * 100) / 100).toString();

/** Constructeur d'opérations d'une page (origine PDF en bas à gauche ; on travaille en coordonnées haut-gauche). */
function page(w, h) {
  const ops = [];
  const Y = y => h - y;
  return {
    w, h, ops,
    rect(x, y, rw, rh, { fill = null, stroke = null, lw = 0.6, dash = null } = {}) {
      if (fill != null) ops.push(`${fill} g ${n2(x)} ${n2(Y(y + rh))} ${n2(rw)} ${n2(rh)} re f`);
      if (stroke != null) ops.push(`${dash ? `[${dash}] 0 d ` : ''}${stroke} G ${lw} w ${n2(x)} ${n2(Y(y + rh))} ${n2(rw)} ${n2(rh)} re S${dash ? ' [] 0 d' : ''}`);
    },
    text(str, x, y, size, { font = 'F1', align = 'left', maxW = null, color = '0' } = {}) {
      const s = maxW ? fit(str, size, font, maxW) : winAnsi(str), tw = textWidth(s, size, font);
      const px = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
      ops.push(`BT /${font} ${n2(size)} Tf ${color} g ${n2(px)} ${n2(Y(y))} Td (${esc(s)}) Tj ET`);
    },
    /** QR : modules sombres fusionnés par séquences horizontales, zone de silence blanche de 4 modules incluse dans `size`. */
    qr(code, x, y, size) {
      const dim = code.size + 8, m = size / dim;
      ops.push(`1 g ${n2(x)} ${n2(Y(y + size))} ${n2(size)} ${n2(size)} re f`);
      ops.push('0 g');
      for (let r = 0; r < code.size; r++) {
        let c = 0;
        while (c < code.size) {
          if (!code.modules[r][c]) { c++; continue; }
          let e = c; while (e < code.size && code.modules[r][e]) e++;
          ops.push(`${n2(x + (c + 4) * m)} ${n2(Y(y + (r + 5) * m))} ${n2((e - c) * m)} ${n2(m)} re`);
          c = e;
        }
        if (ops.length && r % 8 === 7) ops.push('f'), ops.push('0 g');
      }
      ops.push('f');
    },
  };
}

/** Assemble les pages en un fichier PDF 1.4. */
function assemble(pages, { title = 'QR Codes', producer = 'Station Manager PRO' } = {}) {
  const objs = [];   // objs[i] = contenu de l'objet i+1
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = null;    // Pages (rempli ensuite)
  objs[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
  const kids = [];
  for (const p of pages) {
    const stream = p.ops.join('\n'), cid = objs.length + 2, pid = objs.length + 1;
    kids.push(pid + ' 0 R');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(p.w)} ${n2(p.h)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${cid} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  const infoId = objs.length + 1;
  objs.push(`<< /Title (${esc(winAnsi(title))}) /Producer (${esc(winAnsi(producer))}) >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Une étiquette dans le cadre (x, y, w, h). label = { payload, stationName, pumpLabel, productName, shortRef } */
function drawLabel(pg, label, x, y, w, h, { guide = true } = {}) {
  if (guide) pg.rect(x, y, w, h, { stroke: '0.6', lw: 0.5, dash: '3 3' });
  const code = encode(label.payload, { ecl: 'M' });
  const qrSize = Math.min(w - 28, h - 112), qx = x + (w - qrSize) / 2;
  pg.text(label.stationName || '', x + w / 2, y + 22, Math.max(10, Math.min(14, w / 20)), { font: 'F2', align: 'center', maxW: w - 20 });
  pg.qr(code, qx, y + 32, qrSize);
  const base = y + 32 + qrSize;
  pg.text(label.pumpLabel || '', x + w / 2, base + 16, Math.max(11, Math.min(17, w / 16)), { font: 'F2', align: 'center', maxW: w - 20 });
  pg.text(label.productName || '', x + w / 2, base + 32, Math.max(10, Math.min(14, w / 20)), { align: 'center', maxW: w - 20 });
  pg.text('Réf. ' + (label.shortRef || ''), x + w / 2, base + 46, 9, { font: 'F3', align: 'center' });
  pg.text('Scanner avec Station Manager PRO', x + w / 2, y + h - 8, 6.5, { align: 'center', color: '0.45' });
}

/** Planche A4 : 2 colonnes × 3 lignes par page. */
function sheetPdf(labels, { stationName = '', generatedAt = new Date() } = {}) {
  const cols = 2, rows = 3, margin = 36, gap = 14, head = 26;
  const lw = (A4.w - 2 * margin - gap * (cols - 1)) / cols, lh = (A4.h - 2 * margin - head - gap * (rows - 1)) / rows;
  const per = cols * rows, total = Math.max(1, Math.ceil(labels.length / per)), pages = [];
  const stamp = new Date(generatedAt).toISOString().slice(0, 10).split('-').reverse().join('/');
  for (let p = 0; p < total; p++) {
    const pg = page(A4.w, A4.h);
    pg.text(`QR Codes des pompes - ${stationName}`, margin, margin - 8, 9, { font: 'F2', maxW: A4.w - 2 * margin - 150 });
    pg.text(`Page ${p + 1}/${total} - ${stamp}`, A4.w - margin, margin - 8, 8, { align: 'right', color: '0.4' });
    labels.slice(p * per, (p + 1) * per).forEach((lab, i) => drawLabel(pg, lab, margin + (i % cols) * (lw + gap), margin + head + Math.floor(i / cols) * (lh + gap), lw, lh));
    pages.push(pg);
  }
  return assemble(pages, { title: `QR Codes - ${stationName}` });
}

/** Étiquette individuelle : une page A5, grand QR. */
function singlePdf(label) {
  const pg = page(A5.w, A5.h);
  drawLabel(pg, label, 24, 24, A5.w - 48, A5.h - 48);
  return assemble([pg], { title: `QR Code - ${label.pumpLabel || ''}` });
}

module.exports = { sheetPdf, singlePdf, assemble, page, winAnsi, textWidth, A4, A5 };
