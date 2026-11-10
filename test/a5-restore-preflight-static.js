const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const ps = fs.readFileSync(path.join(root, 'scripts/windows/a5-preflight-restore.ps1'), 'utf8');
const checks = [
 ['le script indique explicitement qu’il ne lance pas de restauration', /ne lance (?:pas|jamais) la restauration/i.test(ps)],
 ['il refuse si .env manque', /if \(-not \(Test-Path -LiteralPath \$envPath\)\)/.test(ps)],
 ['il lit DATABASE_URL sans afficher son contenu complet', /Read-EnvValue 'DATABASE_URL'/.test(ps) && !/Write-Host\s+\$urlText/.test(ps)],
 ['il exige un suffixe de base test ou isolée', /_test\|_isolated\|_isolee/.test(ps)],
 ['il refuse les hôtes PostgreSQL distants', /Hôte non local/.test(ps) && /localhost.*127\.0\.0\.1.*::1/.test(ps)],
 ['il exige RESTORE_ENABLED=1', /Read-EnvValue 'RESTORE_ENABLED'\) -ne '1'/.test(ps)],
 ['il exige RESTORE_TARGET_ISOLATED=1', /Read-EnvValue 'RESTORE_TARGET_ISOLATED'\) -ne '1'/.test(ps)],
 ['il précise que le drapeau ne prouve pas l’isolation', /pas preuve d’isolation/.test(ps)],
 ['il précise qu’il ne se connecte pas à PostgreSQL', /ne se connecte pas à PostgreSQL/.test(ps)],
 ['il sort en erreur si un contrôle échoue', /if \(\$errors -gt 0\)[\s\S]*exit 1/.test(ps)]
];
let failed = 0;
for (const [label, ok] of checks) { try { assert(ok); console.log('PASS ' + label); } catch { failed++; console.error('FAIL ' + label); } }
console.log(`${checks.length - failed}/${checks.length} contrôles préflight A5 réussis.`);
if (failed) process.exit(1);
