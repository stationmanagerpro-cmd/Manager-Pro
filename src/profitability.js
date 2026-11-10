/**
 * Rentabilité — source unique de la marge et du résultat de gestion.
 *
 * Ce module centralise, pour une ou plusieurs stations d'un même compte client et pour une période libre :
 *   ventes (produits + compteurs carburant des quarts clôturés) → coût d'achat → MARGE BRUTE
 *   dépenses (dont salaires) + charges patronales de la paie (RH)  → RÉSULTAT DE GESTION
 *   fiscalité (uniquement si le contrat et le rôle l'autorisent)   → impôts estimés, ITS retenu sur bulletins
 *
 * Les définitions reprennent celles de la situation financière (finance.js) afin que le tableau de bord, le rapport
 * financier, la fiscalité et ce rapport client donnent les mêmes chiffres.
 *
 * Limites assumées : indicateurs de gestion, pas un résultat comptable certifié. Les achats de marchandises ne sont
 * pas des charges (le coût des produits vendus vient des coûts d'achat figés sur les lignes de vente / les compteurs).
 */
'use strict';
const express = require('express');
const { swallow } = require('./safe');
const { pool, wrap, need, HttpError, audit } = require('./core');
const { featureOn } = require('./contracts');
const docs = require('./docs');
const r = express.Router();

const num = x => (x == null || x === '' ? 0 : Number(x) || 0);
const rnd = x => Math.round(num(x) * 100) / 100;
const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : null);   // pourcentage à 1 décimale, null si base nulle

// ---------- Période libre ----------
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = v => typeof v === 'string' && DAY.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const MAX_DAYS = 1830;   // 5 ans
const GROUPS = ['none', 'day', 'week', 'month', 'quarter', 'year'];   // liste blanche : seule source de date_trunc()

function parseRange(q) {
  const t = new Date().toISOString().slice(0, 10);
  const from = q.from == null || q.from === '' ? t.slice(0, 8) + '01' : String(q.from);
  const to = q.to == null || q.to === '' ? t : String(q.to);
  if (!validDay(from) || !validDay(to)) throw new HttpError(400, 'Dates invalides : format AAAA-MM-JJ attendu');
  if (from > to) throw new HttpError(400, 'La date de début est postérieure à la date de fin');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  if (days > MAX_DAYS) throw new HttpError(400, `Période trop longue (maximum ${MAX_DAYS} jours)`);
  return { from, to, days };
}
function parseGroup(q, days) {
  const g = String(q.group || 'auto');
  if (g === 'auto') return days <= 45 ? 'day' : days <= 400 ? 'month' : 'year';
  if (!GROUPS.includes(g)) throw new HttpError(400, 'Regroupement : none, day, week, month, quarter ou year');
  return g;
}

// ---------- Agrégation de base (ventes, coûts, dépenses, charges patronales) ----------
const blank = () => ({ revenue_products: 0, revenue_fuel: 0, rev_costed: 0, cogs: 0, nocost: 0, expenses: 0, employer_charges: 0, payroll_gross: 0, payslips: 0 });

function finish(o) {
  const revenue = o.revenue_products + o.revenue_fuel;
  const grossMargin = revenue - o.cogs;
  const operating = grossMargin - o.expenses - o.employer_charges;
  return {
    revenue: rnd(revenue), revenue_products: rnd(o.revenue_products), revenue_fuel: rnd(o.revenue_fuel),
    cogs: rnd(o.cogs), gross_margin: rnd(grossMargin), margin_pct: pct(grossMargin, revenue),
    expenses: rnd(o.expenses), employer_charges: rnd(o.employer_charges),
    operating_result: rnd(operating), operating_pct: pct(operating, revenue),
    // Fiabilité : la marge est « partielle » tant que des lignes vendues n'ont pas de coût d'achat (elle est alors surestimée).
    cost_coverage_pct: revenue > 0 ? Math.round(o.rev_costed / revenue * 1000) / 10 : null,
    nocost_lines: o.nocost, reliable: revenue > 0 && o.nocost === 0,
    payslips_paid: o.payslips
  };
}

/**
 * @param {number[]} ids  stations (déjà autorisées par l'appelant)
 * @param {string} g      none | day | week | month | quarter | year
 */
async function core(ids, from, to, g) {
  if (!GROUPS.includes(g)) throw new HttpError(400, 'Regroupement invalide');
  const Q = sql => pool.query(sql, [ids, from, to]).then(x => x.rows);
  const B = col => (g === 'none' ? "'all'::text" : `to_char(date_trunc('${g}', ${col}), 'YYYY-MM-DD')`);

  const prod = await Q(`SELECT sa.station_id, ${B('sa.sold_at')} AS b,
      COALESCE(SUM(d.amount),0) AS revenue, COALESCE(SUM(d.quantity * d.unit_cost),0) AS cost,
      COALESCE(SUM(d.amount) FILTER (WHERE d.unit_cost > 0),0) AS rev_costed,
      COUNT(*) FILTER (WHERE d.unit_cost IS NULL OR d.unit_cost = 0)::int AS nocost
    FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
    WHERE sa.station_id = ANY($1::bigint[]) AND sa.kind = 'produits' AND sa.status = 'valide'
      AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
    GROUP BY 1, 2`);
  const fuel = await Q(`SELECT sh.station_id, ${B('sh.closed_at')} AS b,
      COALESCE(SUM(m.amount),0) AS revenue, COALESCE(SUM(m.liters * m.unit_cost),0) AS cost,
      COALESCE(SUM(m.amount) FILTER (WHERE m.unit_cost > 0),0) AS rev_costed,
      COUNT(*) FILTER (WHERE m.unit_cost IS NULL OR m.unit_cost = 0)::int AS nocost
    FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
    WHERE sh.station_id = ANY($1::bigint[]) AND sh.status = 'ferme'
      AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
    GROUP BY 1, 2`);
  const exp = await Q(`SELECT e.station_id, ${B('e.spent_on')} AS b, e.category, COALESCE(SUM(e.amount),0) AS amount
    FROM expenses e
    WHERE e.station_id = ANY($1::bigint[]) AND e.deleted_at IS NULL AND e.spent_on >= $2::date AND e.spent_on <= $3::date
    GROUP BY 1, 2, 3`);
  // Charges patronales (INPS/AMO employeur + autres) des bulletins payés : la dépense « Salaires » enregistrée au paiement
  // ne contient que le brut (hr.js, paiement du bulletin) ; sans cet ajout le résultat serait surestimé.
  let slips = [], payrollOk = true;
  try {
    slips = await Q(`SELECT s.station_id, ${B('s.paid_at')} AS b,
        COALESCE(SUM(COALESCE(s.inps_employer,0) + COALESCE(s.amo_employer,0) + COALESCE(s.employer_charges_total,0)),0) AS charges,
        COALESCE(SUM(s.gross),0) AS gross, COUNT(*)::int AS n
      FROM payslips s
      WHERE s.station_id = ANY($1::bigint[]) AND s.status = 'paye' AND s.rectifies_id IS NULL
        AND s.paid_at >= $2::date AND s.paid_at < $3::date + 1
      GROUP BY 1, 2`);
  } catch (_) { payrollOk = false; }

  const tot = blank(), byStation = new Map(ids.map(id => [id, blank()])), byBucket = new Map(), cats = new Map();
  const put = (row, fn) => {
    const s = byStation.get(row.station_id) || byStation.set(row.station_id, blank()).get(row.station_id);
    const k = byBucket.get(row.b) || byBucket.set(row.b, blank()).get(row.b);
    for (const o of [s, k, tot]) fn(o);
  };
  for (const x of prod) put(x, o => { o.revenue_products += num(x.revenue); o.cogs += num(x.cost); o.rev_costed += num(x.rev_costed); o.nocost += num(x.nocost); });
  for (const x of fuel) put(x, o => { o.revenue_fuel += num(x.revenue); o.cogs += num(x.cost); o.rev_costed += num(x.rev_costed); o.nocost += num(x.nocost); });
  for (const x of exp) { put(x, o => { o.expenses += num(x.amount); }); cats.set(x.category, (cats.get(x.category) || 0) + num(x.amount)); }
  for (const x of slips) put(x, o => { o.employer_charges += num(x.charges); o.payroll_gross += num(x.gross); o.payslips += num(x.n); });
  return { tot, byStation, byBucket, cats, payrollOk };
}

/** Marge et résultat d'UNE station sur une période (tableau de bord). */
async function stationProfit(stationId, from, to) {
  const c = await core([Number(stationId)], from, to, 'none');
  return finish(c.tot);
}

// ---------- Paie (RH) : totaux des bulletins, utilisés aussi par la fiscalité ----------
/** Bulletins validés ou payés dont le mois est dans la période. null si le schéma de paie est absent. */
async function payrollTotals(ids, from, to) {
  try {
    const { rows: [x] } = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(gross),0) AS gross, COALESCE(SUM(its_amount),0) AS its,
              COALESCE(SUM(inps_employee),0) AS inps_employee, COALESCE(SUM(amo_employee),0) AS amo_employee,
              COALESCE(SUM(inps_employer),0) AS inps_employer, COALESCE(SUM(amo_employer),0) AS amo_employer,
              COALESCE(SUM(employer_charges_total),0) AS other_charges, COALESCE(SUM(employer_cost),0) AS employer_cost
         FROM payslips
        WHERE station_id = ANY($1::bigint[]) AND status IN ('valide','paye')
          AND month >= date_trunc('month', $2::date)::date AND month <= $3::date`, [ids, from, to]);
    return { n: x.n, gross: num(x.gross), its: num(x.its), inps_employee: num(x.inps_employee), amo_employee: num(x.amo_employee), inps_employer: num(x.inps_employer), amo_employer: num(x.amo_employer), other_charges: num(x.other_charges), employer_cost: num(x.employer_cost) };
  } catch (_) { return null; }
}

/** Stations d'un client (éventuellement une seule), pour les estimations fiscales. */
async function clientStationIds(clientId, stationId = null) {
  const { rows } = await pool.query('SELECT id FROM stations WHERE client_id = $1' + (stationId ? ' AND id = $2' : ''), stationId ? [clientId, stationId] : [clientId]);
  return rows.map(x => Number(x.id));
}
/**
 * Chiffre d'affaires et charges d'un client sur une période, avec la définition commune du système.
 * Les charges « déductibles » excluent la catégorie « Impôts et taxes » : elle peut contenir l'IBIC / l'IS lui-même,
 * non déductible ; l'utilisateur la ressaisit s'il en a besoin.
 */
async function clientTotals(clientId, stationId, from, to) {
  const ids = await clientStationIds(clientId, stationId);
  if (!ids.length) return { ids, revenue: 0, cogs: 0, expenses: 0, expenses_excl_taxes: 0, employer_charges: 0, deductible: 0, reliable: false, nocost_lines: 0 };
  const c = await core(ids, from, to, 'none'), t = finish(c.tot), taxes = num(c.cats.get('Impôts et taxes'));
  const exclTaxes = rnd(t.expenses - taxes);
  return { ids, revenue: t.revenue, cogs: t.cogs, expenses: t.expenses, expenses_excl_taxes: exclTaxes, employer_charges: t.employer_charges,
    deductible: rnd(t.cogs + exclTaxes + t.employer_charges), reliable: t.reliable, nocost_lines: t.nocost_lines, taxes_in_expenses: rnd(taxes) };
}

// ---------- Périmètre : stations accessibles à l'utilisateur ----------
async function accessibleStations(req) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.currency, s.client_id
       FROM stations s JOIN user_stations us ON us.station_id = s.id JOIN users u ON u.id = us.user_id
      WHERE us.user_id = $1 AND s.active = true AND (u.client_id IS NULL OR s.client_id = u.client_id)
      ORDER BY s.name, s.id`, [req.user.id]);
  const caps = rows.length ? await pool.query(
    `SELECT station_id, permission_code FROM station_permission_caps
      WHERE station_id = ANY($1::bigint[]) AND allowed = false AND permission_code IN ('report.view','finance.view')`,
    [rows.map(s => s.id)]).then(x => x.rows).catch(swallow('profitability:174', [])) : [];
  // Plafond de permissions par station : une station où le plafond retire à la fois « report.view » et « finance.view »
  // pour ce que l'utilisateur détient n'entre pas dans le rapport consolidé.
  const capped = new Map();
  for (const c of caps) (capped.get(c.station_id) || capped.set(c.station_id, new Set()).get(c.station_id)).add(c.permission_code);
  const canR = req.user.perms.has('report.view'), canF = req.user.perms.has('finance.view');
  return rows.filter(s => {
    const c = capped.get(s.id);
    return !c || (canR && !c.has('report.view')) || (canF && !c.has('finance.view'));
  });
}

const fiscalAllowed = req => !!(req.user.client_id && req.user.perms.has('fiscal.access') && req.contract
  && (featureOn(req.contract, 'can_access_fiscal') || featureOn(req.contract, 'module:fiscal')));
const hrAllowed = req => !!(req.contract && (featureOn(req.contract, 'can_access_hr') || featureOn(req.contract, 'module:hr'))
  && (req.user.perms.has('hr.payroll') || req.user.perms.has('hr.manage')));

// ---------- Rapport complet du compte client ----------
const FISCAL_LABELS = { tva: 'TVA', synthetique: 'Impôt synthétique', ibic: 'IBIC', is: 'IS', its: 'ITS', cfe: 'CFE', tfp: 'TFP', logement: 'Taxe logement / autres', retenues: 'Retenues à la source', autres: 'Autres impôts et taxes' };
const INCOME_TAX = new Set(['ibic', 'is', 'synthetique']);
function fiscalAmount(code, est) {
  const e = est || {};
  const keys = code === 'tva' ? ['tva_nette_estimee'] : code === 'its' ? ['total_its'] : INCOME_TAX.has(code) && code !== 'synthetique' ? ['solde_estime', 'impot_brut_estime'] : ['reste_estime', 'estimation'];
  for (const k of keys) if (e[k] != null && Number.isFinite(Number(e[k]))) return rnd(e[k]);
  return null;
}

async function buildReport(req, { from, to, g, ids, stations }) {
  const c = await core(ids, from, to, g), totals = finish(c.tot);
  const nameOf = new Map(stations.map(s => [s.id, s.name]));
  const by_station = ids.map(id => ({ id, name: nameOf.get(id) || '#' + id, ...finish(c.byStation.get(id) || blank()) }));
  const series = [...c.byBucket.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, o]) => ({ bucket, label: bucket, ...finish(o) }));
  const Q = (sql, p = []) => pool.query(sql, [ids, from, to, ...p]).then(x => x.rows);
  const Q1 = sql => pool.query(sql, [ids]).then(x => x.rows[0]);
  const notes = [];

  // Marge par produit (carburants via compteurs, autres produits via lignes de vente)
  const pf = await Q(`SELECT p.name, COALESCE(cat.code,'') AS cat, SUM(d.quantity) AS qty, SUM(d.amount) AS revenue, SUM(d.quantity * d.unit_cost) AS cost,
        COUNT(*) FILTER (WHERE d.unit_cost IS NULL OR d.unit_cost = 0)::int AS nocost
      FROM sales sa JOIN sale_details d ON d.sale_id = sa.id JOIN products p ON p.id = d.product_id LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE sa.station_id = ANY($1::bigint[]) AND sa.kind = 'produits' AND sa.status = 'valide' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
     GROUP BY p.name, cat.code`);
  const pm = await Q(`SELECT p.name, COALESCE(cat.code,'') AS cat, SUM(m.liters) AS qty, SUM(m.amount) AS revenue, SUM(m.liters * m.unit_cost) AS cost,
        COUNT(*) FILTER (WHERE m.unit_cost IS NULL OR m.unit_cost = 0)::int AS nocost
      FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id JOIN products p ON p.id = m.product_id LEFT JOIN categories cat ON cat.id = p.category_id
     WHERE sh.station_id = ANY($1::bigint[]) AND sh.status = 'ferme' AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
     GROUP BY p.name, cat.code`);
  const pmap = new Map();
  for (const x of [...pf, ...pm]) {
    const k = x.name + '|' + x.cat, o = pmap.get(k) || { name: x.name, category: x.cat, qty: 0, revenue: 0, cost: 0, nocost: 0 };
    o.qty += num(x.qty); o.revenue += num(x.revenue); o.cost += num(x.cost); o.nocost += num(x.nocost); pmap.set(k, o);
  }
  const by_product = [...pmap.values()].map(o => ({ ...o, qty: Math.round(o.qty * 1000) / 1000, revenue: rnd(o.revenue), cost: rnd(o.cost), margin: rnd(o.revenue - o.cost), margin_pct: pct(o.revenue - o.cost, o.revenue) }))
    .sort((a, b) => b.margin - a.margin);

  const expTotal = totals.expenses;
  const expenses = [...c.cats.entries()].map(([category, amount]) => ({ category, amount: rnd(amount), share_pct: pct(amount, expTotal) })).sort((a, b) => b.amount - a.amount);

  // Employés ↔ ventes ↔ paie : uniquement pour les profils RH autorisés (données de paie individuelles)
  let employees = null;
  if (hrAllowed(req)) {
    try {
      const rev = await Q(`SELECT sa.employee_id, SUM(sa.total) AS revenue FROM sales sa
         WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.employee_id IS NOT NULL AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1 GROUP BY 1`);
      const cost = await Q(`SELECT s.employee_id, SUM(CASE WHEN s.rectifies_id IS NOT NULL THEN s.net_pay WHEN COALESCE(s.employer_cost,0) > 0 THEN s.employer_cost ELSE s.gross END) AS cost
         FROM payslips s WHERE s.station_id = ANY($1::bigint[]) AND s.status = 'paye' AND s.paid_at >= $2::date AND s.paid_at < $3::date + 1 GROUP BY 1`);
      const emap = new Map();
      for (const x of rev) emap.set(x.employee_id, { id: x.employee_id, revenue: num(x.revenue), cost: 0 });
      for (const x of cost) (emap.get(x.employee_id) || emap.set(x.employee_id, { id: x.employee_id, revenue: 0, cost: 0 }).get(x.employee_id)).cost = num(x.cost);
      const eids = [...emap.keys()];
      const names = eids.length ? await pool.query('SELECT e.id, e.last_name || \' \' || e.first_name AS name, st.name AS station FROM employees e JOIN stations st ON st.id = e.station_id WHERE e.id = ANY($1::bigint[])', [eids]).then(x => x.rows) : [];
      const nm = new Map(names.map(x => [x.id, x]));
      employees = [...emap.values()].map(o => ({ employee: nm.get(o.id)?.name || '#' + o.id, station: nm.get(o.id)?.station || '', revenue: rnd(o.revenue), payroll_cost: rnd(o.cost), ratio: o.cost > 0 ? Math.round(o.revenue / o.cost * 10) / 10 : null }))
        .sort((a, b) => b.revenue - a.revenue);
      notes.push("Employés : le chiffre d'affaires attribué est celui des ventes saisies par l'employé (ni un bénéfice, ni une somme lui appartenant) ; le coût est celui des bulletins payés sur la période.");
    } catch (_) { notes.push('Table employés / paie indisponible : détail par employé non produit.'); }
  }

  // Situation à ce jour (clients, fournisseurs, caisses, stocks) — mêmes masques de permission que le tableau de bord
  const safe = async fn => { try { return await fn(); } catch (_) { return null; } };
  const position = {
    as_of: new Date().toISOString().slice(0, 10),
    cash: await safe(async () => rnd((await Q1('SELECT COALESCE(SUM(balance),0) AS v FROM cash_registers WHERE station_id = ANY($1::bigint[]) AND active')).v)),
    receivables: req.user.perms.has('receivable.view') ? await safe(async () => rnd((await Q1('SELECT COALESCE(SUM(balance),0) AS v FROM customers WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL')).v)) : null,
    payables: req.user.perms.has('debt.view') ? await safe(async () => rnd((await Q1('SELECT COALESCE(SUM(balance_due),0) AS v FROM suppliers WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL')).v)) : null,
    stock_value: await safe(async () => rnd((await Q1('SELECT COALESCE(SUM(st.quantity * p.buy_price),0) AS v FROM products p JOIN stock st ON st.product_id = p.id WHERE p.station_id = ANY($1::bigint[]) AND p.deleted_at IS NULL')).v))
  };

  // Liens entre modules (contrôles de cohérence)
  const links = [], link = (key, label, modules, expected, actual, note = '') => {
    const diff = expected == null || actual == null ? null : rnd(actual - expected);
    links.push({ key, label, modules, expected: expected == null ? null : rnd(expected), actual: actual == null ? null : rnd(actual), diff, status: diff == null ? 'info' : Math.abs(diff) < 0.01 ? 'ok' : 'ecart', note });
  };
  if (c.payrollOk) {
    const sal = await safe(async () => (await Q(`SELECT COALESCE(SUM(CASE WHEN s.rectifies_id IS NULL THEN s.gross ELSE s.net_pay END),0) AS v FROM payslips s
       WHERE s.station_id = ANY($1::bigint[]) AND s.status = 'paye' AND s.paid_at >= $2::date AND s.paid_at < $3::date + 1`))[0].v);
    link('rh_depenses', 'Salaires : bulletins payés (RH) et dépenses « Salaires »', 'RH / Dépenses', sal, num(c.cats.get('Salaires')),
      "Un écart signale des dépenses « Salaires » saisies à la main, ou un bulletin payé sans dépense.");
    link('rh_charges_patronales', 'Charges patronales des bulletins payés intégrées au résultat', 'RH / Résultat', null, totals.employer_charges, "Ajoutées au résultat : la dépense « Salaires » ne contient que le brut.");
  }
  link('stock_marge', "Lignes vendues sans coût d'achat (Stock / Marge)", 'Stock / Ventes', 0, totals.nocost_lines, totals.nocost_lines ? "Renseignez le prix d'achat des produits concernés : la marge est surestimée tant qu'il manque." : '');

  // Fiscalité : seulement si le contrat ET le rôle l'autorisent ; aucune donnée fiscale n'est lue sinon
  let fiscal = null;
  if (fiscalAllowed(req)) {
    const clientId = req.user.client_id;
    const rows = await safe(() => pool.query(
      `SELECT p.module_code, to_char(p.period_start,'YYYY-MM-DD') AS period_start, to_char(p.period_end,'YYYY-MM-DD') AS period_end, p.status, p.estimates
         FROM fiscal_periods p WHERE p.client_id = $1 AND p.period_end >= $2::date AND p.period_start <= $3::date
          AND (p.station_id IS NULL OR p.station_id = ANY($4::bigint[]))
          AND EXISTS (SELECT 1 FROM fiscal_module_activations a WHERE a.client_id = p.client_id AND a.module_code = p.module_code AND a.activated AND a.settings_version IS NOT NULL)
          ORDER BY p.period_start, p.module_code`, [clientId, from, to, ids]).then(x => x.rows)) || [];
    const items = rows.map(x => {
      const contained = x.period_start >= from && x.period_end <= to;
      return { module: x.module_code, label: FISCAL_LABELS[x.module_code] || x.module_code, period_start: x.period_start, period_end: x.period_end, status: x.status, amount: fiscalAmount(x.module_code, x.estimates), contained };
    });
    const incomeTax = items.filter(i => INCOME_TAX.has(i.module) && i.contained && i.amount != null).reduce((a, i) => a + i.amount, 0);
    const hasIncomeTax = items.some(i => INCOME_TAX.has(i.module) && i.contained && i.amount != null);
    const pay = await payrollTotals(ids, from, to);
    const taxesBooked = num(c.cats.get('Impôts et taxes'));
    fiscal = {
      authorized: true, items, income_tax_estimate: hasIncomeTax ? rnd(incomeTax) : null,
      result_after_income_tax: hasIncomeTax ? rnd(totals.operating_result - incomeTax) : null,
      taxes_booked_in_expenses: rnd(taxesBooked),
      payroll: pay ? { its_withheld: pay.its, gross: pay.gross, employer_cost: pay.employer_cost, payslips: pay.n } : null
    };
    notes.push("Fiscalité : montants issus des estimations enregistrées dans le module Fiscalité (non officielles). Les périodes fiscales qui débordent de la période du rapport sont listées mais exclues du total. « Impôts et taxes » déjà enregistrés en dépenses sont inclus dans le résultat de gestion : ne pas les additionner à l'impôt estimé sans vérifier.");
    if (pay) link('fiscal_its', 'ITS retenu sur les bulletins (RH → Fiscalité)', 'RH / Fiscalité', null, pay.its, 'Base de l\'estimation ITS du module Fiscalité.');
    const itsEst = items.filter(i => i.module === 'its' && i.contained && i.amount != null);
    if (pay && itsEst.length) link('fiscal_its_estime', 'ITS estimé (Fiscalité) et ITS des bulletins (RH)', 'Fiscalité / RH', itsEst.reduce((a, i) => a + i.amount, 0), pay.its, 'Un écart indique une estimation ITS ancienne : recalculez-la.');
  }

  if (!totals.reliable) notes.push(totals.revenue > 0
    ? `Marge brute partielle : ${totals.nocost_lines} ligne(s) vendue(s) sans coût d'achat (couverture ${totals.cost_coverage_pct ?? 0} % du chiffre d'affaires) ; la marge est surestimée.`
    : 'Aucune vente sur la période : marge non déterminable.');
  if (!c.payrollOk) notes.push("Charges patronales non lues (schéma de paie indisponible) : résultat non diminué des charges patronales.");
  notes.push("Chiffre d'affaires : ventes de produits validées + compteurs des quarts clôturés (même définition que la situation financière). Résultat de gestion = marge brute − dépenses enregistrées − charges patronales ; ce n'est pas un résultat comptable certifié.");
  notes.push("Les achats de marchandises ne sont pas des charges : le coût des ventes vient des coûts d'achat figés sur les ventes et les compteurs. Les investissements et amortissements ne sont pas modélisés.");
  if (!hrAllowed(req)) notes.push("Détail par employé non affiché : réservé aux profils RH/paie dont le contrat inclut le module RH.");
  if (!fiscalAllowed(req)) notes.push('Fiscalité non incluse : module non autorisé pour ce compte ou ce rôle.');

  return { period: { from, to }, group: g, totals, by_station, series, by_product, expenses, employees, position, fiscal, links, notes };
}

// ---------- Mise en forme des exports ----------
const GL = { none: 'Total', day: 'Jour', week: 'Semaine (début)', month: 'Mois', quarter: 'Trimestre (début)', year: 'Année' };
function sectionsOf(d, cur) {
  const t = d.totals, P = v => (v == null ? 'n/d' : v), S = [];
  S.push({ type: 'kpis', title: 'Synthèse', items: [
    { label: "Chiffre d'affaires", value: t.revenue, note: `dont carburant ${t.revenue_fuel} / produits ${t.revenue_products}` },
    { label: 'Coût des ventes', value: t.cogs, note: "Coûts d'achat figés sur les ventes et compteurs" },
    { label: 'Marge brute', value: t.gross_margin, note: t.reliable ? 'Fiable' : 'Partielle : coûts d\'achat manquants' },
    { label: 'Taux de marge brute', value: t.margin_pct == null ? 'n/d' : t.margin_pct + ' %', note: 'Marge brute / chiffre d\'affaires' },
    { label: 'Dépenses enregistrées', value: t.expenses, note: 'Dont salaires bruts' },
    { label: 'Charges patronales (paie)', value: t.employer_charges, note: 'Bulletins payés' },
    { label: 'Résultat de gestion', value: t.operating_result, note: 'Indicateur, non certifié' },
    { label: 'Taux de résultat', value: t.operating_pct == null ? 'n/d' : t.operating_pct + ' %', note: 'Résultat / chiffre d\'affaires' },
    ...(d.fiscal && d.fiscal.income_tax_estimate != null ? [{ label: 'Impôt sur le résultat estimé', value: d.fiscal.income_tax_estimate, note: 'Module Fiscalité (indicatif)' }, { label: 'Résultat après impôt estimé', value: d.fiscal.result_after_income_tax, note: 'Indicatif' }] : [])
  ] });
  S.push({ type: 'table', title: 'Marges par station', head: ['Station', 'CA carburant', 'CA produits', 'CA total', 'Coût des ventes', 'Marge brute', 'Taux de marge %', 'Dépenses', 'Charges patronales', 'Résultat de gestion'],
    rows: d.by_station.map(x => [x.name, x.revenue_fuel, x.revenue_products, x.revenue, x.cogs, x.gross_margin, P(x.margin_pct), x.expenses, x.employer_charges, x.operating_result]), sumCols: [1, 2, 3, 4, 5, 7, 8, 9] });
  if (d.group !== 'none') S.push({ type: 'table', title: `Marges par période (${GL[d.group].toLowerCase()})`, head: [GL[d.group], 'CA total', 'Coût des ventes', 'Marge brute', 'Taux de marge %', 'Dépenses', 'Charges patronales', 'Résultat de gestion'],
    rows: d.series.map(x => [x.label, x.revenue, x.cogs, x.gross_margin, P(x.margin_pct), x.expenses, x.employer_charges, x.operating_result]), sumCols: [1, 2, 3, 5, 6, 7] });
  S.push({ type: 'table', title: 'Marges par produit', head: ['Produit', 'Catégorie', 'Quantité', 'CA', "Coût d'achat", 'Marge brute', 'Taux de marge %', 'Lignes sans coût'],
    rows: d.by_product.map(x => [x.name, x.category, x.qty, x.revenue, x.cost, x.margin, P(x.margin_pct), x.nocost]), sumCols: [3, 4, 5, 7] });
  S.push({ type: 'table', title: 'Dépenses par catégorie', head: ['Catégorie', 'Montant', '% des dépenses'], rows: d.expenses.map(x => [x.category, x.amount, P(x.share_pct)]), sumCols: [1] });
  if (d.employees) S.push({ type: 'table', title: 'Employés : ventes saisies et coût de paie', head: ['Employé', 'Station', 'CA des ventes saisies', 'Coût employeur payé', 'CA par unité de coût'], rows: d.employees.map(x => [x.employee, x.station, x.revenue, x.payroll_cost, P(x.ratio)]), sumCols: [2, 3] });
  S.push({ type: 'kv', title: 'Situation à ce jour (' + d.position.as_of + ')', rows: [['Liquidités en caisse', P(d.position.cash)], ['Créances clients', P(d.position.receivables)], ['Dettes fournisseurs', P(d.position.payables)], ["Valeur du stock (dernier prix d'achat)", P(d.position.stock_value)]] });
  if (d.fiscal) {
    S.push({ type: 'table', title: 'Fiscalité : périodes recoupant la période du rapport', head: ['Impôt', 'Début', 'Fin', 'Statut', 'Montant estimé', 'Incluse dans le total'], rows: d.fiscal.items.map(x => [x.label, x.period_start, x.period_end, x.status, P(x.amount), x.contained ? 'Oui' : 'Non (déborde)']) });
    S.push({ type: 'kv', title: 'Fiscalité et RH', rows: [['Impôts et taxes enregistrés en dépenses', d.fiscal.taxes_booked_in_expenses], ['Impôt sur le résultat estimé (IBIC / IS / synthétique)', P(d.fiscal.income_tax_estimate)], ['Résultat après impôt estimé', P(d.fiscal.result_after_income_tax)], ['ITS retenu sur les bulletins', d.fiscal.payroll ? d.fiscal.payroll.its_withheld : 'n/d']] });
  }
  S.push({ type: 'table', title: 'Liens entre modules', head: ['Contrôle', 'Modules', 'Attendu', 'Constaté', 'Écart', 'Statut', 'Note'], rows: d.links.map(x => [x.label, x.modules, P(x.expected), P(x.actual), P(x.diff), x.status === 'ok' ? 'Conforme' : x.status === 'ecart' ? 'ÉCART' : 'Information', x.note]) });
  return S;
}

// ---------- Route ----------
r.get('/reports/client-profit', need('report.view', 'finance.view'), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Administrateur Principal : les données métier des stations sont interdites.');
  const fmt = String(req.query.format || 'json');
  if (!['json', 'pdf', 'xlsx', 'csv'].includes(fmt)) throw new HttpError(400, 'Format : json, pdf, xlsx ou csv');
  if (fmt !== 'json' && !featureOn(req.contract, 'can_export_reports') && !featureOn(req.contract, 'module:reports')) {
    throw new HttpError(403, 'Les exports ne sont pas inclus dans votre contrat.', { code: 'FEATURE_DISABLED', feature: 'exports' });
  }
  const { from, to, days } = parseRange(req.query), g = parseGroup(req.query, days);
  const stations = await accessibleStations(req);
  if (!stations.length) throw new HttpError(403, 'Aucune station accessible pour ce rapport.');
  let chosen = stations;
  if (req.query.station_ids) {
    const want = new Set(String(req.query.station_ids).split(',').map(x => parseInt(x, 10)).filter(Number.isInteger));
    chosen = stations.filter(s => want.has(s.id));
    if (!chosen.length) throw new HttpError(403, 'Aucune des stations demandées n\'est accessible.');
  }
  const currencies = [...new Set(chosen.map(s => s.currency))];
  if (currencies.length > 1) throw new HttpError(400, 'Stations de devises différentes (' + currencies.join(', ') + ') : sélectionnez des stations de même devise.');
  const ids = chosen.map(s => s.id), data = await buildReport(req, { from, to, g, ids, stations: chosen });
  const out = { title: 'Rapport complet du compte client', currency: currencies[0] || null, stations: chosen.map(s => ({ id: s.id, name: s.name })),
    available_stations: stations.map(s => ({ id: s.id, name: s.name })), ...data,
    capabilities: { fiscal: fiscalAllowed(req), employees: hrAllowed(req), export: true } };
  if (fmt === 'json') return res.json({ ...out, sections: sectionsOf(out, out.currency) });

  await audit(pool, req, 'rapports', `Export du rapport client (${fmt}) du ${from} au ${to}, ${ids.length} station(s)`, null, null, null, { from, to, group: g, stations: ids, format: fmt });
  const name = `rapport-client-${from}_${to}`;
  if (fmt === 'csv') {
    const t = sectionsOf(out, out.currency).filter(s => s.type === 'table');
    const pick = g !== 'none' ? t.find(s => s.title.startsWith('Marges par période')) : t.find(s => s.title === 'Marges par station');
    return docs.send(res, 'csv', docs.csv(pick.head, pick.rows), name);
  }
  const b = await docs.branding(chosen.find(s => s.id === req.sid)?.id || ids[0]);
  const sections = sectionsOf(out, b.currency), sub = `Période du ${from} au ${to} - ${chosen.length} station(s) : ${chosen.map(s => s.name).join(', ')}`.slice(0, 220);
  const ref = `RCLI-${to.replace(/-/g, '')}-${ids.length}`;
  if (fmt === 'pdf') {
    // Valeurs normalisées pour le moteur PDF : jamais d'objet, de NaN ni de ligne plus courte que l'en-tête
    const flat = v => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? v : '') : (v instanceof Date ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)));
    const safeSections = [...sections, { type: 'text', title: 'Notes et limites', text: (out.notes || []).join('\n') || ' ' }].map(sec => {
      if (sec.type === 'table') {
        const n = sec.head.length, fix = row => Array.from({ length: n }, (_, i) => flat(row[i]));
        return { ...sec, rows: sec.rows.map(fix), totals: sec.totals ? fix(sec.totals) : undefined };
      }
      if (sec.type === 'kv') return { ...sec, rows: sec.rows.map(([a, v]) => [String(a), flat(v)]) };
      if (sec.type === 'kpis') return { ...sec, items: sec.items.map(i => ({ ...i, value: flat(i.value), note: i.note ? String(i.note) : undefined })) };
      return sec;
    });
    let buf;
    try {
      buf = await docs.buildPdf({ b, title: 'RAPPORT COMPLET DU COMPTE CLIENT', subtitle: sub, ref, sections: safeSections, signatures: [{ label: 'Préparé par' }, { label: 'Direction' }], landscape: true });
    } catch (e) {
      console.error('[client-profit] génération PDF impossible :', e);
      throw new HttpError(500, 'Génération du PDF impossible : ' + String((e && e.message) || e).slice(0, 160));
    }
    return docs.send(res, 'pdf', buf, name);
  }
  const sheets = [], kv = sections.filter(s => s.type === 'kpis' || s.type === 'kv');
  sheets.push({ name: 'Synthèse', head: ['Indicateur', 'Valeur', 'Note'], rows: [...kv.flatMap(s => s.type === 'kpis' ? s.items.map(i => [i.label, i.value, i.note || '']) : [[s.title || '', '', ''], ...s.rows.map(([a, v]) => [a, v, ''])]), ['Notes', out.notes.join(' | '), '']] });
  for (const s of sections.filter(s => s.type === 'table')) sheets.push({ name: s.title, head: s.head, rows: s.rows, sumCols: s.sumCols });
  docs.send(res, 'xlsx', await docs.buildXlsx({ b, title: 'Rapport complet du compte client', subtitle: sub, ref, sheets }), name);
}));

module.exports = { r, core, finish, stationProfit, payrollTotals, clientTotals, clientStationIds, parseRange, parseGroup, fiscalAmount, sectionsOf };
