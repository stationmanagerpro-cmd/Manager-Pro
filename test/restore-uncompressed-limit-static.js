const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync('src/maintenance.js', 'utf8');
let n = 0;
function check(label, fn) { fn(); n++; console.log('✔ ' + label); }
check('La taille décompressée est limitée et configurable', () => assert(src.includes('RESTORE_MAX_UNCOMPRESSED_MB') && src.includes('MAX_RESTORE_UNCOMPRESSED_BYTES')));
check('La limite de configuration est bornée entre 1 et 4096 Mo', () => assert(src.includes('Math.min(4096') && src.includes('Math.max(1')));
check('La validation du dump utilise un flux de décompression', () => assert(src.includes('zlib.createGunzip()') && src.includes("gunzip.on('data'")));
check('La validation compte les octets décompressés avant la restauration', () => assert(src.includes('bytes += chunk.length') && src.includes('bytes > MAX_RESTORE_UNCOMPRESSED_BYTES')));
check('Le fichier gzip est validé avant la sauvegarde de sécurité et la restauration', () => assert(src.indexOf('await validateGzipFile(tmp)') < src.indexOf("backup.runBackup('pre-restore')")));
check('Le dump n’est plus décompressé entièrement en mémoire avec gunzip(buffer)', () => assert(!src.includes('zlib.gunzip(req.body')));
check('Le format gzip et la taille minimale restent contrôlés', () => assert(src.includes('req.body[0] !== 0x1f') && src.includes('bytes < 100')));
console.log(`\n${n}/${n} contrôles statiques réussis.`);
