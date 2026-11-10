// Tests des fonctions pures de l'archivage mensuel : node test/monthly-archive-unit.js
const assert = require('assert'); const A = require('../src/archive_logic');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
ok('mois valides/invalides', () => { assert.ok(A.isMonth('2026-02')); for (const b of ['2026-13', '2026-00', '2026-2', '26-02', "2026-02'", '', null]) assert.ok(!A.isMonth(b), String(b)); });
ok('bornes du mois (bissextile)', () => { assert.deepStrictEqual(A.monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29', year: 2028, month: 2 }); assert.strictEqual(A.monthRange('2025-12').to, '2025-12-31'); });
ok('six dossiers dans l\'ordre du module d\'archivage', () => assert.deepStrictEqual(Object.values(A.FOLDERS).map(x => x.slice(0, 2)), ['01', '02', '03', '04', '05', '06']));
ok('index : empreinte SHA-256 vérifiable et protection formules CSV', () => {
  const data = Buffer.from('abc'); const csv = A.manifestCsv([{ path: 'x.pdf', description: '=HYPERLINK("x")', sources: 'sales', rows: 2, data }]);
  assert.ok(csv.includes('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')); assert.ok(csv.includes("'=HYPERLINK"));
});
ok('nom de fichier assaini', () => assert.strictEqual(A.slug('Shell Maârif / Casa'), 'Shell_Maarif_Casa'));
ok('LISEZ-MOI mentionne limites et dossiers', () => { const t = A.readme({ station: 'S', currency: 'FCFA', month: '2025-08', generatedAt: 'x', by: 'u', folders: [{ folder: '01', label: 'L', files: 3, note: '' }], truncated: ['limite'] }); assert.ok(t.includes('août 2025') && t.includes('limite') && t.includes('INDEX_ARCHIVE.csv')); });
console.log(`\n${n}/${n} tests réussis.`);
