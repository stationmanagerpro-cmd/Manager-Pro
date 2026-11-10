'use strict';
// Exerce src/docs.js buildPdf (sections options / image / period) avec un pdfkit SIMULÉ : détecte exceptions et appels incohérents, pas le rendu visuel.
const Module = require('module'), assert = require('assert');
const calls = [];
class FakeDoc {
  constructor() { this.page = { width: 595, height: 842, margins: {} }; this.y = 36; this.x = 36; this.h = {}; }
  on(ev, fn) { this.h[ev] = fn; return this; }
  _rec(n, a) { calls.push([n, ...a]); return this; }
  font() { return this; } fontSize() { return this; } fillColor() { return this; } strokeColor() { return this; } lineWidth() { return this; }
  text(t, x, y, o) { calls.push(['text', String(t)]); if (typeof y === 'number') this.y = y + 10; else this.y += 10; return this; }
  heightOfString() { return 10; } moveDown() { this.y += 5; return this; } moveTo() { return this; } lineTo() { return this; } stroke() { return this; }
  rect(...a) { return this._rec('rect', a); } roundedRect() { return this; } fill() { return this; } fillAndStroke() { return this; }
  openImage(b) { if (!b.length) throw new Error('vide'); return { width: 1000, height: 500 }; }
  image(b, x, y, o) { calls.push(['image', o.width, o.height]); return this; }
  addPage() { this.y = 42; this.h.pageAdded && this.h.pageAdded(); return this; }
  bufferedPageRange() { return { start: 0, count: 1 }; } switchToPage() { return this; }
  end() { this.h.end && this.h.end(); }
}
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'pdfkit') return FakeDoc; if (req === 'exceljs') return {};
  if (/^\.\/(core|files|admin|branding|signature|safe)$/.test(req)) return { pool: {}, getSetting: () => ({}), swallow: () => () => {}, DEFAULTS: {}, load: async () => ({}) };
  return orig.call(this, req, ...r);
};
const docs = require('../src/docs');
(async () => {
  const b = { name: 'STATION TEST', footer: {}, report_colors: {}, currency: 'FCFA' };
  const png = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  await docs.buildPdf({ b, title: 'T', period: 'du 01/11/2026 au 07/11/2026', sections: [
    { type: 'options', title: 'Période', items: [{ label: 'Ce mois', selected: true }, { label: 'Tout', selected: false }, { label: 'Année', selected: false }, { label: 'Trimestre', selected: false }] },
    { type: 'image', title: 'Carte', data: png, caption: 'c' }, { type: 'image', data: 'data:image/png;base64,', caption: 'vide' },
    { type: 'table', head: ['A', 'B'], rows: [], totals: ['T', 1] }] });
  const t = calls.filter(c => c[0] === 'text').map(c => c[1]);
  assert.ok(t.includes('Période : du 01/11/2026 au 07/11/2026'), 'ligne Période absente de l\'en-tête'); console.log('✔ en-tête : ligne « Période »');
  assert.ok(calls.some(c => c[0] === 'image' && c[1] === 523), 'image mise à l\'échelle dans la largeur utile'); console.log('✔ image intégrée à la largeur utile');
  assert.ok(t.includes('Image non disponible.')); console.log('✔ image invalide : repli sans exception');
  assert.ok(t.includes('Ce mois') && t.includes('Tout')); console.log('✔ options : libellés cochés et non cochés écrits');
  assert.ok(calls.filter(c => c[0] === 'rect').length >= 5); console.log('✔ options : cases dessinées');
  assert.ok(t.includes('Aucune donnée sur la période.')); console.log('✔ tableau vide : message explicite');
})().catch(e => { console.error('✖', e); process.exit(1); });
