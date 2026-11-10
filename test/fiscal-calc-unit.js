// Test unitaire du moteur de calcul fiscal (sans base) : npm run test:fiscal-calc
// Les barèmes ci-dessous sont des JEUX D'ESSAI arithmétiques (candidats relevés dans l'audit du 31/10/2026),
// pas des valeurs officielles validées : les résultats doivent être confirmés par un expert-comptable.
const assert = require('assert');
const C = require('../src/fiscal_calc');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} : ${a} ≠ ${b}`); n++; };

// --- Barème (version A de l'audit) saisi sous forme « bornes hautes »
const A = [
  { from: 0, to: 175000, rate: 0 }, { from: 175000, to: 600000, rate: 5 }, { from: 600000, to: 1200000, rate: 13 },
  { from: 1200000, to: 1800000, rate: 20 }, { from: 1800000, to: 2400000, rate: 28 }, { from: 2400000, to: 3500000, rate: 34 },
  { from: 3500000, to: null, rate: 40 }
];
// Même barème saisi sous la forme « de 175 001 » : doit donner exactement les mêmes résultats (pas de décalage d'un franc)
const A1 = A.map((b, i) => (i === 0 ? { ...b } : { ...b, from: b.from + 1 }));
const n1 = C.normalizeBrackets(A1);
eq(n1.errors.length, 0, 'tranches « de 175 001 » acceptées');
eq(JSON.stringify(n1.brackets), JSON.stringify(A), 'normalisation sans décalage d\'un franc');
eq(C.taxByBrackets(175001, C.normalizeBrackets(A).brackets).tax, 0.05, 'le 1 FCFA au-dessus de 175 000 est taxé à 5 %');
eq(C.taxByBrackets(175001, n1.brackets).tax, 0.05, 'idem avec la saisie « de 175 001 »');

// --- Erreurs de barème
ok(C.normalizeBrackets([]).errors.length > 0, 'barème vide refusé');
ok(C.normalizeBrackets([{ from: 0, to: 100, rate: 0 }, { from: 500, to: null, rate: 5 }]).errors.length > 0, 'trou entre tranches refusé');
ok(C.normalizeBrackets([{ from: 0, to: 100, rate: 0 }, { from: 100, to: 200, rate: 5 }]).errors.length > 0, 'dernière tranche plafonnée refusée');
ok(C.normalizeBrackets([{ from: 0, to: null, rate: 150 }]).errors.length > 0, 'taux > 100 refusé');

// --- ITS : cas de contrôle (calcul manuel)
// brut 300 000, cotisations salariales 20 000 → base mensuelle 280 000 → annuelle 3 360 000
// impôt brut annuel = 21 250 + 78 000 + 120 000 + 168 000 + 326 400 = 713 650
const params = { brackets: A, annualize: 12, deduct_contributions: true, family: { single_pct: 0, married_pct: 10, per_child_pct: 2.5, max_children: 10 } };
let r = C.computeAnnualITS({ gross: 300000, employeeContributions: 20000 }, params, { family_status: 'Célibataire', children: 0 });
eq(r.detail.gross_tax_annual, 713650, 'impôt brut annuel');
eq(r.amount, 59470.83, 'ITS mensuel célibataire sans enfant');
// marié, 2 enfants : réduction 10 + 2×2,5 = 15 % de l'impôt brut → 606 602,50 / 12
r = C.computeAnnualITS({ gross: 300000, employeeContributions: 20000 }, params, { family_status: 'Marié(e)', children: 2 });
eq(r.detail.reduction_pct, 15, 'réduction familiale 15 %');
eq(r.amount, 50550.21, 'ITS mensuel marié 2 enfants');
// plafond du nombre d'enfants (10) et plafond de réduction 100 %
r = C.computeAnnualITS({ gross: 300000, employeeContributions: 20000 }, params, { family_status: 'marie', children: 25 });
eq(r.detail.children_counted, 10, 'enfants plafonnés à 10');
eq(r.detail.reduction_pct, 35, '10 % + 10 × 2,5 % = 35 %');
// sans déduction des cotisations : assiette plus large → impôt plus élevé
const noDed = C.computeAnnualITS({ gross: 300000, employeeContributions: 20000 }, { ...params, deduct_contributions: false }, { children: 0 });
ok(noDed.amount > 59470.83, 'sans déduction des cotisations, l\'ITS est plus élevé');
// salaire sous la première tranche : 0
eq(C.computeAnnualITS({ gross: 14000 }, params, {}).amount, 0, 'ITS nul sous la tranche à 0 %');
// barème invalide : aucun calcul, motif explicite
r = C.computeAnnualITS({ gross: 300000 }, { brackets: [] }, {});
ok(r.detail.skipped === true && r.amount === 0, 'barème invalide → pas de calcul');
// annualisation désactivée : barème appliqué tel quel au mois (cas legacy explicite)
eq(C.computeAnnualITS({ gross: 1000000 }, { brackets: A, annualize: false, deduct_contributions: false, family: {} }, {}).detail.annualization_factor, 1, 'facteur 1 sans annualisation');

// --- IS / IBIC avec impôt minimum forfaitaire
// CA 100 000 000, charges 99 000 000 → résultat 1 000 000 ; 30 % = 300 000 ; minimum 1 % du CA = 1 000 000 → minimum appliqué
let p = C.computeProfitTax({ ca: 100000000, charges: 99000000 }, { rate: 30, imf_rate: 1 });
eq(p.impot_brut_taux_normal, 300000, 'impôt au taux normal');
eq(p.impot_minimum_forfaitaire, 1000000, 'minimum forfaitaire 1 % du CA');
eq(p.minimum_applique, true, 'minimum appliqué');
eq(p.impot_du_estime, 1000000, 'impôt dû = minimum');
// déficit : impôt normal 0, minimum dû quand même
p = C.computeProfitTax({ ca: 50000000, charges: 60000000 }, { rate: 30, imf_rate: 1 });
eq(p.impot_brut_taux_normal, 0, 'pas d\'impôt normal en déficit');
eq(p.impot_du_estime, 500000, 'minimum dû en déficit');
// bénéfice élevé : l'impôt normal l'emporte, acomptes déduits
p = C.computeProfitTax({ ca: 100000000, charges: 60000000, acomptes: 5000000 }, { rate: 30, imf_rate: 1 });
eq(p.impot_du_estime, 12000000, 'impôt normal supérieur au minimum');
eq(p.solde_estime, 7000000, 'solde après acomptes');
// sans paramètre de minimum : aucun minimum
eq(C.computeProfitTax({ ca: 1000, charges: 2000 }, { rate: 30 }).impot_du_estime, 0, 'pas de minimum si non paramétré');
// report des déficits limité dans le temps
const dd = C.usableDeficits([{ year: 2020, amount: 100 }, { year: 2024, amount: 50 }], 2026, 3);
eq(dd.total, 50, 'déficit de 2024 imputable'); eq(dd.excluded, 100, 'déficit de 2020 hors durée de report');
eq(C.usableDeficits([{ year: 2000, amount: 70 }], 2026, null).total, 70, 'sans durée paramétrée, tout est imputable');

// --- Synthétique
let s = C.computeSynthetic({ ca: 20000000 }, { rate: 3, ca_threshold: 30000000 });
eq(s.estimation, 600000, 'synthétique 3 % de 20 M'); eq(s.seuil_depasse, false, 'seuil non dépassé');
s = C.computeSynthetic({ ca: 20000000, annualCa: 35000000 }, { rate: 3, ca_threshold: 30000000 });
eq(s.seuil_depasse, true, 'seuil dépassé sur CA annuel');

// --- TVA
const t = C.computeTvaNet({ collected: 1800000, deductible: 900000 }, { non_deductible_pct: 10, credit_anterieur: 50000 });
eq(t.deductible_retenue, 810000, 'TVA déductible après prorata'); eq(t.net, 940000, 'TVA nette');

// --- Taxe simple
eq(C.computeSimpleTax(10000000, { rate: 3.5 }), 350000, 'taxe au taux 3,5 %');
eq(C.computeSimpleTax(0, { calc_mode: 'fixed', fixed_amount: 25000 }), 25000, 'montant forfaitaire');

console.log(`fiscal-calc-unit : ${n} vérifications OK`);
