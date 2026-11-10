// Lance le serveur sur un port de test puis exécute tous les tests : npm test
// Prérequis : base de TEST migrée et initialisée (voir README) ; ne jamais lancer sur la base de production.
require('dotenv').config();
const { spawn } = require('child_process');
// Les tests d'intégration créent/modifient des comptes : bloquer par défaut toute base distante.
const databaseUrl = process.env.DATABASE_URL;
let dbUrl;
try { dbUrl = new URL(databaseUrl || ''); } catch {
  console.error('REFUS : DATABASE_URL local de test requis.');
  process.exit(1);
}
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const databaseName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ''));
if (!localHosts.has(dbUrl.hostname.replace(/^\[|\]$/g, '')) || !/(^|[_-])(test|ci)([_-]|$)/i.test(databaseName)) {
  console.error('REFUS : npm test est réservé à une base PostgreSQL locale dédiée, nommée avec test ou ci.');
  process.exit(1);
}
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== '1') {
  console.error('REFUS : définir ALLOW_DESTRUCTIVE_TESTS=1 après vérification que la base locale est jetable.');
  process.exit(1);
}
const PORT = process.env.TEST_PORT || 3999, login = process.env.TEST_LOGIN || 'admin', pass = process.env.TEST_PASSWORD || 'MotDePasse123';
const env = { ...process.env, PORT, MAIL_MODE: 'json', API: `http://localhost:${PORT}/api`, BASE: `http://localhost:${PORT}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (file) => new Promise(res => { console.log('\n=== ' + file + ' ==='); const p = spawn('node', [file, login, pass], { env, stdio: 'inherit' }); p.on('close', c => res(c)); });
(async () => {
  const srv = spawn('node', ['src/server.js'], { env, stdio: ['ignore', 'ignore', 'inherit'] });
  let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(300); up = await fetch(env.API + '/health').then(r => r.ok).catch(() => false); }
  if (!up) { console.error('Le serveur de test ne démarre pas (DATABASE_URL, JWT_SECRET ?)'); srv.kill(); process.exit(1); }
  const res = {}; for (const f of ['test/smoke.js', 'test/hr-finance.js', 'test/hr-payroll-security.js', 'test/hr-v2.js', 'test/contracts.js', 'test/licenses.js', 'test/superadmin.js', 'test/security.js', 'test/ui.js']) res[f] = await run(f);
  srv.kill();
  console.log('\n=== Résultat ===\n' + Object.entries(res).map(([f, c]) => `${c === 0 ? '✔' : '✖'} ${f}`).join('\n'));
  process.exit(Object.values(res).every(c => c === 0) ? 0 : 1);
})();
