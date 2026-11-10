// Écrivain ZIP minimal, sans dépendance (zlib natif + CRC-32), utilisé par l'archivage mensuel.
// Format : entrées compressées (deflate) ou stockées, noms UTF-8 (bit 11), sans ZIP64 (archive < 4 Go, < 65 535 fichiers).
// Fonctions pures : testées sans base (test/zip-writer-unit.js).
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Date → champs DOS (heure locale du serveur). */
function dosDateTime(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

/** Nom d'entrée sûr : séparateurs « / », jamais de « .. », de lecteur ni de « / » initial (anti zip-slip). */
function safeName(name) {
  const parts = String(name || '').replace(/\\/g, '/').split('/')
    .map(p => p.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim())
    .filter(p => p && p !== '.' && p !== '..');
  return parts.join('/') || 'fichier';
}

/**
 * @param {{name:string, data:Buffer|string, date?:Date}[]} entries
 * @returns {Buffer}
 */
function createZip(entries) {
  if (entries.length > 65535) throw new Error('Trop de fichiers pour une archive ZIP simple');
  const seen = new Set();
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    let name = safeName(e.name);
    if (seen.has(name.toLowerCase())) {            // doublon : suffixe numérique avant l'extension
      const dot = name.lastIndexOf('.');
      const base = dot > name.lastIndexOf('/') ? name.slice(0, dot) : name, ext = dot > name.lastIndexOf('/') ? name.slice(dot) : '';
      let i = 2; while (seen.has(`${base}_${i}${ext}`.toLowerCase())) i++;
      name = `${base}_${i}${ext}`;
    }
    seen.add(name.toLowerCase());
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data ?? ''), 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 6 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const { time, date } = dosDateTime(e.date instanceof Date ? e.date : new Date());
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6);
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8); lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += lh.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = { createZip, crc32, safeName };
