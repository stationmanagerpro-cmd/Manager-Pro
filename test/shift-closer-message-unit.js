'use strict';
// Message WhatsApp de fin de quart (clôturant + employé) : scénarios obligatoires. Module pur, sans base de données.
const assert = require('assert');
const { closerMessage, individualMessage, consistency } = require('../src/shift_message');
let n = 0; const check = (l, f) => { f(); n++; console.log('✓ ' + l); };
const shift = { number: 12, kind: 'jour', opened_at: '2026-11-01T06:00:00Z', closed_at: '2026-11-01T14:00:00Z' };
const base = () => ({
  fuel_total: 100000, other_sales: { total: 0, by_method: [] }, fuel_payments: { especes: 100000 },
  counters: [{ pump: 'P1', counter: 'A', product: 'Gasoil', index_start: 0, index_end: 100, liters: 100, amount: 100000 }],
  cash: { theoretical: 100000, counted: 100000, gap: 0 },
  employees: [{ employee_id: 1, name: 'Awa Traoré', pumps: ['P1'], fuel_amount: 100000, cash_gap: 0, stock_gaps: [] }],
  anomalies: [], fuel_declared: { undeclared: 0 } });
const msg = (c, o = {}) => closerMessage({ stationName: 'Station Test', shift, report: c, managerName: 'Chef Bamba', closerName: 'Gérant Diallo', ...o });
const sections = ['RÉCAPITULATIF DES VENTES', 'RÉPARTITION DES PAIEMENTS', 'SITUATION DE LA CAISSE', 'SITUATION PAR EMPLOYÉ', 'ANOMALIES DÉTECTÉES', 'JUSTIFICATIONS ET OBSERVATIONS', 'SYNTHÈSE FINALE', 'SIGNATURE DU CLÔTURANT'];

check('quart sans anomalie : toutes les sections, caisse équilibrée, aucun point de vigilance', () => {
  const m = msg(base());
  let last = -1; for (const s of sections) { const i = m.indexOf(s); assert.ok(i > last, s); last = i; }
  assert.match(m, /✅ Caisse équilibrée/); assert.match(m, /Aucune anomalie commerciale/); assert.match(m, /Aucun point de vigilance : situation conforme/);
  assert.ok(!m.includes('🔴'), 'aucun rouge sans anomalie');
});
check('déficit : rouge et montant ; excédent : orange', () => {
  const d = base(); d.cash = { theoretical: 100000, counted: 97500, gap: -2500 }; d.employees[0].cash_gap = -2500;
  assert.match(msg(d), /🔴 DÉFICIT de caisse de \*2 500 FCFA\*/);
  const e = base(); e.cash = { theoretical: 100000, counted: 101000, gap: 1000 }; e.employees[0].cash_gap = 1000;
  assert.match(msg(e), /🟠 EXCÉDENT de caisse de \*1 000 FCFA\*/);
});
check('plusieurs employés et pompes : un bloc par employé, détail par compteur', () => {
  const c = base(); c.counters.push({ pump: 'P2', counter: 'A', product: 'Super', index_start: 10, index_end: 60, liters: 50, amount: 40000 });
  c.fuel_total = 140000; c.fuel_payments = { especes: 140000 }; c.cash = { theoretical: 140000, counted: 139500, gap: -500 };
  c.employees.push({ employee_id: 2, name: 'Moussa Keita', pumps: ['P2'], fuel_amount: 40000, cash_gap: -500, stock_gaps: [{ product: 'Super', amount: -2 }] });
  const m = msg(c);
  assert.match(m, /👤 \*Awa Traoré\*\n   Poste : P1/); assert.match(m, /👤 \*Moussa Keita\*\n   Poste : P2/);
  assert.match(m, /P1 \/ Cpt A – Gasoil/); assert.match(m, /P2 \/ Cpt A – Super/);
});
check('plusieurs moyens de paiement', () => {
  const c = base(); c.fuel_payments = { especes: 60000, mobile_money: 30000, carte: 10000 };
  const m = msg(c);
  assert.match(m, /Espèces : 60 000 FCFA/); assert.match(m, /Mobile Money : 30 000 FCFA/); assert.match(m, /Carte bancaire : 10 000 FCFA/); assert.match(m, /Total des paiements : \*100 000 FCFA\*/);
});
check('anomalies individuelles : employé + nature, sans double comptage caisse/stock', () => {
  const c = base(); c.cash = { theoretical: 100000, counted: 97500, gap: -2500 };
  c.employees[0].cash_gap = -2500; c.employees[0].stock_gaps = [{ product: 'Gasoil', amount: -3 }];
  c.anomalies = [{ kind: 'autre', description: 'Bidon cassé', employee: 'Awa Traoré' }, { kind: 'ecart_caisse', description: 'doublon caisse', employee: 'Awa Traoré' }, { kind: 'ecart_stock', description: 'doublon stock', employee: 'Awa Traoré' }];
  const m = msg(c);
  assert.match(m, /Awa Traoré : Bidon cassé/); assert.ok(!/doublon/.test(m));
  assert.match(m, /Anomalies commerciales : 🔴 1/); assert.match(m, /Écarts physiques : 🔴 2/);
});
check('responsable ≠ clôturant : la signature est celle du clôturant réel', () => {
  const m = msg(base());
  assert.match(m, /Responsable du quart : Chef Bamba/);
  const sig = m.split('SIGNATURE DU CLÔTURANT')[1]; assert.match(sig, /Nom : Gérant Diallo/); assert.ok(!/Chef Bamba/.test(sig));
  assert.match(sig, /Clôturé par : Gérant Diallo/);
  assert.ok(m.indexOf('SIGNATURE DU CLÔTURANT') > m.indexOf('SYNTHÈSE FINALE'));
});
check('clôturant inconnu : jamais inventé (ni le responsable, ni le générateur)', () => {
  const m = msg(base(), { closerName: null, generatedBy: 'admin' });
  assert.match(m, /Nom : non disponible/); assert.ok(!/Clôturé par : (Chef Bamba|admin)/.test(m));
});
check('avec / sans observations', () => {
  assert.match(msg(base()), /Aucune observation renseignée/);
  const m = msg(base(), { justification: 'Erreur de monnaie', observations: 'Tout vérifié' });
  assert.match(m, /Justification des écarts : Erreur de monnaie/); assert.match(m, /Observations du responsable : Tout vérifié/);
});
check('« Généré par » tout en bas, après la signature, pour clôturant et employé', () => {
  const m = msg(base(), { generatedBy: 'admin' });
  assert.ok(m.trimEnd().endsWith('📄 Généré par : admin'), m.slice(-80));
  const i = individualMessage({ stationName: 'X', shift, mine: { employee_id: 1, name: 'Awa Traoré', pumps: ['P1'], fuel_amount: 1000, fuel_liters: 1, non_cash: {}, expected_cash: 1000, counted_cash: 1000, cash_gap: 0, stock_gaps: [] }, closerName: 'Gérant Diallo', generatedBy: 'admin' });
  assert.ok(i.trimEnd().endsWith('📄 Généré par : admin')); assert.match(i, /Clôturé par : Gérant Diallo/);
});
check('cohérence automatique : paiements ≠ ventes signalés', () => {
  const c = base(); c.fuel_payments = { especes: 90000 };
  assert.ok(consistency(c, v => v + ' FCFA').length >= 1); assert.match(msg(c), /Incohérence/);
});
console.log(`\n${n} contrôles réussis.`);
