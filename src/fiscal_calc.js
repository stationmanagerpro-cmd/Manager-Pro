'use strict';
/**
 * Moteur de calcul fiscal — fonctions pures (aucun accès base), testables isolément.
 * Toutes les valeurs (taux, barèmes, seuils) viennent des paramètres saisis/confirmés dans l'assistant d'activation :
 * ce fichier ne contient AUCUNE donnée fiscale officielle.
 * Les cas chiffrés de test/fiscal-calc-unit.js sont des cas de contrôle arithmétique : ils doivent être validés par un
 * expert-comptable avant tout usage réel.
 */

const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ---------------------------------------------------------------------------
// Barèmes par tranches
// ---------------------------------------------------------------------------
/**
 * Normalise un barème : tri, correction du décalage d'un franc quand les tranches sont saisies « de 175 001 »
 * (la tranche suivante commence alors exactement à la fin de la précédente), contrôle de continuité.
 * @returns {{brackets: Array<{from:number,to:number|null,rate:number}>, errors: string[]}}
 */
function normalizeBrackets(list) {
  const errors = [];
  if (!Array.isArray(list) || !list.length) return { brackets: [], errors: ['Barème vide : saisissez au moins une tranche.'] };
  const rows = list.map(b => ({
    from: num(b.from), to: (b.to === null || b.to === undefined || b.to === '' || b.to === Infinity) ? null : num(b.to), rate: num(b.rate)
  })).sort((a, b) => a.from - b.from);
  const out = [];
  rows.forEach((b, i) => {
    let from = b.from;
    if (i === 0) {
      if (from !== 0 && from !== 1) errors.push('La première tranche doit commencer à 0.');
      from = 0;
    } else {
      const prev = out[i - 1];
      if (prev.to === null) { errors.push('Une tranche « sans plafond » doit être la dernière.'); }
      else if (from === prev.to + 1) from = prev.to;               // « de 175 001 » : aucun franc perdu ni mal taxé
      else if (from !== prev.to) errors.push(`Tranche ${i + 1} : début ${from} incohérent avec la fin de la tranche précédente (${prev.to}).`);
    }
    if (b.to !== null && b.to <= from) errors.push(`Tranche ${i + 1} : la borne haute doit dépasser la borne basse.`);
    if (b.rate < 0 || b.rate > 100) errors.push(`Tranche ${i + 1} : taux hors de 0 à 100 %.`);
    out.push({ from, to: b.to, rate: b.rate });
  });
  if (out[out.length - 1].to !== null) errors.push('La dernière tranche doit être sans plafond (borne haute vide).');
  return { brackets: out, errors };
}

function taxByBrackets(base, brackets) {
  let tax = 0; const lines = [];
  const b0 = Math.max(0, num(base));
  for (const t of brackets) {
    if (b0 <= t.from) break;
    const upper = t.to === null ? Infinity : t.to;
    const slice = Math.min(b0, upper) - t.from;
    if (slice > 0) { const tt = slice * t.rate / 100; tax += tt; lines.push({ from: t.from, to: t.to, rate: t.rate, slice: r2(slice), tax: r2(tt) }); }
  }
  return { tax: r2(tax), lines };
}

// ---------------------------------------------------------------------------
// ITS
// ---------------------------------------------------------------------------
/** Situation familiale libre (« Marié(e) », « celibataire », « veuf »…) → 'marie' | 'autre'. */
function familyKind(status) {
  const s = String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /mari/.test(s) ? 'marie' : 'autre';
}

/**
 * ITS mensuel sur base annuelle.
 * 1. assiette = brut du mois − cotisations salariales (INPS, AMO) si le paramètre l'impose ;
 * 2. annualisation (× 12) puis application du barème ANNUEL ;
 * 3. réduction pour charges de famille en POURCENTAGE de l'impôt brut ;
 * 4. retour au mois (÷ 12).
 * @param {{gross:number, employeeContributions?:number}} input
 * @param {{brackets:Array, annualize?:number, deduct_contributions?:boolean,
 *          family?:{single_pct?:number, married_pct?:number, per_child_pct?:number, max_children?:number}}} params
 * @param {{family_status?:string, children?:number}} person
 */
function computeAnnualITS(input, params, person = {}) {
  const { brackets, errors } = normalizeBrackets(params.brackets);
  if (errors.length) return { amount: 0, detail: { skipped: true, reason: 'Barème invalide : ' + errors[0], errors } };
  const factor = params.annualize === 0 || params.annualize === false ? 1 : (num(params.annualize) || 12);
  const contrib = params.deduct_contributions === false ? 0 : Math.max(0, num(input.employeeContributions));
  const taxableMonthly = Math.max(0, num(input.gross) - contrib);
  const annualBase = taxableMonthly * factor;
  const { tax: grossTax, lines } = taxByBrackets(annualBase, brackets);
  const fam = params.family || {};
  const children = Math.max(0, Math.min(Math.trunc(num(person.children)), fam.max_children != null ? Math.trunc(num(fam.max_children)) : 10));
  const base = familyKind(person.family_status) === 'marie' ? num(fam.married_pct) : num(fam.single_pct);
  const reductionPct = Math.min(100, base + num(fam.per_child_pct) * children);
  const netAnnual = grossTax * (1 - reductionPct / 100);
  const monthly = r2(netAnnual / factor);
  return {
    amount: monthly,
    detail: {
      mode: 'annuel', gross_month: r2(input.gross), employee_contributions_deducted: r2(contrib), taxable_month: r2(taxableMonthly),
      annualization_factor: factor, annual_base: r2(annualBase), lines, gross_tax_annual: grossTax,
      family_kind: familyKind(person.family_status), children_counted: children, reduction_pct: r2(reductionPct),
      net_tax_annual: r2(netAnnual), amount: monthly,
      formula: 'Barème annuel appliqué à (brut − cotisations salariales) × 12, réduction familiale en % de l\'impôt brut, puis ÷ 12'
    }
  };
}

// ---------------------------------------------------------------------------
// IS / IBIC
// ---------------------------------------------------------------------------
/** Déficits antérieurs imputables : si une durée de report est paramétrée, seuls les déficits assez récents comptent. */
function usableDeficits(deficits, periodEndYear, carryYears) {
  if (!Array.isArray(deficits)) return { total: num(deficits), excluded: 0 };
  let total = 0, excluded = 0;
  for (const d of deficits) {
    const amt = Math.max(0, num(d.amount));
    if (carryYears != null && carryYears !== '' && d.year != null && (periodEndYear - Number(d.year)) > Number(carryYears)) excluded += amt;
    else total += amt;
  }
  return { total: r2(total), excluded: r2(excluded) };
}

/**
 * Impôt sur les bénéfices avec impôt minimum forfaitaire (assis sur le chiffre d'affaires HT).
 * Impôt dû = max(impôt au taux normal, minimum forfaitaire).
 */
function computeProfitTax(i, p) {
  const ca = num(i.ca), charges = num(i.charges), amort = num(i.amortissements), nonDed = num(i.nonDeductible);
  const deficits = num(i.deficits), acomptes = num(i.acomptes);
  const resultatComptable = ca - charges - amort;
  const resultatFiscal = resultatComptable + nonDed - deficits;
  const impotBrut = resultatFiscal > 0 ? resultatFiscal * num(p.rate) / 100 : 0;
  const imfRate = p.imf_rate == null || p.imf_rate === '' ? null : num(p.imf_rate);
  let imf = imfRate != null ? ca * imfRate / 100 : 0;
  if (p.imf_min_amount != null && p.imf_min_amount !== '') imf = Math.max(imf, num(p.imf_min_amount));
  const imfApplies = imf > impotBrut;
  const due = Math.max(impotBrut, imf);
  return {
    resultat_comptable: r2(resultatComptable), resultat_fiscal: r2(resultatFiscal),
    impot_brut_taux_normal: r2(impotBrut), impot_minimum_forfaitaire: r2(imf), minimum_applique: imfApplies,
    impot_du_estime: r2(due), acomptes: r2(acomptes), solde_estime: r2(Math.max(0, due - acomptes))
  };
}

// ---------------------------------------------------------------------------
// Impôt synthétique
// ---------------------------------------------------------------------------
function computeSynthetic(i, p) {
  const ca = num(i.ca);
  const annual = i.annualCa != null ? num(i.annualCa) : ca;
  const estimate = p.fixed_amount != null && p.fixed_amount !== '' ? num(p.fixed_amount) : ca * num(p.rate) / 100;
  const threshold = p.ca_threshold != null && p.ca_threshold !== '' ? num(p.ca_threshold) : null;
  const exceeded = threshold != null && annual > threshold;
  return { estimation: r2(estimate), ca_reference: r2(ca), ca_annuel_compare: r2(annual), seuil: threshold, seuil_depasse: exceeded };
}

// ---------------------------------------------------------------------------
// TVA
// ---------------------------------------------------------------------------
function computeTvaNet(i, p) {
  const collected = num(i.collected), deductibleRaw = num(i.deductible);
  const nonDeductPct = Math.min(100, Math.max(0, num(p.non_deductible_pct)));
  const deductible = deductibleRaw * (1 - nonDeductPct / 100);
  const credit = num(p.credit_anterieur) || num(i.credit);
  const net = collected - deductible - credit;
  return { collected: r2(collected), deductible_brute: r2(deductibleRaw), non_deductible_pct: nonDeductPct, deductible_retenue: r2(deductible), credit_anterieur: r2(credit), net: r2(net) };
}

/** Taxe à taux simple sur une base (CFE, TFP, taxes complémentaires) ou montant forfaitaire. */
function computeSimpleTax(base, p) {
  if (p.fixed_amount != null && p.fixed_amount !== '' && num(p.fixed_amount) > 0 && (p.calc_mode === 'fixed' || p.rate == null || p.rate === '')) return r2(num(p.fixed_amount));
  return r2(num(base) * num(p.rate) / 100);
}

module.exports = { r2, normalizeBrackets, taxByBrackets, familyKind, computeAnnualITS, usableDeficits, computeProfitTax, computeSynthetic, computeTvaNet, computeSimpleTax };
