const assert = require('assert');
const csvCell = require('../src/csv_safe');
const cases = [
  ['=HYPERLINK("https://evil.example")', `"'=HYPERLINK(""https://evil.example"")"`],
  ['+SUM(1,1)', "'+SUM(1,1)"],
  ['-2+3', "'-2+3"],
  ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
  ['  =1+1', "'  =1+1"],
  ['normal;texte', '"normal;texte"'],
  ['a"b', '"a""b"'],
  [125, '125'],
  [-125, '-125'],
  [null, '']
];
for (const [input, expected] of cases) assert.strictEqual(csvCell(input), expected, `Entrée: ${String(input)}`);
console.log(`OK — ${cases.length} cas CSV vérifiés.`);
