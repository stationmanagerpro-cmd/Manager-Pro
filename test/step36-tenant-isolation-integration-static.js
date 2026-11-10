// Vérifie la sûreté du nouveau test d'intégration sans appeler l'API.
const fs = require('fs');
const assert = require('assert');
const file = fs.readFileSync('test/tenant-isolation-integration.js', 'utf8');
const checks = [
  [/new URL\(BASE\)/, 'l’URL de l’API est validée'],
  [/!\['http:', 'https:'\]\.includes\(parsed\.protocol\)/, 'seuls HTTP et HTTPS sont acceptés'],
  [/redirect: 'manual'/, 'les redirections HTTP ne sont pas suivies'],
  [/AbortSignal\.timeout\(10000\)/, 'les requêtes disposent d’un délai maximal'],
  [/localhost.*127\.0\.0\.1.*::1/, 'les hôtes distants sont refusés'],
  [/stationA === stationB/, 'les deux stations doivent être distinctes'],
  [/process\.env\.ISO_TEST_PASSWORD_A/, 'le mot de passe A est lu depuis une variable d’environnement'],
  [/process\.env\.ISO_TEST_PASSWORD_B/, 'le mot de passe B est lu depuis une variable d’environnement'],
  [/GET', '\/me', null, stationA/, 'le test vérifie le refus sans jeton'],
  [/jeton-invalide-test/, 'le test vérifie le refus d’un jeton invalide'],
  [/POST', '\/auth\/login'/, 'le test se limite à authentifier les comptes'],
  [/GET', '\/products'/, 'le contrôle inter-stations utilise une lecture'],
  [/ownProducts\.status === 200/, 'le test confirme d’abord que la lecture sur la station A fonctionne'],
  [/\[400, 403, 404\]\.includes\(cross\.status\)/, 'un accès croisé doit être refusé'],
  [/Aucune donnée métier n’est créée\/modifiée/i, 'le test précise les effets limités aux sessions et journaux'],
  [/!meA\.json\?\.is_global && !meB\.json\?\.is_global/, 'les comptes globaux sont exclus du scénario']
];
for (const [re, label] of checks) assert(re.test(file), label);
console.log(`✔ Contrôles statiques du test d’isolation multi-clients : ${checks.length}/${checks.length}`);
