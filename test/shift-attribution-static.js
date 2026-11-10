'use strict';
// Contrôles statiques du rattachement par employé (câblage serveur, migration, interface, paie).
const assert = require('assert'), fs = require('fs'), path = require('path');
const rd = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let n = 0; const check = (l, fn) => { fn(); n++; console.log('✔ ' + l); };
const mig = rd('migrations/088_attribution_par_employe.sql'), sh = rd('src/shifts.js'), app = rd('public/app.js'), hr = rd('src/hr.js'), fin = rd('src/finance.js'), core = rd('public/ext-core.js');

check('migration 088 : anomalie liée à un employé, écart lié à une anomalie, type « anomalie » autorisé, idempotente', () => {
  assert(/ALTER TABLE shift_anomalies\s+ADD COLUMN IF NOT EXISTS employee_id BIGINT REFERENCES employees/.test(mig));
  assert(/ADD COLUMN IF NOT EXISTS anomaly_id BIGINT REFERENCES shift_anomalies/.test(mig));
  assert(/DROP CONSTRAINT IF EXISTS employee_gaps_kind_check/.test(mig) && /kind IN \('caisse','stock','anomalie'\)/.test(mig));
  assert(!/DROP TABLE|DELETE FROM|TRUNCATE/i.test(mig), 'aucune donnée détruite');
});
check('ouverture : une pompe peut rester sans employé (aucune obligation d\'attribution)', () => {
  assert(!/attribuez chaque pompe à un employé/.test(sh));
  assert(/Une pompe peut rester sans employé/.test(sh));
});
check('clôture : saisie par employé, refus nominatif, écarts insérés avec l\'employé, anomalies avec employee_id', () => {
  assert(/employee_closings: z\.array/.test(sh) && /require\('\.\/shift_attribution'\)/.test(sh));
  assert(/INSERT INTO employee_gaps\(station_id, shift_id, employee_id, kind, product_id, amount\)/.test(sh));
  assert(/INSERT INTO shift_anomalies\(shift_id, kind, description, amount, created_by, employee_id\)/.test(sh));
  assert(!/LIMIT 1[^;]*employee_gaps|first match|premier employé/i.test(sh), 'plus d\'attribution arbitraire au premier employé trouvé');
});
check('anomalie déclarée : employé obligatoire en quart partagé, écart créé si montant', () => {
  assert(/indiquez l'employé concerné par cette anomalie/.test(sh) && /'anomalie',\$4,\$5/.test(sh));
});
check('interface : saisie par employé à la clôture, employé choisi pour une anomalie, rapport avec l\'employé à l\'origine', () => {
  assert(/function empCloseBlock/.test(app) && /employee_closings = SH\.team\.map/.test(app));
  assert(/employee_id', team\.length > 1 \? 'Employé concerné \(obligatoire\)'/.test(app));
  assert(/Situation par employé/.test(app) && /Ensemble du quart/.test(app) && /r\.msg \|\| j\.message/.test(app));
});
check('envoi : PDF et message propres à chaque employé, rapport complet pour le clôturant', () => {
  assert(/employeeId: t\.id/.test(fin) && /Cet état ne concerne que vous/.test(fin) && /Employé à l\\'origine/.test(fin));
  assert(/message: shareMessage\(ctx, b\.currency, e\.id\)/.test(fin));
});
check('salaire : décision / dette possibles par l\'admin local OU le générateur de paie ; anomalies visibles au profil', () => {
  assert(/\/hr\/gaps\/:id\/decide', need\('hr\.gaps', 'hr\.payroll'\)/.test(hr) && /\/hr\/gaps\/:id\/to-debt', need\('hr\.gaps', 'hr\.debts', 'hr\.payroll'\)/.test(hr));
  assert(/\/hr\/employees\/:id\/anomalies/.test(hr) && /Anomalies à son nom/.test(core));
  assert(/aucune retenue automatique|Un écart n'entraîne jamais de retenue automatique/.test(core), 'garde-fou : jamais de retenue automatique');
});
check('cache PWA dérivé du build', () => assert(/smp-static-b[0-9a-f]{10}/.test(rd('public/sw.js'))));
console.log(`\n${n}/8 contrôles réussis.`);
