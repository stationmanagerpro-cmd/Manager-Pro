const fs = require('fs');
const s = fs.readFileSync('src/access_keys.js', 'utf8');
const checks = [
  ['politique absente détectée', /if \(v == null && settingsAvailable\)/.test(s)],
  ['activation par défaut conditionnée à une clé disponible', /defaultRequired = Number\(active && active\.n\) > 0/.test(s)],
  ['clé active non expirée exigée', /status = 'disponible'/.test(s) && /expires_at > now\(\)/.test(s)],
  ['configuration explicite prioritaire', /v && typeof v\.required === 'boolean' \? v\.required : defaultRequired/.test(s)],
  ['interrupteur de secours ACCESS_KEY_DISABLE conservé', /process\.env\.ACCESS_KEY_DISABLE !== '1'/.test(s)],
  ['absence de table tolérée sans verrouillage global', /if \(e\.code !== '42P01'\) throw e/.test(s)],
  ['contrôle serveur à la connexion conservé', /async function requireGate/.test(s)],
];
let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${name}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} contrôles réussis`);
if (failed) process.exit(1);
