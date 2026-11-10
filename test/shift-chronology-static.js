// Contrôles statiques : quart saisi en retard → replacé chronologiquement (UI ext-core.js + backend shifts.js).
const fs = require('fs'), assert = require('assert'), path = require('path');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'public/ext-core.js'), 'utf8');
const shifts = fs.readFileSync(path.join(root, 'src/shifts.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/responsive-v3.css'), 'utf8');
const fin = fs.readFileSync(path.join(root, 'src/finance.js'), 'utf8');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ✔ ' + m); };
console.log('=== Quarts saisis en retard : placement chronologique ===');
// Interface réellement utilisée (ext-core.js remplace openQ de app.js)
ok(/\['odate', 'Date d’ouverture', 'date'\]/.test(core), 'Modale ext-core : champ Date d’ouverture');
ok(/\['otime', 'Heure d’ouverture', 'time'\]/.test(core), 'Modale ext-core : champ Heure d’ouverture');
ok(/shift_date: d\.odate, opened_at: new Date\(openedMs\)\.toISOString\(\)/.test(core), 'Payload envoie shift_date + opened_at');
ok(/ne peut pas être dans le futur/.test(core), 'UI refuse une date future');
ok(/classList\.add\('oq-wide'\)/.test(core) && /#m > div\.oq-wide/.test(css), 'Modale élargie (classe oq-wide + CSS)');
ok(/\/shifts\/placement\?at=/.test(core), 'UI interroge /shifts/placement et reprend les index du quart précédent');
// Backend
ok(/r\.get\('\/placement'/.test(shifts) && shifts.indexOf("r.get('/placement'") < shifts.indexOf("r.get('/:id'"), 'Route /placement déclarée avant /:id');
ok(/chevauche le quart N°/.test(shifts), 'Ouverture refusée si chevauchement d’un quart existant');
ok(/const inserted = !!nb\.next/.test(shifts), 'Détection d’un quart inséré dans l’historique');
ok(/if \(!inserted\) await c\.query\('UPDATE pump_counters SET current_index/.test(shifts), 'Ouverture insérée : index courant du compteur non écrasé');
ok(/supérieur à l'index initial du quart suivant/.test(shifts), 'Chaîne d’index : initial ≤ début du quart suivant');
ok(/inserted \? 0 : fl\(b\.opening_cash - reg\.balance\)/.test(shifts), 'Ouverture insérée : solde courant de caisse non recalé');
ok(/if \(!notLatest\) await c\.query\('UPDATE pump_counters SET current_index/.test(shifts), 'Clôture d’un quart ancien : index courant intact');
ok(/indiquez sa date\/heure de clôture réelle/.test(shifts), 'Clôture datée obligatoire pour un quart ancien');
ok(/postérieure à l\\'ouverture du quart suivant/.test(shifts), 'Clôture bornée par l’ouverture du quart suivant');
ok(/baseCash = fl\(Number\(s\.opening_cash\) \+ Number\(mv\.t\)\)/.test(shifts), 'Caisse théorique reconstituée à la date du quart');
ok(/opening_stock\b[\s\S]{0,200}\+ lit/.test(shifts), 'Stock théorique reconstitué à la date du quart');
ok(/created_at = now\(\)/.test(shifts) && /paid_at = now\(\)/.test(shifts), 'Écritures de clôture/ouverture horodatées à la date du quart');
ok(/ORDER BY opened_at DESC NULLS LAST, id DESC/.test(shifts), 'Liste des quarts triée par date d’ouverture');
ok((fin.match(/ORDER BY sh\.opened_at, sh\.number/g) || []).length === 3, 'Rapports financiers : quarts lus dans l’ordre chronologique');
console.log(`\n✔ ${n}/${n}`);
