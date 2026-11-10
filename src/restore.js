// Restauration : npm run restore -- backups/smp-....sql.gz (DATABASE_URL doit pointer vers une base vide).
require('dotenv').config();
const { spawn } = require('child_process'), fs = require('fs'), zlib = require('zlib');
const backup = require('./backup');
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage : npm run restore -- <fichier .sql.gz> (DATABASE_URL doit pointer vers une base vide)'); process.exit(1); }
let connection;
try { connection = backup.psqlConnectionOptions(); }
catch (e) { console.error(e.message); process.exit(1); }
const p = spawn(process.env.PSQL || 'psql', [...connection.args, '-v', 'ON_ERROR_STOP=1', '-q'], { env: connection.env, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
p.on('error', e => { console.error('psql introuvable ou impossible à lancer : ' + e.message); process.exit(1); });
const input = fs.createReadStream(file).pipe(zlib.createGunzip());
input.on('error', e => { console.error('Fichier gzip invalide : ' + e.message); p.stdin.destroy(); });
input.pipe(p.stdin);
p.on('close', c => { console.log(c === 0 ? 'Restauration terminée.' : 'Restauration échouée.'); process.exit(c === null ? 1 : c); });
