'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = read('public/app.js');
const core = read('src/core.js');
const checks = [
  ['le profil /me reste la source des stations autorisées', /G\('\/me'\)/.test(app) && /ME\.stations/.test(app)],
  ['le sélecteur est masqué pour le Super Admin global', /!ME\?\.is_global && stations\.length > 1/.test(app)],
  ['la station sélectionnée est validée contre la liste autorisée', /find\(s => String\(s\.id\) === String\(v\)\)/.test(app)],
  ['une sélection de station non autorisée est refusée dans l’interface', /Cette station ne fait pas partie de vos accès/.test(app)],
  ['chaque requête transmet un instantané de la station sélectionnée', /const requestSid = SID/.test(app) && /'X-Station-Id': requestSid/.test(app)],
  ['les lectures GET obsolètes sont rejetées après un changement de station', /requestStationEpoch !== STATION_EPOCH/.test(app) && /STALE_STATION_RESPONSE/.test(app)],
  ['les rendus de navigation obsolètes ne peuvent pas remplacer la vue courante', /const navEpoch = \+\+NAV_EPOCH/.test(app) && /if \(navEpoch !== NAV_EPOCH\) return/.test(app)],
  ['les erreurs de transition obsolètes ne sont pas montrées à la nouvelle station', /navEpoch !== NAV_EPOCH \|\| e\?\.stale/.test(app)],
  ['le contenu métier précédent est retiré pendant le changement', /pg\.innerHTML = skeleton\(\)/.test(app)],
  ['le changement de station invalide l’historique de navigation', /NAV_HISTORY\.length = 0/.test(app)],
  ['le changement de station met à jour la devise et la station persistée', /CUR = String\(next\.currency \|\| 'FCFA'\)/.test(app) && /keep\(\)/.test(app)],
  ['la remise à zéro de session invalide les requêtes et vues en cours', /STATION_EPOCH\+\+; NAV_EPOCH\+\+/.test(app)],
  ['le serveur valide l’affectation utilisateur-station indépendamment de l’UI', /FROM user_stations us/.test(core) && /us\.user_id = \$1 AND us\.station_id = \$2/.test(core)],
  ['le serveur vérifie aussi que la station est active et appartient au client', /st\.active = true/.test(core) && /st\.client_id = u\.client_id/.test(core)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
