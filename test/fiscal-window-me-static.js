// Non-régression : ME est un `let` (app.js) ; window.ME n'existe jamais -> la Fiscalité s'affichait toujours « non autorisée ».
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'ext-fiscal.js'), 'utf8');
assert(!/window\.ME/.test(src), 'ext-fiscal.js ne doit plus lire window.ME');
assert(/typeof ME !== 'undefined'/.test(src), 'fiscalAllowed doit lire la variable globale ME');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
assert(/^let TK = null, ME = null/m.test(app), 'ME reste déclaré avec let dans app.js');
console.log('fiscal-window-me-static : OK');
