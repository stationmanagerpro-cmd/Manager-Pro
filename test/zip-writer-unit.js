// Tests du générateur ZIP (relecture indépendante via zlib) : node test/zip-writer-unit.js
const assert = require('assert'), zlib = require('zlib');
const { createZip, crc32, safeName } = require('../src/zip_writer');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✔', name); };
function read(zip) {     // lecteur minimal par le répertoire central
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), cnt = zip.readUInt16LE(eocd + 10); let p = zip.readUInt32LE(eocd + 16); const out = {};
  for (let i = 0; i < cnt; i++) {
    const meth = zip.readUInt16LE(p + 10), crc = zip.readUInt32LE(p + 16), cs = zip.readUInt32LE(p + 20), us = zip.readUInt32LE(p + 24), nl = zip.readUInt16LE(p + 28), off = zip.readUInt32LE(p + 42);
    const name = zip.slice(p + 46, p + 46 + nl).toString('utf8'), lnl = zip.readUInt16LE(off + 26), data = zip.slice(off + 30 + lnl, off + 30 + lnl + cs);
    const raw = meth === 8 ? zlib.inflateRawSync(data) : data; assert.strictEqual(raw.length, us); assert.strictEqual(crc32(raw), crc); out[name] = raw; p += 46 + nl;
  } return out;
}
ok('aller-retour : contenus, CRC, UTF-8', () => {
  const big = Buffer.from('ligne;é;€\n'.repeat(2000)); const z = read(createZip([{ name: 'a/b é.csv', data: big }, { name: 'v.txt', data: '' }, { name: 'x.txt', data: 'bonjour' }]));
  assert.ok(z['a/b é.csv'].equals(big)); assert.strictEqual(z['x.txt'].toString(), 'bonjour'); assert.strictEqual(z['v.txt'].length, 0);
});
ok('CRC-32 de référence', () => assert.strictEqual(crc32(Buffer.from('123456789')), 0xCBF43926));
ok('anti zip-slip : « .. », « / » initial et « \\ » neutralisés', () => {
  assert.strictEqual(safeName('../../etc/passwd'), 'etc/passwd'); assert.strictEqual(safeName('/abs/x'), 'abs/x'); assert.strictEqual(safeName('..\\..\\w.txt'), 'w.txt'); assert.strictEqual(safeName('..'), 'fichier');
});
ok('doublons renommés sans écrasement', () => { const z = read(createZip([{ name: 'a.txt', data: '1' }, { name: 'A.TXT', data: '2' }])); assert.deepStrictEqual(Object.keys(z).sort(), ['A_2.TXT', 'a.txt']); });
console.log(`\n${n}/${n} tests réussis.`);
