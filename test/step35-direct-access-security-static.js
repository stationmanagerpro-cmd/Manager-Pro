// Étape 35 — Vérification statique des barrières d'accès direct API.
// Ne contacte aucune API et ne modifie aucune donnée.
const fs = require('fs');
const assert = require('assert');
const server = fs.readFileSync('src/server.js', 'utf8');
const core = fs.readFileSync('src/core.js', 'utf8');
const platform = fs.readFileSync('src/platform.js', 'utf8');
const security = fs.readFileSync('test/security.js', 'utf8');
const runner = fs.readFileSync('test/all.js', 'utf8');
const checks = [
  [/app\.use\('\/api', auth\)/, 'les routes privées passent par l’authentification JWT'],
  [/app\.use\('\/api', priv\)/, 'les routes privées chargent le profil et les permissions'],
  [/app\.use\('\/api', station\)/, 'les routes métier passent par le contrôle de station'],
  [/JOIN user_sessions s ON s\.id = \$2 AND s\.user_id = u\.id/, 'la session JWT doit appartenir à l’utilisateur'],
  [/u\.revoked_at \|\| u\.expires_at < new Date\(\)/, 'une session révoquée ou expirée doit être refusée'],
  [/st\.active = true/, 'une station inactive doit être refusée'],
  [/st\.client_id = u\.client_id/, 'l’affectation de station doit respecter le client'],
  [/const needPrincipal = \(req, res, next\) =>[\s\S]{0,120}req\.user\.is_global/, 'les routes de plateforme exigent le Super Admin'],
  [/app\.use\('\/api\/public', require\('\.\/access_keys'\)\.pub\)/, 'seule la vérification publique de clé est montée avant auth'],
  [/REFUS DE SÉCURITÉ[\s\S]*localhost/, 'le test API destructif refuse les hôtes non locaux'],
  [/ALLOW_DESTRUCTIVE_TESTS !== '1'/, 'le runner d’intégration exige une confirmation destructive explicite']
];
for (const [re, message] of checks) assert(re.test([server, core, platform, security, runner].join('\n')), message);
console.log(`✔ Contrôles statiques d’accès direct API : ${checks.length}/${checks.length}`);
