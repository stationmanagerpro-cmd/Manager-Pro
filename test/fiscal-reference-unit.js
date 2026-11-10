// Jeu de référence + validation de l'assistant d'activation (sans base) : npm run test:fiscal-wizard
const assert = require('assert');
const R = require('../src/fiscal_reference');
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };

// Tous les modules de l'audit existent
for (const c of ['tva', 'synthetique', 'ibic', 'is', 'its', 'inps', 'amo', 'cfe', 'tfp', 'logement', 'emploi_jeune', 'patente']) ok(R.has(c), 'module ' + c);

// Chaque paramètre est sourcé et jamais « validé » : aucune valeur officielle n'est affirmée
for (const code of R.CODES) {
  const d = R.describe(code);
  ok(d.presentation.role && d.presentation.legal_basis, code + ' : présentation');
  for (const p of d.params) {
    ok(p.reference && p.reference.source, `${code}.${p.key} : source`);
    ok(p.reference.status === 'a_confirmer' && !p.reference.verified_on, `${code}.${p.key} : statut à confirmer, non vérifié`);
  }
}

// Valeurs de référence (candidates de l'audit) : modifiables, jamais imposées quand les sources divergent
const get = (c, k) => R.describe(c).params.find(p => p.key === k);
ok(get('tva', 'standard_rate').default === 18, 'TVA 18 %');
ok(get('is', 'rate').default === 30 && get('ibic', 'rate').default === 30, 'IS / IBIC 30 %');
ok(get('is', 'imf_rate').default === 1, 'minimum forfaitaire 1 % du CA');
ok(get('synthetique', 'rate').default === 3, 'synthétique 3 %');
ok(get('synthetique', 'ca_threshold').default === null && get('synthetique', 'ca_threshold').contested && get('synthetique', 'ca_threshold').candidates.length === 2, 'seuil synthétique : choix obligatoire entre 30 M et 50 M');
ok(get('its', 'brackets').default === null && get('its', 'brackets').contested, 'barème ITS : version à choisir');
ok(get('cfe', 'rate').contested && get('cfe', 'rate').candidates.map(c => c.value).sort().join() === '3,3.5', 'CFE 3 % ou 3,5 % : contradiction signalée');
ok(get('tfp', 'rate').default === null, 'TFP : aucun taux préchargé (source introuvable)');
ok(get('inps', 'branches').default === null && get('inps', 'branches').contested, 'INPS : sources divergentes, choix obligatoire');
ok(get('its', 'family_married_pct').default === 10 && get('its', 'family_per_child_pct').default === 2.5 && get('its', 'family_max_children').default === 10, 'réductions familiales en %');
ok(get('amo', 'employee_rate').default === 3.06 && get('amo', 'employer_rate').default === 3.5, 'AMO 3,06 / 3,5');

// Aucun module ne s'active avec ses seules valeurs préchargées quand un choix est obligatoire
let v = R.validate('its', R.defaultsFor('its'));
ok(v.errors.some(e => e.key === 'brackets'), 'ITS : barème obligatoire');
v = R.validate('synthetique', R.defaultsFor('synthetique'));
ok(v.errors.some(e => e.key === 'ca_threshold'), 'synthétique : seuil obligatoire');
v = R.validate('tfp', {});
ok(v.errors.some(e => e.key === 'rate'), 'TFP : taux obligatoire');
v = R.validate('inps', {});
ok(v.errors.some(e => e.key === 'branches'), 'INPS : branches obligatoires');

// TVA : activable avec les valeurs de référence + les choix du contribuable
v = R.validate('tva', { ...R.defaultsFor('tva'), regime: 'reel' });
ok(v.errors.length === 0 && v.zero.length === 0, 'TVA valide');

// Taux nul ou vide : avertissement bloquant, sauf confirmation explicite
v = R.validate('cfe', { rate: 0 });
ok(v.zero.length === 1 && v.zero[0].key === 'rate', 'taux CFE à 0 : confirmation requise');
v = R.validate('cfe', { rate: 0 }, { confirmZero: ['rate'] });
ok(v.zero.length === 0 && v.errors.length === 0, 'taux nul confirmé explicitement accepté');
v = R.validate('cfe', {});
ok(v.errors.some(e => e.key === 'rate'), 'taux vide refusé');
v = R.validate('is', { ...R.defaultsFor('is'), imf_rate: 0 });
ok(v.zero.some(z => z.key === 'imf_rate'), 'minimum forfaitaire à 0 : confirmation requise');
// un champ qui peut légitimement être 0 ne bloque pas
v = R.validate('tva', { ...R.defaultsFor('tva'), regime: 'simplifie', non_deductible_pct: 0 });
ok(v.zero.length === 0, 'prorata 0 % légitime');

// Barèmes : candidat A accepté, tranche « de 175 001 » normalisée, trou refusé
const A = get('its', 'brackets').candidates[0].value;
v = R.validate('its', { ...R.defaultsFor('its'), brackets: A });
ok(v.errors.length === 0, 'ITS avec la version A : valide');
const shifted = A.map((b, i) => (i ? { ...b, from: b.from + 1 } : b));
v = R.validate('its', { ...R.defaultsFor('its'), brackets: shifted });
ok(v.errors.length === 0 && JSON.stringify(v.values.brackets) === JSON.stringify(A), 'tranches « de 175 001 » normalisées');
v = R.validate('its', { ...R.defaultsFor('its'), brackets: [{ from: 0, to: 100, rate: 0 }, { from: 500, to: null, rate: 5 }] });
ok(v.errors.some(e => e.key === 'brackets'), 'barème avec trou refusé');

// INPS : taux manquant (candidat 2) refusé ; branche à 0/0 demande confirmation
const c2 = get('inps', 'branches').candidates[1].value;
v = R.validate('inps', { branches: c2 });
ok(v.errors.some(e => e.key === 'branches'), 'INPS : part salariale retraite à renseigner');
const complete = c2.map(b => ({ ...b, employee_rate: b.employee_rate == null ? 3.6 : b.employee_rate }));
v = R.validate('inps', { branches: complete });
ok(v.errors.length === 0, 'INPS complété : valide');
v = R.validate('inps', { branches: [{ code: 'X', label: 'X', employee_rate: 0, employer_rate: 0 }] });
ok(v.zero.length === 1, 'branche à 0 % / 0 % : confirmation requise');

// Taxes complémentaires : rien de préchargé, mode et texte obligatoires
v = R.validate('patente', {});
ok(v.errors.some(e => e.key === 'calc_mode') && v.errors.some(e => e.key === 'legal_ref'), 'patente : paramètres à renseigner');
v = R.validate('patente', { calc_mode: 'fixed', fixed_amount: 50000, base_label: 'Activité', legal_ref: 'Texte X' });
ok(v.errors.length === 0, 'patente forfaitaire valide');

// « Personnalisé » : détecté par rapport à la valeur officielle
let cust = R.customizedKeys('tva', { ...R.defaultsFor('tva'), standard_rate: 19 });
ok(cust.length === 1 && cust[0] === 'standard_rate', 'TVA 19 % marquée personnalisée');
ok(R.customizedKeys('tva', R.defaultsFor('tva')).length === 0, 'valeurs de référence : rien de personnalisé');

console.log(`fiscal-reference-unit : ${n} vérifications OK`);
