// Rendu du composant Agg sans navigateur (document factice) : tuiles, sources, PDF, devise mixte.
// node test/aggregates-front-static.js
const assert = require('assert'), vm = require('vm'), fs = require('fs');
const ctx = { document: { createElement: () => ({}), head: { appendChild() {} } }, console };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../public/ext-aggregates.js', 'utf8'), ctx);
const A = ctx.Agg;
const data = { period: { from: '2026-11-01', to: '2026-11-03', days: 3, prev_from: '2026-10-29', prev_to: '2026-10-31' }, currencies: ['FCFA'], mixed_currency: false, hidden: { ops: 1 },
  catalog: [
    { key: 'ca_ttc', group: 'Ventes et encaissements', label: 'CA TTC de la période', unit: 'money', flow: true, good: 'up', formula: 'Boutique + carburant', sources: ['sales.total', 'meter_readings.amount'] },
    { key: 'cancel_rate_pct', group: 'Ventes et encaissements', label: "Taux d'annulation", unit: 'pct', flow: true, good: 'down', formula: 'x', sources: ['sales.id'] },
    { key: 'payables', group: 'Achats et fournisseurs', label: 'Dettes <b>', unit: 'money', flow: false, good: 'down', formula: 'y', sources: ['suppliers.balance_due'] }],
  total: { ca_ttc: { value: 150000, previous: 100000, variation: { kind: 'pct', value: 50 } }, cancel_rate_pct: { value: 9.1, previous: 5, variation: { kind: 'pts', value: 4.1 } }, payables: { value: null } } };
const html = A.render(data, { title: 'T' });
assert.ok(html.includes('sales.total') && html.includes('meter_readings.amount') && html.includes('Source'), 'sources visibles');
assert.ok(/150\s?000 FCFA/.test(html.replace(/\u202f|\u00a0/g, ' ')), 'montant formaté');
assert.ok(html.includes('agg-v g') && html.includes('agg-v b'), 'ton : hausse du CA favorable, hausse du taux d’annulation défavorable');
assert.ok(html.includes('n/d') && !html.includes('<b>Dettes'), 'valeur nulle = n/d ; libellés échappés');
const pdf = A.pdfSections(data, 'Agrégats');
assert.strictEqual(pdf.length, 3); assert.strictEqual(JSON.stringify(pdf[0].head), JSON.stringify(['Indicateur', 'Valeur', 'Variation', 'Source']));
assert.ok(pdf[0].rows[0][3].includes('sales.total'), 'la source figure dans le PDF');
assert.ok(A.render({ ...data, mixed_currency: true, currencies: ['FCFA', 'MAD'] }).includes('sans conversion'));
assert.ok(A.tiles([{ label: 'a', value: '1', sources: ['t.c'], formula: 'f' }]).includes('t.c'));
assert.ok(A.itemsTable([{ label: 'a', value: '1', sources: ['t.c'], formula: 'f' }]).includes('<td>f — t.c</td>'));
assert.ok(A.chips({ ca_ttc: 5 }, data.catalog, ['ca_ttc', 'inconnu'], 'FCFA').includes('title='));
console.log('✔ composant Agg : tuiles + sources, tons, n/d, échappement, PDF, devise mixte, puces\n\n1/1 tests réussis.');
