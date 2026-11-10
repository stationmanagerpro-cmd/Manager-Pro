// Contrôles statiques : ouverture de quart avec date passée (backend + UI).
// N’exécute pas de base de données — vérifie la présence et la cohérence du code.
const fs = require('fs');
const assert = require('assert');
const path = require('path');

const root = path.join(__dirname, '..');
const shifts = fs.readFileSync(path.join(root, 'src/shifts.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');

let n = 0;
const ok = (cond, msg) => { assert(cond, msg); n++; console.log('  ✔ ' + msg); };

console.log('=== Ouverture de quart datée (statique) ===');

// Backend schéma
ok(/shift_date:\s*z\.string\(\)\.regex/.test(shifts), 'openSchema accepte shift_date (YYYY-MM-DD)');
ok(/opened_at:\s*z\.string\(\)/.test(shifts), 'openSchema accepte opened_at');
ok(/ne peut pas être dans le futur/.test(shifts), 'Backend refuse une date/heure future');
ok(/COALESCE\(\$9::date,\s*CURRENT_DATE\)/.test(shifts), 'INSERT utilise COALESCE pour shift_date');
ok(/COALESCE\(\$10::timestamptz,\s*now\(\)\)/.test(shifts), 'INSERT utilise COALESCE pour opened_at');
ok(/backdated:\s*isBackdated/.test(shifts), 'Audit journalise le flag backdated');
ok(/date antérieure/.test(shifts), 'Message d’audit distinct pour quart antérieur');

// Frontend
ok(/id="oq_date"/.test(app), 'Champ date d’ouverture présent dans la modale');
ok(/id="oq_time"/.test(app), 'Champ heure d’ouverture présent dans la modale');
ok(/shift_date:\s*oqDate/.test(app), 'Payload envoie shift_date');
ok(/opened_at:\s*new Date\(openedMs\)\.toISOString\(\)/.test(app), 'Payload envoie opened_at ISO');
ok(/ne peut pas être dans le futur/.test(app), 'UI refuse une date/heure future');
ok(/Ce quart sera comptabilisé sur la période/.test(app), 'Confirmation demandée pour date antérieure');
ok(/tag x[^>]*>passé</.test(app) || /title="Quart saisi avec une date antérieure">passé</.test(app),
  'Badge « passé » sur la liste / carte des quarts');
ok(/notifyIfPastShift/.test(app), 'Toast info si vente/dépense sur quart antérieur');

// Backdating ventes / dépenses
const ops = fs.readFileSync(path.join(root, 'src/operations.js'), 'utf8');
const fuel = fs.readFileSync(path.join(root, 'src/fuelsales.js'), 'utf8');
ok(/function businessStampFromShift/.test(ops), 'Helper businessStampFromShift présent');
ok(/sold_at[\s\S]{0,120}COALESCE/.test(ops), 'Vente produits : sold_at aligné si quart passé');
ok(/spent_on[\s\S]{0,120}COALESCE/.test(ops), 'Dépense : spent_on aligné si quart passé');
ok(/paid_at[\s\S]{0,80}COALESCE/.test(ops), 'Paiements produits : paid_at aligné');
ok(/sold_at[\s\S]{0,120}COALESCE/.test(fuel), 'Vente carburant : sold_at aligné si quart passé');
ok(/paid_at[\s\S]{0,80}COALESCE/.test(fuel), 'Paiements carburant : paid_at aligné');

// Clôture datée
ok(/closed_at:\s*z\.string/.test(shifts), 'closeSchema accepte closed_at');
ok(/clôture ne peut pas être antérieure/.test(shifts), 'Backend refuse clôture avant ouverture');
ok(/closed_at\s*=\s*COALESCE\(\$8::timestamptz,\s*now\(\)\)/.test(shifts), 'UPDATE COALESCE closed_at');
ok(/id="cl_date"/.test(app) && /id="cl_time"/.test(app), 'Champs date/heure de clôture dans l’UI');
ok(/b\.closed_at\s*=/.test(app), 'cbody envoie closed_at');
ok(/Clôturer ce quart à la date du/.test(app), 'Confirmation si clôture antérieure');

console.log(`\n✔ Contrôles ouverture/clôture datées + backdating : ${n}/${n}`);
