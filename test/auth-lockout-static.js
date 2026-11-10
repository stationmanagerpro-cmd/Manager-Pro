'use strict';
// ANO-04 / RG-05 : verrouillage de connexion lié à l'identifiant ET à l'adresse IP, réponse neutre, journalisation.
const fs = require('fs');
const assert = require('assert');
const auth = fs.readFileSync('src/auth.js', 'utf8');
const migration = fs.readFileSync('migrations/103_login_throttle.sql', 'utf8');
const login = auth.slice(auth.indexOf("pub.post('/login'"), auth.indexOf('/** Thème personnel'));
let passed = 0;
function check(label, fn) { fn(); passed++; console.log('✔ ' + label); }
check('le verrou est clé sur (identifiant, adresse IP) : une autre IP n’est pas bloquée', () => {
  assert.match(login, /FROM login_throttle WHERE login = \$1 AND ip = \$2/);
  assert.match(login, /ON CONFLICT \(login, ip\) DO UPDATE/);
  assert.match(migration, /PRIMARY KEY \(login, ip\)/);
});
check('le verrouillage n’écrit plus sur le compte utilisateur (un tiers ne peut plus bloquer le Superadmin)', () => {
  assert.doesNotMatch(login, /UPDATE users\s+SET failed_logins = CASE/);
  assert.doesNotMatch(login, /HttpError\(423/);
});
check('une seule réponse (401, même message) pour compte inexistant, inactif, verrouillé ou mot de passe faux', () => {
  assert.strictEqual((login.match(/new HttpError\(401/g) || []).length, 1);
  assert.match(login, /const ok = !!\(u && u\.active && match && !locked\)/);
  assert.match(auth, /LOGIN_FAIL_MSG = 'Identifiant ou mot de passe incorrect'/);
});
check('le mot de passe est comparé même pour un compte absent ou inactif (hachage factice)', () => {
  assert.match(auth, /DUMMY_HASH = bcrypt\.hashSync\(/);
  assert.match(login, /bcrypt\.compare\(req\.body\.password, u \? u\.password_hash : DUMMY_HASH\)/);
});
check('le compteur est atomique, fixé à 15 minutes au seuil, remis à zéro en cas de succès', () => {
  assert.match(login, /now\(\) \+ interval '15 minutes'/);
  assert.match(login, /\[key, ip, MAX_FAILS\]/);
  assert.match(login, /DELETE FROM login_throttle WHERE login = \$1 AND ip = \$2/);
});
check('les verrouillages sont journalisés', () => assert.match(login, /audit\(pool, \{ user: u \|\| null, ip \}, 'auth', `Verrouillage temporaire/));
check('le déblocage manuel efface les verrous par identifiant et par IP', () => {
  const unlock = auth.slice(auth.indexOf("priv.post('/users/:id/unlock'"));
  assert.match(unlock, /DELETE FROM login_throttle WHERE login = \(SELECT lower\(login\) FROM users WHERE id = \$1\)/);
});
check('la liste des utilisateurs tient compte des verrous pour afficher « Débloquer »', () => assert.strictEqual((auth.match(/FROM login_throttle t WHERE t\.login = lower\(u\.login\)/g) || []).length, 3));
check('la migration est additive (nouvelle table, remise à zéro des anciens verrous uniquement)', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS login_throttle/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
});
console.log(`\n${passed}/${passed} contrôles statiques réussis.`);
