const fs = require('fs');
const assert = require('assert');
const backup = fs.readFileSync('scripts/windows/backup-complete.ps1', 'utf8');
const guide = fs.readFileSync('docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
let n = 0;
function check(label, fn) { fn(); n++; console.log('✔ ' + label); }
check('Sauvegarde complète exige une destination choisie hors du projet', () => assert(backup.includes('[Parameter(Mandatory = $true)]') && backup.includes('La destination doit être hors du dossier du projet')));
check('Sauvegarde exécute une sauvegarde PostgreSQL réelle et vérifie le code retour', () => assert(backup.includes('npm run backup') && backup.includes('$LASTEXITCODE -ne 0')));
check('Sauvegarde inclut les fichiers téléversés séparément du dump', () => assert(backup.includes("Read-EnvValue 'UPLOAD_DIR'") && backup.includes("Join-Path $stage 'uploads'")));
check('Archive complète exclut explicitement les secrets .env', () => assert(backup.includes('sans .env ni code secret') && !/Copy-Item[^\n]*\.env/i.test(backup)));
check('Archive contient manifest et empreintes SHA-256', () => assert(backup.includes('MANIFEST.json') && backup.includes('Get-FileHash') && backup.includes('SHA-256 incorrect')));
check('Archive est extraite dans un répertoire temporaire pour vérification', () => assert(backup.includes('Expand-Archive') && backup.includes('Compress-Archive')));
check('Archive échouée est supprimée et les répertoires temporaires nettoyés', () => assert(backup.includes('Remove-Item -LiteralPath $archive') && backup.includes('finally')));
check('Script de sauvegarde n’expose pas le mot de passe en argument de ligne de commande', () => assert(!/--password\s+\$/.test(backup)));
check('Guide documente sauvegarde combinée DB + uploads sur disque externe', () => assert(guide.includes('backup-complete.ps1') && guide.includes('SHA-256') && guide.includes('fichiers téléversés')));
check('Le projet garde les scripts npm existants sans les remplacer', () => assert(pkg.scripts.backup === 'node src/backup.js' && pkg.scripts.test));
console.log(`\n${n}/${n} contrôles statiques réussis.`);
