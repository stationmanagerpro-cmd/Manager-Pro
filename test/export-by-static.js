'use strict';
// « Exporté par : identifiant » dans chaque export tableur (Excel/CSV). Test sans base de données.
const assert = require('assert'), fs = require('fs');
let n = 0; const check = (l, f) => { f(); n++; console.log('✓ ' + l); };
// Dépendances lourdes simulées (le test ne vérifie que le contenu ajouté) : pdfkit inutilisé, exceljs enregistre les lignes.
const Module = require('module'), orig = Module._load, rowsLog = [];
class FakeWb { constructor() { this.worksheets = []; this.xlsx = { writeBuffer: async () => Buffer.from('x') }; }
  addWorksheet() { const ws = { rowCount: 0, views: [], addRow: r => { ws.rowCount++; rowsLog.push(r); return { font: {}, number: ws.rowCount, eachCell() {}, getCell: () => ({}) }; }, getColumn: () => ({}) }; return ws; } }
const fakeWb = new FakeWb(); let created;
const light = new Set(['./core', './files', './admin', './branding', './signature']);
Module._load = function (req, parent, ...a) { if (light.has(req) && parent && /docs\.js$/.test(parent.filename)) return { pool: {}, getSetting: async () => null }; if (req === 'pdfkit') return function () {}; if (req === 'exceljs') return { Workbook: function () { created = new FakeWb(); return created; } }; return orig.call(this, req, parent, ...a); };
const docs = require('../src/docs'); Module._load = orig;
const asUser = (user, fn) => new Promise((res, rej) => docs.generatorMiddleware({ user }, {}, () => Promise.resolve().then(fn).then(res, rej)));
(async () => {
  await asUser({ login: 'kone.ibrahim', full_name: 'Ibrahim Koné' }, async () => {
    check('CSV : ligne « Exporté par : identifiant » en dernier', () => { const c = docs.csv(['A', 'B'], [[1, 2]]); assert.ok(c.trimEnd().endsWith('Exporté par : kone.ibrahim'), c); });
    await docs.buildXlsx({ b: { name: 'Station', currency: 'FCFA' }, title: 'T', sheets: [{ name: 'S', head: ['A'], rows: [['x']] }] });
    check('Excel : ligne « Exporté par : identifiant » et dernier modificateur', () => {
      assert.ok(rowsLog.some(r => r[0] === 'Exporté par : kone.ibrahim'), JSON.stringify(rowsLog)); assert.strictEqual(created.lastModifiedBy, 'kone.ibrahim');
    });
  });
  check('hors requête authentifiée : aucune ligne inventée', () => assert.ok(!docs.csv(['A'], [[1]]).includes('Exporté par')));
  check('exports directs (CSV exports/compta/paie/flotte, Excel plateforme) branchés', () => {
    for (const f of ['exports', 'accounting', 'ops_plus', 'fleet', 'platform']) assert.match(fs.readFileSync(`src/${f}.js`, 'utf8'), /exportedByLine\(\)/, f);
  });
  console.log(`\n${n} contrôles réussis.`);
})().catch(e => { console.error('✘', e); process.exit(1); });
