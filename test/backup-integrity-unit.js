// Tests unitaires A1 : validation réelle d'un dump gzip/SQL sans connexion PostgreSQL.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { verifyDump } = require('../src/backup');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smp-backup-integrity-'));
  try {
    const valid = path.join(dir, 'valid.sql.gz');
    const sql = '-- PostgreSQL database dump\n' + '-- test fixture only; no real database\n' + 'SELECT 1;\n'.repeat(30);
    fs.writeFileSync(valid, zlib.gzipSync(Buffer.from(sql)));
    const result = await verifyDump(valid);
    assert(result.compressedSize > 50, 'taille compressée vérifiée');
    assert(result.uncompressedSize >= 100, 'taille décompressée vérifiée');

    const truncated = path.join(dir, 'truncated.sql.gz');
    const bytes = fs.readFileSync(valid);
    fs.writeFileSync(truncated, bytes.subarray(0, Math.max(10, bytes.length - 5)));
    await assert.rejects(() => verifyDump(truncated), /Vérification de sauvegarde échouée/);

    const wrongContent = path.join(dir, 'wrong-content.sql.gz');
    fs.writeFileSync(wrongContent, zlib.gzipSync(require('crypto').randomBytes(500)));
    await assert.rejects(() => verifyDump(wrongContent), /signature de dump SQL PostgreSQL absente/);
    console.log('A1 backup-integrity-unit: 3 scénarios réussis (valide, tronqué, contenu non-SQL).');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
