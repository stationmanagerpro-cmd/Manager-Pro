'use strict';
// Partage du rapport de quart : contrôles statiques de l'interface et des routes.
const fs = require('fs');
const assert = require('assert');
const app = fs.readFileSync('public/app.js', 'utf8');
const fin = fs.readFileSync('src/finance.js', 'utf8');
let n = 0;
function check(label, fn) { fn(); n++; console.log('✔ ' + label); }
const page = app.slice(app.indexOf('async function vRapq()'), app.indexOf('async function vRapq()') + 2500);
check('quatre boutons sur la page du rapport (2 e-mail, 2 WhatsApp)', () => {
  assert(/shiftShareEmail\(\$\{Number\(s\.id\)\},'employees'/.test(page) && /shiftShareEmail\(\$\{Number\(s\.id\)\},'closer'/.test(page));
  assert(/shiftShareWa\(\$\{Number\(s\.id\)\},'employees'\)/.test(page) && /shiftShareWa\(\$\{Number\(s\.id\)\},'closer'\)/.test(page));
});
check('boutons PDF / Imprimer existants conservés', () => assert(/Imprimer/.test(page) && /Exporter en PDF/.test(page)));
check('confirmation avant l’envoi d’un e-mail', () => assert(/function shiftShareEmail[\s\S]*?ask\(/.test(app)));
check('WhatsApp : lien wa.me avec texte encodé, ouverture sûre, aucun envoi automatique', () => {
  assert(/https:\/\/wa\.me\//.test(app) && /encodeURIComponent\(text\)/.test(app) && /rel="noopener noreferrer"/.test(app));
  assert(!/fetch\([^)]*wa\.me/.test(app));
});
check('noms et message échappés dans la fenêtre WhatsApp', () => assert(/esc\(j\.message\)/.test(app) && /esc\(r\.name\)/.test(app)));
check('routes report-contacts et report-email protégées par permission', () => assert(/report-contacts', need\(\.\.\.SHARE_PERMS\)/.test(fin) && /report-email', need\(\.\.\.SHARE_PERMS\)/.test(fin)));
check('recherche limitée à la station courante et aux ventes valides', () => assert(/e\.station_id = \$2/.test(fin) && /sa\.status = 'valide'/.test(fin)));
check('PDF partagé : même générateur pour téléchargement et e-mail', () => assert(/async function shiftReport\(/.test(fin) && (fin.match(/shiftReport\(req\.sid, req\.params\.id\)/g) || []).length === 2));
check('envoi tracé dans le journal d’audit', () => assert(/Envoi e-mail du rapport de quart/.test(fin)));
console.log(`\n${n}/9 contrôles statiques réussis.`);
