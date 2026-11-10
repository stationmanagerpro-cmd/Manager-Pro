const fs = require('fs');
const assert = require('assert');
const env = fs.readFileSync('.env.pc.example', 'utf8');
const guide = fs.readFileSync('docs/HEBERGEMENT_PC_WINDOWS_TAILSCALE_FUNNEL.md', 'utf8');
const installer = fs.readFileSync('scripts/windows/install-local-server.ps1', 'utf8');
const server = fs.readFileSync('src/server.js', 'utf8');
let n = 0;
function check(label, fn) { fn(); n++; console.log('✔ ' + label); }
check('Configuration locale pointe vers PostgreSQL du PC', () => assert(env.includes('127.0.0.1:5432/station_manager')));
check('Fichiers téléversés et sauvegardes sortis du dossier de code', () => assert(env.includes('D:/StationManagerData/uploads') && env.includes('D:/StationManagerData/backups')));
check('Opérations destructives désactivées par défaut', () => assert(env.includes('RESTORE_ENABLED=0') && env.includes('RESET_GLOBAL_ENABLED=0')));
check('Guide établit PC comme hébergement principal sans dépendance obligatoire cloud', () => assert(guide.includes('ne dépend d\'aucun service cloud')));
check('Guide recommande sauvegarde hors du PC et restauration de test', () => assert(guide.includes('disque externe chiffré') && guide.includes('test de restauration')));
check('Guide recommande Serve privé et signale Funnel public', () => assert(guide.includes('Tailscale Serve') && guide.includes("Funnel expose l'application sur Internet")));
check('Installateur ne remplace pas .env existant', () => assert(installer.includes("if (-not (Test-Path '.\\.env'))") && installer.includes("'.env existe déjà : il ne sera pas remplacé.'")));
check('Installateur utilise npm ci et ne touche pas à la base', () => assert(installer.includes('npm ci') && installer.includes('ne crée pas, ne migre et ne restaure aucune base')));
check('Application peut écouter en local selon HOST', () => assert(server.includes('const host = process.env.HOST || null') && server.includes('app.listen(port, host, onListening)')));
console.log(`\n${n}/${n} contrôles statiques réussis.`);
