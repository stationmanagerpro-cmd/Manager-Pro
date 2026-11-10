'use strict';
/**
 * Jeu de données de référence Fiscalité — Mali (VERSIONNÉ, mis à jour par l'éditeur à chaque loi de finances).
 *
 * IMPORTANT — aucune valeur ci-dessous n'est « validée » juridiquement. Elles proviennent des sources publiques citées
 * dans l'audit du 31/10/2026 (DGI Mali, CGI, FMI, ministère des Finances), parfois anciennes ou contradictoires :
 *  - `default`    : valeur préremplie dans l'assistant (modifiable). Absente quand les sources divergent ou n'existent pas ;
 *  - `contested`  : les sources se contredisent → l'administrateur doit CHOISIR (valeurs relevées dans `candidates`) ;
 *  - `status`     : toujours 'a_confirmer' tant que la DGI / un expert-comptable n'a pas confirmé.
 * Une mise à jour de ce fichier n'écrase JAMAIS les paramètres déjà confirmés par un client : l'assistant propose la comparaison.
 */
const { normalizeBrackets } = require('./fiscal_calc');

const DATASET_VERSION = '2026-10-31.1';
const COMPILED_ON = '2026-10-31';

const S = {
  cgi: 'Code général des impôts du Mali (version consultée)',
  cgiOld: 'Code général des impôts du Mali (ancienne version)',
  dgi: 'Site de la DGI Mali (page consultée)',
  dgiOld: 'Source DGI ancienne',
  inps: 'INPS — sources divergentes',
  amo: 'Valeurs préchargées dans l\'application (indicatives)',
  none: 'Aucune source fiable trouvée'
};
const ref = (source, note) => ({ source, effective: null, verified_on: null, compiled_on: COMPILED_ON, status: 'a_confirmer', note: note || '' });

const BRACKETS_A = [
  { from: 0, to: 175000, rate: 0 }, { from: 175000, to: 600000, rate: 5 }, { from: 600000, to: 1200000, rate: 13 },
  { from: 1200000, to: 1800000, rate: 20 }, { from: 1800000, to: 2400000, rate: 28 }, { from: 2400000, to: 3500000, rate: 34 },
  { from: 3500000, to: null, rate: 40 }
];

// Paramètres communs à tous les impôts : calendrier des échéances et pénalités (aucune valeur officielle préchargée)
const COMMON = [
  { key: 'periodicity', label: 'Périodicité de déclaration / paiement', type: 'select', options: [['mensuelle', 'Mensuelle'], ['trimestrielle', 'Trimestrielle'], ['annuelle', 'Annuelle']], required: false, help: 'Utilisée pour générer le calendrier des échéances.', ref: ref(S.none, 'À renseigner d\'après le texte applicable.') },
  { key: 'due_day', label: 'Jour limite dans la période (1 à 31)', type: 'int', min: 1, max: 31, required: false, help: 'Jour du mois (ou du mois suivant) avant lequel déclarer / payer.', ref: ref(S.none) },
  { key: 'late_penalty_pct', label: 'Pénalité de retard (% du montant dû)', type: 'percent', required: false, allowZero: true, help: 'Barème de pénalités personnalisable.', ref: ref(S.none) }
];

const GENERIC_PARAMS = [
  { key: 'calc_mode', label: 'Mode de calcul', type: 'select', options: [['rate', 'Taux sur une base'], ['fixed', 'Montant forfaitaire']], required: true, ref: ref(S.none, 'Aucune valeur officielle préchargée : renseigner d\'après le texte applicable.') },
  { key: 'rate', label: 'Taux (%)', type: 'percent', required: true, requiredIf: { key: 'calc_mode', value: 'rate' }, ref: ref(S.none) },
  { key: 'fixed_amount', label: 'Montant forfaitaire par période', type: 'amount', required: true, requiredIf: { key: 'calc_mode', value: 'fixed' }, ref: ref(S.none) },
  { key: 'base_label', label: 'Base d\'imposition (libellé)', type: 'text', required: true, help: 'Ex. : loyers versés, chiffre d\'affaires, paiements aux tiers.', ref: ref(S.none) },
  { key: 'legal_ref', label: 'Texte / article appliqué', type: 'text', required: true, help: 'Référence du texte sur lequel reposent ces paramètres.', ref: ref(S.none) }
];

const MODULES = {
  tva: {
    label: 'TVA — Taxe sur la valeur ajoutée', group: 'impot',
    presentation: {
      role: 'Taxe sur la valeur ajoutée : TVA collectée sur les ventes, déductible sur les achats, nette et crédit éventuel.',
      concerned: 'Les contribuables assujettis à la TVA selon leur régime.',
      periodicity: 'Selon le régime (réel ou simplifié) : à renseigner à l\'étape Paramètres.',
      legal_basis: S.cgi + ' — références exactes à confirmer auprès de la DGI.'
    },
    params: [
      { key: 'standard_rate', label: 'Taux normal (%)', type: 'percent', required: true, default: 18, ref: ref(S.cgi + ' / ' + S.dgi, 'Valeur concordante dans plusieurs sources.') },
      { key: 'reduced_rates', label: 'Taux réduits (libellé + taux)', type: 'rates', required: false, default: [], help: 'Optionnel : taux réduits applicables à certains produits.', ref: ref(S.none) },
      { key: 'exemptions', label: 'Exonérations / régimes particuliers (hydrocarbures…)', type: 'text', required: false, ref: ref(S.none) },
      { key: 'regime', label: 'Régime', type: 'select', options: [['reel', 'Réel'], ['simplifie', 'Simplifié']], required: true, help: 'Choix du contribuable.', ref: ref(S.none) },
      { key: 'include_fuel_counters', label: 'Inclure le carburant des compteurs de pompes (quarts clôturés)', type: 'bool', required: true, default: true, help: 'Aligne la base TVA sur la comptabilité (carburant inclus).', ref: ref('Cohérence avec la comptabilité de l\'application') },
      { key: 'purchase_rate_fallback', label: 'Taux appliqué aux achats sans taux saisi (%)', type: 'percent', required: false, allowZero: true, help: 'Sans ce taux, la TVA déductible n\'est calculée que sur les lignes d\'achat qui portent un taux ; une alerte est alors affichée.', ref: ref(S.none) },
      { key: 'non_deductible_pct', label: 'Part de TVA non déductible / prorata (%)', type: 'percent', required: true, default: 0, allowZero: true, ref: ref(S.none, 'Dépenses non déductibles, prorata : à paramétrer selon votre situation.') },
      { key: 'credit_anterieur', label: 'Crédit de TVA antérieur', type: 'amount', required: true, default: 0, allowZero: true, ref: ref(S.none) },
      ...COMMON
    ]
  },
  synthetique: {
    label: 'Impôt synthétique', group: 'impot',
    presentation: {
      role: 'Impôt forfaitaire sur le chiffre d\'affaires annuel hors taxe des petits contribuables.',
      concerned: 'Contribuables dont le chiffre d\'affaires reste sous le seuil du régime.',
      periodicity: 'Annuelle (paiement selon calendrier à renseigner).',
      legal_basis: S.cgi + ' / ' + S.dgi + ' — seuil à trancher.'
    },
    params: [
      { key: 'rate', label: 'Taux (% du chiffre d\'affaires annuel HT)', type: 'percent', required: true, default: 3, ref: ref(S.dgi, '3 % du chiffre d\'affaires annuel hors taxe.') },
      { key: 'ca_threshold', label: 'Seuil de chiffre d\'affaires du régime', type: 'amount', required: true, contested: true,
        candidates: [{ id: 'cgi', label: '30 millions (CGI)', value: 30000000, source: S.cgi }, { id: 'dgi', label: 'Moins de 50 millions (page DGI)', value: 50000000, source: S.dgi }],
        help: 'Les sources divergent : choisissez la valeur confirmée par la DGI. Au-dessus du seuil, une alerte de bascule vers le régime réel s\'affiche.', ref: ref('CGI : 30 M ; page DGI : < 50 M', 'À trancher.') },
      { key: 'fixed_amount', label: 'Tarif forfaitaire (prioritaire sur le taux si renseigné)', type: 'amount', required: false, ref: ref(S.none) },
      ...COMMON
    ]
  },
  ibic: {
    label: 'IBIC — Bénéfices industriels et commerciaux', group: 'impot',
    presentation: {
      role: 'Impôt sur les bénéfices industriels et commerciaux, avec impôt minimum forfaitaire sur le chiffre d\'affaires.',
      concerned: 'Les entreprises individuelles relevant du régime réel.',
      periodicity: 'Annuelle, avec acomptes selon calendrier à renseigner.',
      legal_basis: S.cgi + ' / ' + S.dgiOld + ' — à confirmer.'
    },
    params: null   // défini plus bas (partagé avec IS)
  },
  is: {
    label: 'IS — Impôt sur les sociétés', group: 'impot',
    presentation: {
      role: 'Impôt sur les bénéfices des sociétés, avec impôt minimum forfaitaire sur le chiffre d\'affaires.',
      concerned: 'Les personnes morales relevant de l\'IS.',
      periodicity: 'Annuelle, avec acomptes selon calendrier à renseigner.',
      legal_basis: S.cgi + ' / ' + S.dgiOld + ' — à confirmer.'
    },
    params: null
  },
  its: {
    label: 'ITS — Impôt sur les traitements et salaires', group: 'paie', payroll: true,
    presentation: {
      role: 'Retenue à la source sur les salaires : barème annuel appliqué au salaire annualisé, réductions pour charges de famille.',
      concerned: 'L\'employeur (retenue) et les salariés.',
      periodicity: 'Mensuelle (retenue sur chaque bulletin).',
      legal_basis: S.cgi + ' — version du barème en vigueur en 2026 à déterminer.'
    },
    params: [
      { key: 'brackets', label: 'Barème ANNUEL (tranches et taux)', type: 'brackets', required: true, contested: true,
        candidates: [{ id: 'A', label: 'Version A (6 tranches de 0 à 40 %)', value: BRACKETS_A, source: 'Version A relevée dans l\'audit' }],
        help: 'Deux versions circulent (A ci-contre ; B = loi 2016-10 : 0 % jusqu\'à 330 000, 5 % de 330 001 à 578 400, etc., à saisir). Déterminez la version en vigueur en 2026. Chaque tranche commence où la précédente finit ; la dernière est sans plafond.', ref: ref('Version A ou B', 'À trancher.') },
      { key: 'annualize', label: 'Annualisation du salaire mensuel', type: 'select', options: [['12', 'Annualiser (× 12) — barème annuel'], ['1', 'Aucune (barème appliqué au mois)']], required: true, default: '12', ref: ref('Barème officiel annuel (audit 31/10/2026)') },
      { key: 'deduct_contributions', label: 'Déduire les cotisations salariales (INPS, AMO) de l\'assiette', type: 'bool', required: true, default: true, ref: ref(S.cgi) },
      { key: 'family_single_pct', label: 'Réduction célibataire / sans conjoint (% de l\'impôt brut)', type: 'percent', required: true, default: 0, allowZero: true, ref: ref(S.cgi) },
      { key: 'family_married_pct', label: 'Réduction marié sans enfant (% de l\'impôt brut)', type: 'percent', required: true, default: 10, ref: ref(S.cgi) },
      { key: 'family_per_child_pct', label: 'Réduction par enfant à charge (% de l\'impôt brut)', type: 'percent', required: true, default: 2.5, ref: ref(S.cgi) },
      { key: 'family_max_children', label: 'Nombre maximum d\'enfants pris en compte', type: 'int', min: 0, max: 30, required: true, default: 10, ref: ref(S.cgi) },
      { key: 'exempt_note', label: 'Traitements exonérés (note)', type: 'text', required: false, ref: ref(S.none) },
      ...COMMON
    ]
  },
  inps: {
    label: 'INPS — Cotisations sociales', group: 'paie', payroll: true,
    presentation: {
      role: 'Cotisations de sécurité sociale par branche (retraite, prestations familiales, accidents du travail, autre).',
      concerned: 'L\'employeur et les salariés.',
      periodicity: 'Mensuelle ou trimestrielle selon votre situation.',
      legal_basis: 'INPS — sources divergentes, à confirmer auprès de l\'INPS.'
    },
    params: [
      { key: 'branches', label: 'Branches de cotisation', type: 'branches', required: true, contested: true,
        candidates: [
          { id: 'src1', label: 'Source 1 : retraite 3,6 % salarié / 5,4 % employeur', source: S.inps,
            value: [{ code: 'RETRAITE', label: 'Retraite', employee_rate: 3.6, employer_rate: 5.4, ceiling: null }] },
          { id: 'src2', label: 'Source 2 : 16 % employeur (PF 7 + AT/MP 2,5 + retraite 6,5) — part salarié à renseigner', source: S.inps,
            value: [{ code: 'PF', label: 'Prestations familiales', employee_rate: 0, employer_rate: 7, ceiling: null },
              { code: 'ATMP', label: 'Accidents du travail', employee_rate: 0, employer_rate: 2.5, ceiling: null },
              { code: 'RETRAITE', label: 'Retraite', employee_rate: null, employer_rate: 6.5, ceiling: null }] }
        ],
        help: 'Les sources divergent : choisissez une base de départ puis corrigez-la selon l\'INPS. Un taux à 0 doit être confirmé explicitement.', ref: ref(S.inps, 'À confirmer auprès de l\'INPS.') },
      ...COMMON
    ]
  },
  amo: {
    label: 'AMO — Assurance maladie obligatoire', group: 'paie', payroll: true,
    presentation: {
      role: 'Cotisations d\'assurance maladie obligatoire (part salarié et part employeur).',
      concerned: 'L\'employeur et les salariés.',
      periodicity: 'Mensuelle ou trimestrielle selon votre situation.',
      legal_basis: 'Valeurs préchargées dans l\'application — à confirmer.'
    },
    params: [
      { key: 'employee_rate', label: 'Taux salarié (%)', type: 'percent', required: true, default: 3.06, contested: true,
        candidates: [{ id: 'split', label: '3,5 % partagé à parts égales (1,75 % salarié)', value: 1.75, source: 'Autre source' }], ref: ref(S.amo, 'Autre source : 3,5 % partagé à parts égales.') },
      { key: 'employer_rate', label: 'Taux employeur (%)', type: 'percent', required: true, default: 3.5, contested: true,
        candidates: [{ id: 'split', label: '3,5 % partagé à parts égales (1,75 % employeur)', value: 1.75, source: 'Autre source' }], ref: ref(S.amo, 'Autre source : 3,5 % partagé à parts égales.') },
      { key: 'ceiling', label: 'Plafond d\'assiette', type: 'amount', required: false, ref: ref(S.none) },
      ...COMMON
    ]
  },
  cfe: {
    label: 'CFE — Contribution forfaitaire à la charge des employeurs', group: 'paie', payroll: true,
    presentation: {
      role: 'Contribution calculée sur la masse salariale brute, à la charge de l\'employeur.',
      concerned: 'Les employeurs.',
      periodicity: 'Mensuelle ou annuelle selon le texte applicable.',
      legal_basis: S.dgi + ' / ' + S.cgiOld + ' — taux contradictoires.'
    },
    params: [
      { key: 'rate', label: 'Taux (% de la masse salariale brute)', type: 'percent', required: true, default: 3.5, contested: true,
        candidates: [{ id: 'dgi', label: '3,5 % (page DGI)', value: 3.5, source: S.dgi }, { id: 'cgi', label: '3 % (ancienne version du CGI)', value: 3, source: S.cgiOld }],
        help: 'Contradiction entre les sources : confirmez le taux auprès de la DGI.', ref: ref('Page DGI : 3,5 % ; ancien CGI : 3 %', 'Contradiction à lever.') },
      { key: 'exemptions', label: 'Exonérations (note)', type: 'text', required: false, ref: ref(S.none) },
      ...COMMON
    ]
  },
  tfp: {
    label: 'TFP — Taxe de formation professionnelle', group: 'paie', payroll: true,
    presentation: {
      role: 'Taxe assise sur la masse salariale brute, à la charge de l\'employeur.',
      concerned: 'Les employeurs.',
      periodicity: 'À renseigner d\'après le texte applicable.',
      legal_basis: 'Aucune source fiable trouvée — à renseigner.'
    },
    params: [
      { key: 'rate', label: 'Taux (% de la masse salariale brute)', type: 'percent', required: true, ref: ref(S.none, 'Taux non trouvé de source fiable : à renseigner.') },
      { key: 'exemptions', label: 'Exonérations (note)', type: 'text', required: false, ref: ref(S.none) },
      ...COMMON
    ]
  }
};

const profitParams = () => [
  { key: 'rate', label: 'Taux de l\'impôt sur le bénéfice (%)', type: 'percent', required: true, default: 30, ref: ref(S.dgiOld, '30 % du bénéfice.') },
  { key: 'imf_rate', label: 'Impôt minimum forfaitaire (% du chiffre d\'affaires HT)', type: 'percent', required: true, default: 1, ref: ref(S.dgiOld, 'Minimum de 1 % du chiffre d\'affaires hors taxe.') },
  { key: 'imf_min_amount', label: 'Montant plancher du minimum forfaitaire', type: 'amount', required: false, ref: ref(S.none) },
  { key: 'regime_ca_threshold', label: 'Seuil de chiffre d\'affaires du régime (information)', type: 'amount', required: false, ref: ref(S.none) },
  { key: 'deficit_carry_years', label: 'Durée de report des déficits (années)', type: 'int', min: 0, max: 20, required: false, help: 'Vide = pas de limite appliquée (une alerte le signale).', ref: ref(S.none) },
  ...COMMON
];
MODULES.ibic.params = profitParams();
MODULES.is.params = profitParams();

// Taxes complémentaires : aucune valeur officielle préchargée
const GENERIC = {
  logement: ['Taxe de logement', 'Taxe sur les logements / avantages en nature selon le texte applicable.'],
  emploi_jeune: ['Taxe emploi-jeune', 'Taxe destinée au financement de l\'emploi des jeunes, selon le texte applicable.'],
  patente: ['Patente', 'Contribution annuelle liée à l\'exercice d\'une activité, selon le texte applicable.'],
  retenues: ['Retenues à la source', 'Retenues opérées sur des paiements à des tiers, selon le texte applicable.'],
  autres: ['Autres impôts et taxes', 'Tout autre impôt ou taxe, selon le texte applicable.']
};
for (const [code, [label, role]] of Object.entries(GENERIC)) {
  MODULES[code] = {
    label, group: 'complementaire',
    presentation: { role, concerned: 'Selon le texte applicable.', periodicity: 'À renseigner.', legal_basis: 'Aucune valeur officielle préchargée : à renseigner d\'après le texte applicable.' },
    params: [...GENERIC_PARAMS, ...COMMON]
  };
}

const CODES = Object.keys(MODULES);
const has = code => Object.prototype.hasOwnProperty.call(MODULES, code);

const isEmpty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0 && false);
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Valeurs par défaut du jeu de référence (paramètres qui en ont une). */
function defaultsFor(code) {
  const out = {};
  for (const p of MODULES[code].params) if (p.default !== undefined) out[p.key] = JSON.parse(JSON.stringify(p.default));
  return out;
}

/** Description complète d'un module pour l'assistant (présentation, paramètres sourcés, valeurs de référence). */
function describe(code) {
  const m = MODULES[code];
  return {
    code, label: m.label, group: m.group, payroll: !!m.payroll, presentation: m.presentation,
    dataset_version: DATASET_VERSION, compiled_on: COMPILED_ON,
    params: m.params.map(p => ({
      key: p.key, label: p.label, type: p.type, unit: p.type === 'percent' ? '%' : null, required: !!p.required, requiredIf: p.requiredIf || null,
      allow_zero: !!p.allowZero, min: p.min ?? null, max: p.max ?? null, options: p.options || null, help: p.help || '',
      default: p.default === undefined ? null : p.default, has_default: p.default !== undefined,
      contested: !!p.contested, candidates: p.candidates || [], reference: p.ref
    }))
  };
}

const requiredNow = (p, vals) => !!p.required && (!p.requiredIf || String(vals[p.requiredIf.key]) === String(p.requiredIf.value));

/**
 * Valide les paramètres saisis dans l'assistant.
 * - erreurs bloquantes : champ obligatoire vide, type/plage invalide, barème incohérent ;
 * - avertissements bloquants de taux nul : un taux resté à 0 ne passe que s'il figure dans `confirmZero`.
 * @returns {{errors:Array<{key:string,message:string}>, zero:Array<{key:string,label:string}>, values:object}}
 */
function validate(code, input, opts = {}) {
  const spec = MODULES[code];
  const confirmZero = new Set(opts.confirmZero || []);
  const errors = [], zero = [], values = {};
  const src = input && typeof input === 'object' ? input : {};
  for (const p of spec.params) {
    let v = src[p.key];
    if (v === '' || v === undefined) v = null;
    const need = requiredNow(p, src);
    if (p.type === 'percent' || p.type === 'amount' || p.type === 'int') {
      if (v === null) { if (need) errors.push({ key: p.key, message: 'Champ obligatoire.' }); values[p.key] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n)) { errors.push({ key: p.key, message: 'Nombre invalide.' }); continue; }
      const lo = p.min != null ? p.min : 0, hi = p.max != null ? p.max : (p.type === 'percent' ? 100 : Number.MAX_SAFE_INTEGER);
      if (n < lo || n > hi) { errors.push({ key: p.key, message: `Valeur hors de ${lo} à ${hi}.` }); continue; }
      if (p.type === 'int' && !Number.isInteger(n)) { errors.push({ key: p.key, message: 'Nombre entier attendu.' }); continue; }
      values[p.key] = n;
      if (n === 0 && need && !p.allowZero && !confirmZero.has(p.key)) zero.push({ key: p.key, label: p.label });
    } else if (p.type === 'bool') {
      if (v === null) { if (need) errors.push({ key: p.key, message: 'Choix obligatoire.' }); values[p.key] = null; continue; }
      values[p.key] = v === true || v === 'true' || v === 1 || v === '1';
    } else if (p.type === 'select') {
      if (v === null) { if (need) errors.push({ key: p.key, message: 'Choix obligatoire.' }); values[p.key] = null; continue; }
      if (!p.options.some(o => String(o[0]) === String(v))) { errors.push({ key: p.key, message: 'Choix invalide.' }); continue; }
      values[p.key] = String(v);
    } else if (p.type === 'text') {
      const t = v === null ? null : String(v).trim().slice(0, 500);
      if (!t && need) errors.push({ key: p.key, message: 'Champ obligatoire.' });
      values[p.key] = t || null;
    } else if (p.type === 'rates') {
      const list = Array.isArray(v) ? v : [];
      const clean = [];
      list.forEach((x, i) => {
        const rate = Number(x && x.rate), label = String((x && x.label) || '').trim();
        if (!label || !Number.isFinite(rate) || rate < 0 || rate > 100) errors.push({ key: p.key, message: `Taux réduit n° ${i + 1} invalide (libellé et taux de 0 à 100).` });
        else clean.push({ label: label.slice(0, 80), rate });
      });
      values[p.key] = clean;
    } else if (p.type === 'brackets') {
      if (v === null || !Array.isArray(v) || !v.length) { if (need) errors.push({ key: p.key, message: 'Barème obligatoire : choisissez une version ou saisissez les tranches.' }); values[p.key] = null; continue; }
      const nb = normalizeBrackets(v);
      if (nb.errors.length) { errors.push({ key: p.key, message: nb.errors[0] }); continue; }
      values[p.key] = nb.brackets;
      if (nb.brackets.every(b => b.rate === 0) && !confirmZero.has(p.key)) zero.push({ key: p.key, label: p.label });
    } else if (p.type === 'branches') {
      if (!Array.isArray(v) || !v.length) { if (need) errors.push({ key: p.key, message: 'Saisissez au moins une branche.' }); values[p.key] = null; continue; }
      const clean = [], seen = new Set();
      v.forEach((b, i) => {
        const bcode = String((b && b.code) || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 30);
        const label = String((b && b.label) || '').trim().slice(0, 80);
        const er = b && b.employee_rate, pr = b && b.employer_rate;
        const e = er === '' || er == null ? NaN : Number(er), m = pr === '' || pr == null ? NaN : Number(pr);
        const ceil = b && b.ceiling !== '' && b.ceiling != null ? Number(b.ceiling) : null;
        if (!bcode || !label) errors.push({ key: p.key, message: `Branche n° ${i + 1} : code et libellé obligatoires.` });
        else if (seen.has(bcode)) errors.push({ key: p.key, message: `Branche « ${bcode} » en double.` });
        else if (!Number.isFinite(e) || !Number.isFinite(m) || e < 0 || e > 100 || m < 0 || m > 100) errors.push({ key: p.key, message: `Branche « ${bcode} » : renseignez le taux salarié ET le taux employeur (0 à 100).` });
        else if (ceil !== null && (!Number.isFinite(ceil) || ceil < 0)) errors.push({ key: p.key, message: `Branche « ${bcode} » : plafond invalide.` });
        else {
          seen.add(bcode); clean.push({ code: bcode, label, employee_rate: e, employer_rate: m, ceiling: ceil });
          if (e === 0 && m === 0 && !confirmZero.has(`${p.key}.${bcode}`)) zero.push({ key: `${p.key}.${bcode}`, label: `Branche ${bcode} : taux salarié et employeur à 0` });
        }
      });
      values[p.key] = clean;
    }
  }
  return { errors, zero, values };
}

/** Clés dont la valeur diffère de la valeur officielle de référence (« personnalisé »). */
function customizedKeys(code, values) {
  const out = [];
  for (const p of MODULES[code].params) {
    if (p.default === undefined) continue;
    const v = values[p.key];
    if (v === undefined) continue;
    const norm = p.type === 'select' || p.type === 'bool' ? String(v) : v;
    const d = p.type === 'select' || p.type === 'bool' ? String(p.default) : p.default;
    if (!deepEq(norm, d)) out.push(p.key);
  }
  return out;
}

/** Comparaison avec le jeu de référence courant (pour proposer — jamais imposer — une mise à jour). */
function compareToReference(code, values) {
  const d = defaultsFor(code);
  return Object.keys(d).map(k => ({ key: k, current: values[k] ?? null, reference: d[k], same: deepEq(String(values[k]), String(d[k])) || deepEq(values[k], d[k]) }));
}

module.exports = { DATASET_VERSION, COMPILED_ON, MODULES, CODES, has, defaultsFor, describe, validate, customizedKeys, compareToReference, requiredNow, BRACKETS_A };
