'use strict';
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const messaging = read('src/messaging.js');
const shifts = read('src/shifts.js');
const hr = read('src/hr_v2.js');
const purchases = read('src/purchases.js');
const ui = read('public/ext-messaging.js');
const checks = [
  ['le moteur distingue acteur déclencheur et employé concerné', /actorUserId = null[\s\S]*loadContractForUser\(actorUserId \|\| employeeUserId, false\)/.test(messaging)],
  ['le jaugeage incohérent à l’ouverture est raccordé au moteur', /kind: 'counter_anomaly'[\s\S]*metricUnit: 'litres'/.test(shifts)],
  ['les notes d’incident depuis le quart déclenchent une alerte', /kind: 'incident_note'[\s\S]*refTable: 'shift_anomalies'/.test(shifts)],
  ['les absences et retards déclenchent une alerte', /kind: b\.status === 'absent' \? 'absence' : 'late_arrival'/.test(hr)],
  ['une correction de présence peut déclencher une nouvelle alerte', /newStatus !== old\.status[\s\S]*kind: newStatus === 'absent' \? 'absence' : 'late_arrival'/.test(hr)],
  ['la fiche employé de présence est limitée à la station active', /FROM employees WHERE id = \$1 AND station_id = \$2 AND deleted_at IS NULL/.test(hr)],
  ['l’écart de facture fournisseur déclenche une alerte à seuil', /kind: 'purchase_variance'[\s\S]*metricUnit: 'XOF'[\s\S]*metricPercent/.test(purchases)],
  ['les règles de seuil incluent l’écart fournisseur', /'purchase_variance'/.test(messaging) && /'purchase_variance'/.test(ui)],
  ['l’échec de notification ne fait pas échouer les opérations métier', /catch \(alertError\) \{ console\.warn\('\[alertes\]/.test(shifts) && /catch \(alertError\) \{ console\.warn\('\[alertes\]/.test(hr) && /catch \(alertError\) \{ console\.warn\('\[alertes\]/.test(purchases)],
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? '✔' : '✘'} ${label}`); if (!ok) failed++; }
console.log(`${checks.length - failed}/${checks.length} contrôles statiques réussis.`);
if (failed) process.exit(1);
