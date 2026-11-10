'use strict';
/**
 * Assistant d'activation individuelle par impôt (Fiscalité + paie : ITS, INPS, AMO, CFE, TFP, taxes complémentaires).
 *
 * Règles (audit du 31/10/2026, §4) :
 *  - aucun module ne calcule ni n'affiche de montant tant qu'il n'est pas activé ici (garde dans fiscal_settings.requireActive) ;
 *  - tous les paramètres sont préremplis avec le jeu de référence versionné (src/fiscal_reference.js) et modifiables ;
 *  - chaque valeur modifiée est marquée « personnalisée » ; les valeurs contestées doivent être choisies explicitement ;
 *  - un taux nul ou vide ne passe pas sans confirmation explicite ;
 *  - la simulation sur les données réelles de la station n'enregistre rien ;
 *  - l'activation exige la case « valeurs vérifiées », un motif et une date d'effet ;
 *  - chaque modification crée une NOUVELLE version (historique jamais réécrit) et est journalisée ;
 *  - pour ITS, INPS, AMO, CFE, TFP : les mêmes paramètres alimentent la paie (une seule source).
 *  - le Superadmin autorise le module par contrat ; l'administrateur du client active et paramètre.
 */
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { featureOn } = require('./contracts');
const REF = require('./fiscal_reference');
const calc = require('./fiscal_calc');
const FS = require('./fiscal_settings');
const F = require('./fiscal');
const { getSetting } = require('./admin');

const r = express.Router();
const SOURCE_ORG = 'Assistant Fiscalité';
const PAYROLL_FLAG = { its: 'payroll_its_enabled', inps: 'payroll_inps_enabled', amo: 'payroll_amo_enabled', cfe: 'payroll_employer_charges_enabled', tfp: 'payroll_employer_charges_enabled' };
const CHARGE_CODE = { cfe: 'CFCE', tfp: 'TFP' };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date AAAA-MM-JJ');
const saveBody = z.object({
  params: z.record(z.any()),
  reason: z.string().trim().min(5, 'Motif obligatoire (5 caractères minimum)').max(300),
  effective_from: ymd,
  confirm_values: z.boolean().refine(v => v === true, 'Confirmez avoir vérifié les valeurs auprès de la DGI / d\'un professionnel'),
  confirm_zero: z.array(z.string().max(80)).max(50).optional()
});
const simBody = z.object({
  params: z.record(z.any()), confirm_zero: z.array(z.string().max(80)).max(50).optional(),
  period_start: ymd.optional(), period_end: ymd.optional(), data: z.record(z.any()).optional()
});
const deactBody = z.object({ reason: z.string().trim().min(5, 'Motif obligatoire (5 caractères minimum)').max(300) });

const allowedBySuperadmin = (contract, code) => !!(contract.unrestricted || featureOn(contract, 'module:fiscal_' + code)
  || (contract.features && contract.features.modules && contract.features.modules['fiscal_' + code] === true));

async function access(req, code) {
  const contract = await F.requireFiscalAccess(req);
  const cid = F.clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  if (!REF.has(code)) throw new HttpError(404, 'Module fiscal inconnu');
  if (!allowedBySuperadmin(contract, code)) throw new HttpError(403, 'Ce module n’est pas autorisé par l’Administrateur Principal.');
  return { contract, cid };
}

/** Les modules de la paie partagent leurs paramètres avec le moteur de paie : droit RH requis pour les modifier. */
function requirePayrollRights(req, contract, code) {
  if (!REF.MODULES[code].payroll) return;
  if (!req.user.perms.has('hr.manage')) {
    throw new HttpError(403, 'Ce module alimente aussi la paie : le droit « hr.manage » (gestion RH) est requis pour l\'activer ou le modifier.');
  }
  if (!(contract.unrestricted || featureOn(contract, 'can_access_hr') || featureOn(contract, 'module:hr'))) {
    throw new HttpError(403, 'Ce module alimente la paie, non autorisée sur votre contrat (module RH).');
  }
}

const sameKeys = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diffParams(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  return [...keys].filter(k => !sameKeys((prev || {})[k], (next || {})[k]));
}

// ---------------------------------------------------------------------------
// Lecture : présentation, paramètres sourcés, valeurs actuelles, comparaison avec le jeu de référence
// ---------------------------------------------------------------------------
r.get('/fiscal/wizard/:code', wrap(async (req, res) => {
  const code = req.params.code;
  const { cid } = await access(req, code);
  const desc = REF.describe(code);
  const act = await FS.getActivation(cid, code);
  const versions = await FS.listVersions(cid, code);
  const cur = versions[0] || null;
  res.json({
    ...desc,
    activation: act ? { activated: act.activated, effective_from: act.effective_from ? String(act.effective_from).slice(0, 10) : null, settings_version: act.settings_version, activation_reason: act.activation_reason, activated_at: act.activated_at, deactivated_at: act.deactivated_at, deactivation_reason: act.deactivation_reason } : null,
    needs_wizard: !!(act && act.activated && !act.settings_version),
    current: cur ? { version: cur.version, params: cur.params, customized: cur.customized, dataset_version: cur.dataset_version, effective_from: String(cur.effective_from).slice(0, 10), reason: cur.reason, created_at: cur.created_at } : null,
    dataset_newer: !!(cur && cur.dataset_version !== REF.DATASET_VERSION),
    comparison: cur ? REF.compareToReference(code, cur.params) : [],
    versions_count: versions.length,
    payroll_shared: !!REF.MODULES[code].payroll,
    disclaimer: F.DISCLAIMER
  });
}));

r.get('/fiscal/wizard/:code/history', wrap(async (req, res) => {
  const code = req.params.code;
  const { cid } = await access(req, code);
  const versions = await FS.listVersions(cid, code);
  res.json({ versions: versions.map((v, i) => ({
    version: v.version, effective_from: String(v.effective_from).slice(0, 10), reason: v.reason, created_at: v.created_at, created_by: v.created_by_login,
    dataset_version: v.dataset_version, customized: v.customized, zero_confirmed: v.zero_confirmed, params: v.params,
    changed_keys: i < versions.length - 1 ? diffParams(versions[i + 1].params, v.params) : Object.keys(v.params || {})
  })) });
}));

// ---------------------------------------------------------------------------
// Simulation sur les données réelles de la station (AUCUN enregistrement)
// ---------------------------------------------------------------------------
function contributionsFor(gross, inpsParams, amoParams) {
  let t = 0;
  for (const b of (inpsParams && inpsParams.branches) || []) t += (b.ceiling ? Math.min(gross, b.ceiling) : gross) * b.employee_rate / 100;
  if (amoParams && amoParams.employee_rate != null) t += (amoParams.ceiling ? Math.min(gross, Number(amoParams.ceiling)) : gross) * Number(amoParams.employee_rate) / 100;
  return calc.r2(t);
}

async function simulatePayroll(cid, code, P) {
  const { rows: emps } = await pool.query(
    `SELECT e.id, e.first_name, e.last_name, e.base_salary, e.family_status, e.dependents
       FROM employees e JOIN stations s ON s.id = e.station_id
      WHERE s.client_id = $1 AND e.deleted_at IS NULL AND e.status = 'actif' AND e.base_salary > 0
      ORDER BY e.last_name, e.first_name LIMIT 30`, [cid]);
  const warnings = ['SIMULATION sur le salaire de base des employés actifs (primes, heures supplémentaires et commissions non incluses). Rien n\'est enregistré.'];
  if (!emps.length) warnings.push('Aucun employé actif avec un salaire de base : simulation impossible.');
  let inpsS = null, amoS = null;
  if (code === 'its') {
    inpsS = await FS.getSettings(cid, 'inps'); amoS = await FS.getSettings(cid, 'amo');
    if (!inpsS && !amoS) warnings.push('Cotisations salariales (INPS, AMO) non paramétrées : l\'ITS est simulé SANS déduction de cotisations.');
  }
  const lines = []; let tot = 0, totEmployer = 0;
  for (const e of emps) {
    const gross = calc.r2(e.base_salary), name = `${e.last_name || ''} ${e.first_name || ''}`.trim();
    if (code === 'its') {
      const contrib = contributionsFor(gross, inpsS && inpsS.params, amoS && amoS.params);
      const res = calc.computeAnnualITS({ gross, employeeContributions: contrib }, {
        brackets: P.brackets, annualize: Number(P.annualize), deduct_contributions: P.deduct_contributions,
        family: { single_pct: P.family_single_pct, married_pct: P.family_married_pct, per_child_pct: P.family_per_child_pct, max_children: P.family_max_children }
      }, { family_status: e.family_status, children: e.dependents });
      lines.push({ employee: name, gross, contributions: contrib, its: res.amount, reduction_pct: res.detail.reduction_pct || 0 });
      tot += res.amount;
    } else if (code === 'inps') {
      let emp = 0, er = 0;
      for (const b of P.branches) { const base = b.ceiling ? Math.min(gross, b.ceiling) : gross; emp += base * b.employee_rate / 100; er += base * b.employer_rate / 100; }
      lines.push({ employee: name, gross, part_salariale: calc.r2(emp), part_employeur: calc.r2(er) });
      tot += emp; totEmployer += er;
    } else {
      const base = P.ceiling ? Math.min(gross, Number(P.ceiling)) : gross;
      const emp = base * Number(P.employee_rate) / 100, er = base * Number(P.employer_rate) / 100;
      lines.push({ employee: name, gross, part_salariale: calc.r2(emp), part_employeur: calc.r2(er) });
      tot += emp; totEmployer += er;
    }
  }
  const out = { module: code, source: 'simulation_employes', employee_count: lines.length, lines, warnings, disclaimer: F.DISCLAIMER };
  if (code === 'its') out.total_its = calc.r2(tot);
  else { out.part_salariale = calc.r2(tot); out.part_employeur = calc.r2(totEmployer); out.estimation = calc.r2(tot + totEmployer); }
  return out;
}

const prevMonth = () => {
  const d = new Date(); const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(), m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
};

r.post('/fiscal/wizard/:code/simulate', need('settings.edit'), body(simBody), wrap(async (req, res) => {
  const code = req.params.code;
  const { cid } = await access(req, code);
  const v = REF.validate(code, req.body.params, { confirmZero: req.body.confirm_zero });
  if (v.errors.length) throw new HttpError(422, 'Paramètres invalides', { code: 'FISCAL_PARAMS_INVALID', errors: v.errors, zero: v.zero });
  const [ds, de] = prevMonth();
  const ps = req.body.period_start || ds, pe = req.body.period_end || de;
  let result;
  if (['its', 'inps', 'amo'].includes(code)) result = await simulatePayroll(cid, code, v.values);
  else {
    result = await F.dispatchEstimate(cid, req.sid, code, ps, pe, req.body.data || {}, {
      params: v.values, version: null, dataset_version: REF.DATASET_VERSION, effective_from: null, customized: REF.customizedKeys(code, v.values),
      warnings: ['SIMULATION : rien n\'est enregistré, le module n\'est pas activé par cette simulation.'], simulation: true
    });
  }
  res.json({ simulation: true, period: { start: ps, end: pe }, zero_warnings: v.zero, customized: REF.customizedKeys(code, v.values), result, disclaimer: F.DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// Paie : une seule source de paramètres (ITS, INPS, AMO, CFE, TFP alimentent aussi le moteur de paie)
// ---------------------------------------------------------------------------
async function setFlag(c, sid, flag, on) {
  const current = await getSetting(sid, 'payroll_rules');
  const next = { ...current, feature_flags: { ...(current.feature_flags || {}), [flag]: on } };
  await c.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1,'payroll_rules',$2::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`, [sid, JSON.stringify(next)]);
}

async function syncPayroll(c, req, cid, code, V, effectiveFrom, reason, settingsVersion) {
  const { rows: stations } = await c.query('SELECT id FROM stations WHERE client_id = $1', [cid]);
  const ref = `jeu de référence ${REF.DATASET_VERSION} / paramètres v${settingsVersion}`;
  const common = [SOURCE_ORG, ref, `Créé par l'assistant d'activation Fiscalité : ${reason}`, req.user.id, reason];
  for (const { id: sid } of stations) {
    if (code === 'its') {
      await c.query(`UPDATE its_brackets SET technical_status = 'desactivee' WHERE station_id = $1 AND technical_status = 'active'`, [sid]);
      const { rows: [m] } = await c.query('SELECT COALESCE(MAX(version),0) AS v FROM its_brackets WHERE station_id = $1', [sid]);
      const ded = { mode: 'annual', annualize: Number(V.annualize), deduct_contributions: !!V.deduct_contributions,
        family: { single_pct: V.family_single_pct, married_pct: V.family_married_pct, per_child_pct: V.family_per_child_pct, max_children: V.family_max_children }, per_dependent: 0, min_taxable: 0 };
      await c.query(
        `INSERT INTO its_brackets(station_id, version, label, legal_status, technical_status, effective_from, brackets, deductions, source_org, source_ref, comment, approved_by, approved_at, approval_reason, created_by)
         VALUES ($1,$2,$3,'confirmee','active',$4::date,$5::jsonb,$6::jsonb,$7,$8,$9,$10,now(),$11,$10)`,
        [sid, (m.v || 0) + 1, `Barème ITS annuel (assistant, v${settingsVersion})`, effectiveFrom, JSON.stringify(V.brackets), JSON.stringify(ded), ...common]);
    } else if (code === 'inps' || code === 'amo') {
      const table = code === 'inps' ? 'inps_branches' : 'amo_branches';
      await c.query(`UPDATE ${table} SET technical_status = 'desactivee' WHERE station_id = $1 AND technical_status = 'active'`, [sid]);
      const branches = code === 'inps' ? V.branches : [{ code: 'AMO', label: 'Assurance maladie obligatoire', employee_rate: V.employee_rate, employer_rate: V.employer_rate, ceiling: V.ceiling }];
      for (const b of branches) {
        const { rows: [m] } = await c.query(`SELECT COALESCE(MAX(version),0) AS v FROM ${table} WHERE station_id = $1 AND code = $2`, [sid, b.code]);
        await c.query(
          `INSERT INTO ${table}(station_id, code, label, version, legal_status, technical_status, effective_from, employee_rate, employer_rate, base_kind, ceiling, source_org, source_ref, comment, approved_by, approved_at, approval_reason, created_by)
           VALUES ($1,$2,$3,$4,'confirmee','active',$5::date,$6,$7,'brut',$8,$9,$10,$11,$12,now(),$13,$12)`,
          [sid, b.code, b.label, (m.v || 0) + 1, effectiveFrom, b.employee_rate, b.employer_rate, b.ceiling, ...common]);
      }
    } else if (code === 'cfe' || code === 'tfp') {
      const ccode = CHARGE_CODE[code];
      await c.query(`UPDATE employer_charges SET technical_status = 'desactivee' WHERE station_id = $1 AND code = $2 AND technical_status = 'active'`, [sid, ccode]);
      const { rows: [m] } = await c.query('SELECT COALESCE(MAX(version),0) AS v FROM employer_charges WHERE station_id = $1 AND code = $2', [sid, ccode]);
      await c.query(
        `INSERT INTO employer_charges(station_id, code, label, version, legal_status, technical_status, effective_from, rate, fixed_amount, base_kind, ceiling, source_org, source_ref, comment, approved_by, approved_at, approval_reason, created_by)
         VALUES ($1,$2,$3,$4,'confirmee','active',$5::date,$6,NULL,'brut',NULL,$7,$8,$9,$10,now(),$11,$10)`,
        [sid, ccode, code === 'cfe' ? 'CFE — contribution forfaitaire à la charge des employeurs' : 'TFP — taxe de formation professionnelle', (m.v || 0) + 1, effectiveFrom, V.rate, ...common]);
    }
    await setFlag(c, sid, PAYROLL_FLAG[code], true);
  }
  await audit(c, req, 'paie', `Paramètres ${code.toUpperCase()} (assistant Fiscalité v${settingsVersion}) appliqués à la paie de ${stations.length} station(s) : ${reason}`, 'settings', null, null, { module: code, settings_version: settingsVersion, stations: stations.length });
  return stations.length;
}

async function deactivatePayroll(c, req, cid, code, reason) {
  const { rows: stations } = await c.query('SELECT id FROM stations WHERE client_id = $1', [cid]);
  for (const { id: sid } of stations) {
    let stillActive = false;
    if (code === 'its') {
      await c.query(`UPDATE its_brackets SET technical_status = 'desactivee' WHERE station_id = $1 AND technical_status = 'active' AND source_org = $2`, [sid, SOURCE_ORG]);
      stillActive = (await c.query(`SELECT 1 FROM its_brackets WHERE station_id = $1 AND technical_status = 'active' LIMIT 1`, [sid])).rowCount > 0;
    } else if (code === 'inps' || code === 'amo') {
      const table = code === 'inps' ? 'inps_branches' : 'amo_branches';
      await c.query(`UPDATE ${table} SET technical_status = 'desactivee' WHERE station_id = $1 AND technical_status = 'active' AND source_org = $2`, [sid, SOURCE_ORG]);
      stillActive = (await c.query(`SELECT 1 FROM ${table} WHERE station_id = $1 AND technical_status = 'active' LIMIT 1`, [sid])).rowCount > 0;
    } else {
      await c.query(`UPDATE employer_charges SET technical_status = 'desactivee' WHERE station_id = $1 AND code = $2 AND technical_status = 'active' AND source_org = $3`, [sid, CHARGE_CODE[code], SOURCE_ORG]);
      stillActive = (await c.query(`SELECT 1 FROM employer_charges WHERE station_id = $1 AND technical_status = 'active' LIMIT 1`, [sid])).rowCount > 0;
    }
    if (!stillActive) await setFlag(c, sid, PAYROLL_FLAG[code], false);
  }
  await audit(c, req, 'paie', `Désactivation ${code.toUpperCase()} (assistant Fiscalité) : ${reason}`, 'settings', null, null, { module: code });
}

// ---------------------------------------------------------------------------
// Activation (première fois) et nouvelle version (modification) : même validation, même journal
// ---------------------------------------------------------------------------
async function saveWizard(req, res, mode) {
  const code = req.params.code;
  const { contract, cid } = await access(req, code);
  requirePayrollRights(req, contract, code);
  const b = req.body;
  const act = await FS.getActivation(cid, code);
  if (mode === 'update' && !(act && act.activated)) throw new HttpError(409, 'Module non activé : utilisez l\'activation.');
  if (mode === 'activate' && act && act.activated && act.settings_version) throw new HttpError(409, 'Module déjà activé : modifiez ses paramètres (nouvelle version).');

  const v = REF.validate(code, b.params, { confirmZero: b.confirm_zero });
  if (v.errors.length) throw new HttpError(422, 'Paramètres invalides', { code: 'FISCAL_PARAMS_INVALID', errors: v.errors, zero: v.zero });
  if (v.zero.length) throw new HttpError(422, 'Taux nul ou vide : confirmez explicitement qu\'il est réellement nul.', { code: 'FISCAL_ZERO_RATE', zero: v.zero });

  const versions = await FS.listVersions(cid, code);
  const prev = versions[0] || null;
  if (prev && b.effective_from < String(prev.effective_from).slice(0, 10)) {
    throw new HttpError(422, `La date d'effet doit être postérieure ou égale à celle de la version précédente (${String(prev.effective_from).slice(0, 10)}) : l'historique n'est jamais réécrit.`, { code: 'FISCAL_EFFECTIVE_DATE' });
  }
  const customized = REF.customizedKeys(code, v.values);

  const out = await tx(async c => {
    const row = await FS.saveVersion(c, {
      clientId: cid, code, params: v.values, customized, zeroConfirmed: b.confirm_zero || [], datasetVersion: REF.DATASET_VERSION,
      effectiveFrom: b.effective_from, reason: b.reason, userId: req.user.id
    });
    let activation;
    if (mode === 'activate') {
      ({ rows: [activation] } = await c.query(
        `INSERT INTO fiscal_module_activations (client_id, module_code, activated, activated_at, activated_by, effective_from, settings_version, activation_reason)
         VALUES ($1,$2,true,now(),$3,$4::date,$5,$6)
         ON CONFLICT (client_id, module_code) DO UPDATE
           SET activated = true, activated_at = now(), activated_by = $3, deactivated_at = NULL, deactivation_reason = NULL,
               effective_from = $4::date, settings_version = $5, activation_reason = $6
         RETURNING *`, [cid, code, req.user.id, b.effective_from, row.version, b.reason]));
    } else {
      ({ rows: [activation] } = await c.query(
        `UPDATE fiscal_module_activations SET settings_version = $3 WHERE client_id = $1 AND module_code = $2 RETURNING *`, [cid, code, row.version]));
    }
    let stations = null;
    if (REF.MODULES[code].payroll) stations = await syncPayroll(c, req, cid, code, v.values, b.effective_from, b.reason, row.version);
    return { row, activation, stations };
  });

  await F.logFiscal(cid, req.user.id, mode === 'activate' ? 'wizard_activate' : 'wizard_new_version', 'fiscal_module_settings', out.row.id,
    prev ? { version: prev.version, params: prev.params } : null,
    { module: code, version: out.row.version, effective_from: b.effective_from, reason: b.reason, customized, zero_confirmed: b.confirm_zero || [], dataset_version: REF.DATASET_VERSION, changed_keys: diffParams(prev && prev.params, v.values), payroll_stations: out.stations }, req.ip);

  res.status(mode === 'activate' ? 201 : 200).json({
    activation: out.activation, settings: { version: out.row.version, effective_from: b.effective_from, customized, dataset_version: REF.DATASET_VERSION },
    payroll_stations: out.stations, disclaimer: F.DISCLAIMER
  });
}

r.post('/fiscal/wizard/:code/activate', need('settings.edit'), body(saveBody), wrap((req, res) => saveWizard(req, res, 'activate')));
r.put('/fiscal/wizard/:code/settings', need('settings.edit'), body(saveBody), wrap((req, res) => saveWizard(req, res, 'update')));

r.post('/fiscal/wizard/:code/deactivate', need('settings.edit'), body(deactBody), wrap(async (req, res) => {
  const code = req.params.code;
  const { contract, cid } = await access(req, code);
  requirePayrollRights(req, contract, code);
  const act = await FS.getActivation(cid, code);
  if (!act || !act.activated) throw new HttpError(409, 'Module non activé.');
  const out = await tx(async c => {
    const { rows: [row] } = await c.query(
      `UPDATE fiscal_module_activations SET activated = false, deactivated_at = now(), deactivation_reason = $3
       WHERE client_id = $1 AND module_code = $2 RETURNING *`, [cid, code, req.body.reason]);
    if (REF.MODULES[code].payroll) await deactivatePayroll(c, req, cid, code, req.body.reason);
    return row;
  });
  await F.logFiscal(cid, req.user.id, 'wizard_deactivate', 'fiscal_module_activations', out.id, { activated: true, settings_version: act.settings_version }, { activated: false, reason: req.body.reason }, req.ip);
  res.json({ activation: out, note: 'Les périodes déjà clôturées (validées en interne ou archivées) restent figées. Les périodes ouvertes n\'affichent plus de montant.', disclaimer: F.DISCLAIMER });
}));

module.exports = r;
