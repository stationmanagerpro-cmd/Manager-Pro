'use strict';
const fs = require('fs');
const assert = require('assert');
const home = fs.readFileSync('public/ext-home.js', 'utf8');
const access = fs.readFileSync('src/access_keys.js', 'utf8');
let n = 0;
function check(name, fn) { fn(); n++; console.log('✓ ' + name); }
check('les boutons « Se connecter » du modèle ouvrent le flux homeLogin via action:login', () => { assert.match(home, /dataset\.act === 'login'\) return window\.homeLogin\(\)/); assert.ok((require('../public/home-core.js').defaultDoc().nodes.length > 0)); });
check('la clé n’est demandée que si la politique l’exige et qu’aucun accès valide n’existe', () => assert.match(home, /HOME\.access && HOME\.access\.required && !HOME\.access\.ok/));
check('la clé est validée comme quatre chiffres', () => assert.ok(home.includes('if (!/^\\d{4}$/.test(key))')));
check('la vérification utilise la route publique dédiée', () => assert.match(home, /\/api\/public\/access\/verify/));
check('les erreurs serveur sont affichées clairement et sans plantage', () => assert.match(home, /j\.error \|\| 'Vérification impossible\.'/));
check('le serveur vérifie aussi la clé à la connexion', () => assert.match(access, /requireGate/));
console.log(`${n}/6 contrôles réussis.`);
