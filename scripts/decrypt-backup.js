#!/usr/bin/env node
// Déchiffre une sauvegarde reçue par e-mail (fichier .sql.gz.enc) : node scripts/decrypt-backup.js <fichier.enc> [sortie.sql.gz]
// La clé est lue dans la variable d'environnement BACKUP_ENCRYPTION_KEY (jamais en argument de ligne de commande).
const fs = require('fs');
const { decryptBuffer } = require('../src/backup_crypto');
const [src, dest] = process.argv.slice(2);
if (!src) { console.error('Usage : BACKUP_ENCRYPTION_KEY=… node scripts/decrypt-backup.js <fichier.enc> [sortie.sql.gz]'); process.exit(1); }
try {
  const out = dest || src.replace(/\.enc$/i, '') || src + '.dec';
  if (fs.existsSync(out)) { console.error('Refus : le fichier de sortie existe déjà : ' + out); process.exit(1); }
  fs.writeFileSync(out, decryptBuffer(fs.readFileSync(src)), { flag: 'wx' });
  console.log('Déchiffré : ' + out);
} catch (e) { console.error(e.message); process.exit(1); }
