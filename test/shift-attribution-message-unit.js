'use strict';
// Rattachement des ventes carburant aux employés (quart partagé) + gabarit du message individuel de fin de quart. Sans base de données.
const assert = require('assert');
const { resolveFuelSaleEmployee, checkFuelSalesAttribution, SaleAttributionError } = require('../src/shift_sales_check');
const { individualMessage } = require('../src/shift_message');
let n = 0; const check = (l, f) => { f(); n++; console.log('✓ ' + l); };
const names = new Map([[1, 'Kontao Amadou'], [2, 'Traoré Fanta']]);
const thr = (fn, re) => assert.throws(fn, e => e instanceof SaleAttributionError && re.test(e.message));

check('la pompe fait foi : sans employé demandé → responsable de la pompe, même si l\'utilisateur connecté est un autre employé', () =>
  assert.strictEqual(resolveFuelSaleEmployee({ owners: [2], bodyEmpId: null, userEmpId: 1, pumpName: 'Pompe 2', names }), 2));
check('employé demandé = responsable : accepté', () => assert.strictEqual(resolveFuelSaleEmployee({ owners: [2], bodyEmpId: 2, userEmpId: 1, names }), 2));
check('BUG signalé : vente demandée au nom de l\'employé 1 sur la pompe de l\'employé 2 → refusée (409) avec les deux noms', () =>
  thr(() => resolveFuelSaleEmployee({ owners: [2], bodyEmpId: 1, userEmpId: 1, pumpName: 'Pompe 2', names }), /Pompe 2.*Traoré Fanta.*Kontao Amadou/));
check('pompe sans responsable : repli historique (demandé, puis utilisateur)', () => {
  assert.strictEqual(resolveFuelSaleEmployee({ owners: [], bodyEmpId: 2, userEmpId: 1, names }), 2);
  assert.strictEqual(resolveFuelSaleEmployee({ owners: [], bodyEmpId: null, userEmpId: 1, names }), 1);
  assert.strictEqual(resolveFuelSaleEmployee({ owners: [], bodyEmpId: null, userEmpId: null, names }), null);
});
check('pompe partagée par deux employés : choix explicite et valide exigé', () => {
  thr(() => resolveFuelSaleEmployee({ owners: [1, 2], bodyEmpId: null, names }), /partagée/);
  thr(() => resolveFuelSaleEmployee({ owners: [1, 2], bodyEmpId: 3, names }), /pas responsable/);
  assert.strictEqual(resolveFuelSaleEmployee({ owners: [1, 2, 2], bodyEmpId: 2, names }), 2);
});
check('fermeture : détecte les ventes mal rattachées et propose le responsable de la pompe', () => {
  const owners = new Map([[10, new Set([1])], [20, new Set([2])]]);
  const r = checkFuelSalesAttribution([
    { id: 1, pump_id: 10, employee_id: 1, total: 100 },   // correcte
    { id: 2, pump_id: 20, employee_id: 1, total: 58150 }, // mal rattachée
    { id: 3, pump_id: 20, employee_id: null, total: 500 }, // sans employé
    { id: 4, pump_id: 30, employee_id: 1, total: 900 },   // pompe sans responsable : ignorée
    { id: 5, pump_id: null, employee_id: 2, total: 50 }   // sans pompe : ignorée
  ], owners);
  assert.strictEqual(r.checked, 3); assert.deepStrictEqual(r.fixes.map(x => [x.sale_id, x.from, x.to]), [[2, 1, 2], [3, null, 2]]); assert.strictEqual(r.ambiguous.length, 0);
});
check('fermeture : tout est correct → aucune correction', () => assert.strictEqual(checkFuelSalesAttribution([{ id: 1, pump_id: 10, employee_id: 1, total: 1 }], new Map([[10, [1]]])).fixes.length, 0));

const shift = { number: 1, kind: 'personnalise', opened_at: '2026-11-08T00:53:00Z', closed_at: '2026-11-08T01:03:00Z' };
const mine = { employee_id: 1, name: 'Kontao Amadou', pumps: ['Pompe 1'], fuel_amount: 58150, fuel_liters: 62, declared_fuel: 43750, undeclared: 14400, non_cash: { mobile_money: 0, card: 0, credit: 0 },
  expected_cash: 78150, counted_cash: 50000, cash_gap: -28150, stock_gaps: [{ product: 'Essence', amount: -4.71 }, { product: 'Gasoil', amount: -40 }] };
const EXPECTED = `⛽ STATION HALIMATOU SERVICE
📋 RAPPORT INDIVIDUEL DE FIN DE QUART

🔖 Quart N° : 000001 (Personnalisé)

👤 Employé : Kontao Amadou
📅 Date : 08/11/2026
🕐 Ouverture : 00h53
🕐 Fermeture : 01h03
⏱️ Durée : 10 minutes

━━━━━━━━━━━━━━━━━━
⛽ 1. SITUATION DES VENTES

Pompe concernée : Pompe N° 1

💰 Total des ventes : 58 150 FCFA
🛢️ Volume distribué : 62 litres

• Montant déclaré à la saisie : 43 750 FCFA
• Montant non déclaré (comptabilisé en espèces) : 14 400 FCFA

Modes de paiement :
• Espèces : selon rapprochement de caisse
• Mobile Money : 0 FCFA
• Carte bancaire : 0 FCFA
• Crédit : 0 FCFA

━━━━━━━━━━━━━━━━━━
💵 2. SITUATION DE LA CAISSE

• Espèces attendues : 78 150 FCFA
• Espèces effectivement remises : 50 000 FCFA

🔴 ÉCART DE CAISSE : -28 150 FCFA

Un déficit de caisse de 28 150 FCFA est constaté à la clôture du quart.

━━━━━━━━━━━━━━━━━━
📦 3. ÉCARTS DE STOCK IMPUTÉS

• Essence : -4,71
• Gasoil : -40

Ces écarts sont enregistrés au titre du quart de Kontao Amadou.

━━━━━━━━━━━━━━━━━━
⚠️ 4. ANOMALIES SIGNALÉES

1️⃣ Écart de caisse imputé à Kontao Amadou : -28 150 FCFA.

2️⃣ Écart de stock Essence imputé à Kontao Amadou : -4,71.

3️⃣ Écart de stock Gasoil imputé à Kontao Amadou : -40.

━━━━━━━━━━━━━━━━━━
⚖️ 5. OBSERVATION ET RESPONSABILITÉ

Les anomalies constatées devront faire l'objet d'une vérification et d'explications de la part de l'employé concerné.

📌 IMPORTANT : Aucune retenue financière n'est automatique. Le gérant prend toute décision éventuelle après avoir entendu l'employé et examiné les éléments justificatifs.

━━━━━━━━━━━━━━━━━━
🏢 STATION HALIMATOU SERVICE
La Direction – Contrôle et suivi des opérations

📄 Fin du rapport – Quart N° 000001.`;
check('message individuel : IDENTIQUE au modèle demandé (caractère pour caractère)', () => {
  const got = individualMessage({ stationName: 'Station Halimatou Service', shift, mine });
  assert.strictEqual(got, EXPECTED);
});
check('message : caisse équilibrée, aucun écart, aucune anomalie', () => {
  const m = individualMessage({ stationName: 'X', shift, mine: { ...mine, cash_gap: 0, stock_gaps: [] } });
  assert.match(m, /🟢 ÉCART DE CAISSE : 0 FCFA/); assert.match(m, /équilibrée/); assert.match(m, /Aucun écart de stock imputé/); assert.match(m, /Aucune anomalie signalée/); assert.ok(!m.includes('Ces écarts sont enregistrés'));
});
check('message : excédent, durée > 1 h, anomalie manuelle et vente réattribuée', () => {
  const m = individualMessage({ stationName: 'X', shift: { ...shift, closed_at: '2026-11-08T02:13:00Z' }, mine: { ...mine, cash_gap: 1000, stock_gaps: [] },
    anomalies: [{ kind: 'autre', description: 'Pompe en panne 10 min', employee_id: 1 }, { kind: 'ecart_caisse', description: 'doublon', employee_id: 1 }, { kind: 'autre', description: 'Autre employé', employee_id: 2 }],
    fixes: [{ total: 5000, from: 'Traoré Fanta', to: 'Kontao Amadou' }] });
  assert.match(m, /Durée : 1 heure 20 minutes/); assert.match(m, /🟠 ÉCART DE CAISSE : \+1 000 FCFA/); assert.match(m, /excédent de caisse de 1 000 FCFA/);
  assert.match(m, /1️⃣ Écart de caisse imputé/); assert.match(m, /2️⃣ Pompe en panne 10 min\./); assert.match(m, /3️⃣ Vente de 5 000 FCFA initialement saisie au nom de Traoré Fanta, réattribuée à Kontao Amadou/);
  assert.ok(!m.includes('doublon') && !m.includes('Autre employé'));
});
check('unités : un écart de stock (quantité, ici -4.707 L brut) n\'est jamais exprimé en FCFA, un écart de caisse toujours', () => {
  const m = individualMessage({ stationName: 'X', shift, mine: { ...mine, stock_gaps: [{ product: 'Essence ', amount: -4.707 }, { product: 'Gasoil ', amount: -40 }] },
    anomalies: [{ kind: 'ecart_stock', description: 'Écart de stock Essence : -4.707', amount: -4.707, employee_id: 1 }, { kind: 'ecart_compteur', description: 'Ventes déclarées supérieures aux compteurs', amount: -3000, employee_id: 1 }] });
  const lines = m.split('\n');
  const stockLines = lines.filter(l => /Essence|Gasoil/.test(l));
  assert.ok(stockLines.length >= 4 && stockLines.every(l => !/FCFA/.test(l)), stockLines.join(' | '));
  assert.ok(lines.includes('• Essence : -4,71') && lines.includes('• Gasoil : -40'));
  assert.ok(lines.some(l => /^1️⃣ Écart de caisse imputé à Kontao Amadou : -28 150 FCFA\.$/.test(l)));
  assert.ok(!m.includes('-4.707') && !m.includes('-4,707'), 'quantité arrondie à 2 décimales, jamais de valeur brute');
  assert.ok(!/-32 ?[0-9]{3}|-28 ?[0-9]{3}[^ ]* ?FCFA.*stock/i.test(m) && !m.includes('32 854'), 'aucune somme caisse + stock');
  assert.ok(lines.filter(l => /FCFA/.test(l) && /stock/i.test(l)).length === 0, 'aucune ligne « stock » avec FCFA');
  assert.ok(!/3 000/.test(m), 'le montant d\'une anomalie n\'est pas affiché hors de sa description');
});
console.log(`\n${n} contrôles réussis.`);
