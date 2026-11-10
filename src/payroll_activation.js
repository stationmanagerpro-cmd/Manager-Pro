// Activation progressive paie Mali — SuperAdmin autorise, client configure & active.
// Références indicatives (CLEISS 2025 / DGI Mali) : taux modifiables par le client.
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { featureOn, loadContractForUser } = require('./contracts');
const r = express.Router();

/** Taux / paramètres par défaut (sources publiques CLEISS, INPS, DGI — à ajuster par le client). */
const MODULE_DEFS = {
  payroll_amo_enabled: {
    code: 'payroll_amo_enabled',
    label: 'AMO — Assurance Maladie Obligatoire',
    contract_key: 'payroll_amo',
    description: 'Cotisations maladie obligatoires (CANAM / INPS). Assiette : salaire brut (plancher SMIG).',
    defaults: {
      employee_rate: 3.06,   // % part salariale (CLEISS 2025)
      employer_rate: 3.50,   // % part patronale
      min_base: 40000,       // SMIG mensuel XOF
      apply_to: 'all',       // all | selected
      employee_ids: [],
      effective_from: null,  // YYYY-MM-DD
      notes: ''
    },
    fields: [
      { key: 'employee_rate', label: 'Taux salarié (%)', type: 'number', step: 0.01, min: 0, max: 20, required: true },
      { key: 'employer_rate', label: 'Taux employeur (%)', type: 'number', step: 0.01, min: 0, max: 20, required: true },
      { key: 'min_base', label: 'Assiette minimale (SMIG XOF)', type: 'number', min: 0, required: true },
      { key: 'apply_to', label: 'Périmètre', type: 'select', options: [['all', 'Tous les employés actifs'], ['selected', 'Employés sélectionnés']], required: true },
      { key: 'effective_from', label: 'Date d\'effet', type: 'date', required: true },
      { key: 'notes', label: 'Notes / référence légale', type: 'text', required: false }
    ]
  },
  payroll_inps_enabled: {
    code: 'payroll_inps_enabled',
    label: 'INPS — Sécurité sociale',
    contract_key: 'payroll_inps',
    description: 'Branches INPS : vieillesse/invalidité/survivants, prestations familiales, accidents du travail.',
    defaults: {
      pension_employee_rate: 3.6,   // retraite part salariale
      pension_employer_rate: 5.4,   // retraite part patronale (3,4 % + 2 % invalidité)
      family_employer_rate: 8.0,    // prestations familiales (employeur seul)
      atmp_employer_rate: 2.0,      // accidents travail 1–4 % selon risque
      anpe_employer_rate: 1.0,      // taxe ANPE
      apply_to: 'all',
      employee_ids: [],
      effective_from: null,
      notes: ''
    },
    fields: [
      { key: 'pension_employee_rate', label: 'Retraite — taux salarié (%)', type: 'number', step: 0.01, min: 0, max: 20, required: true },
      { key: 'pension_employer_rate', label: 'Retraite — taux employeur (%)', type: 'number', step: 0.01, min: 0, max: 20, required: true },
      { key: 'family_employer_rate', label: 'Prestations familiales — employeur (%)', type: 'number', step: 0.01, min: 0, max: 20, required: true },
      { key: 'atmp_employer_rate', label: 'AT/MP — employeur (%) 1 à 4', type: 'number', step: 0.01, min: 0, max: 10, required: true },
      { key: 'anpe_employer_rate', label: 'Taxe ANPE — employeur (%)', type: 'number', step: 0.01, min: 0, max: 5, required: true },
      { key: 'apply_to', label: 'Périmètre', type: 'select', options: [['all', 'Tous les employés actifs'], ['selected', 'Employés sélectionnés']], required: true },
      { key: 'effective_from', label: 'Date d\'effet', type: 'date', required: true },
      { key: 'notes', label: 'Notes / référence', type: 'text', required: false }
    ]
  },
  payroll_its_enabled: {
    code: 'payroll_its_enabled',
    label: 'ITS — Impôt sur les traitements et salaires (DGI)',
    contract_key: 'payroll_its',
    description: 'Retenue à la source DGI. Réduction familiale : célibataire 0 %, marié 10 %, +2,5 % par enfant (max 10). INPS salarié déductible avant barème.',
    defaults: {
      // Réductions familiales (Code général des impôts)
      reduction_single: 0,
      reduction_married: 10,
      reduction_per_child: 2.5,
      max_children: 10,
      reduction_disabled_child: 10,
      deduct_inps_before_its: true,
      apply_to: 'all',
      employee_ids: [],
      effective_from: null,
      notes: ''
    },
    fields: [
      { key: 'reduction_single', label: 'Réduction célibataire / divorcé / veuf (%)', type: 'number', step: 0.1, min: 0, max: 50, required: true },
      { key: 'reduction_married', label: 'Réduction marié sans enfant (%)', type: 'number', step: 0.1, min: 0, max: 50, required: true },
      { key: 'reduction_per_child', label: 'Réduction par enfant à charge (%)', type: 'number', step: 0.1, min: 0, max: 20, required: true },
      { key: 'max_children', label: 'Nombre max d\'enfants pris en compte', type: 'number', min: 0, max: 20, required: true },
      { key: 'reduction_disabled_child', label: 'Réduction enfant handicapé (%)', type: 'number', step: 0.1, min: 0, max: 50, required: true },
      { key: 'deduct_inps_before_its', label: 'Déduire INPS salarié avant ITS', type: 'select', options: [['true', 'Oui'], ['false', 'Non']], required: true },
      { key: 'apply_to', label: 'Périmètre', type: 'select', options: [['all', 'Tous les employés actifs'], ['selected', 'Employés sélectionnés']], required: true },
      { key: 'effective_from', label: 'Date d\'effet', type: 'date', required: true },
      { key: 'notes', label: 'Notes / référence DGI', type: 'text', required: false }
    ]
  },
  payroll_employer_charges_enabled: {
    code: 'payroll_employer_charges_enabled',
    label: 'Charges patronales complémentaires',
    contract_key: 'payroll_charges',
    description: 'CFE, taxe logement, autres charges employeur configurables.',
    defaults: {
      cfe_rate: 3.5,
      housing_tax_rate: 1.0,
      apply_to: 'all',
      employee_ids: [],
      effective_from: null,
      notes: ''
    },
    fields: [
      { key: 'cfe_rate', label: 'Contribution forfaitaire employeur CFE (%)', type: 'number', step: 0.01, min: 0, max: 20, required: true },
      { key: 'housing_tax_rate', label: 'Taxe de logement (%)', type: 'number', step: 0.01, min: 0, max: 10, required: true },
      { key: 'apply_to', label: 'Périmètre', type: 'select', options: [['all', 'Tous les employés actifs'], ['selected', 'Employés sélectionnés']], required: true },
      { key: 'effective_from', label: 'Date d\'effet', type: 'date', required: true },
      { key: 'notes', label: 'Notes', type: 'text', required: false }
    ]
  }
};

const FLAG_TO_CONTRACT = Object.fromEntries(
  Object.values(MODULE_DEFS).map(m => [m.code, m.contract_key])
);

async function getPayrollRules(sid) {
  const { rows: [row] } = await pool.query(
    `SELECT value FROM settings WHERE station_id = $1 AND key = 'payroll_rules'`, [sid]
  ).catch(swallow('payroll_activation:121', { rows: [] }));
  return (row && row.value && typeof row.value === 'object') ? row.value : {};
}

async function getModuleConfigs(sid) {
  const { rows: [row] } = await pool.query(
    `SELECT value FROM settings WHERE station_id = $1 AND key = 'payroll_module_config'`, [sid]
  ).catch(swallow('payroll_activation:128', { rows: [] }));
  return (row && row.value && typeof row.value === 'object') ? row.value : {};
}

async function saveSetting(c, sid, key, value) {
  await c.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [sid, key, JSON.stringify(value)]
  );
}

function isAuthorized(contract, flagCode) {
  if (!contract || contract.unrestricted || contract.is_principal) return true;
  const ck = FLAG_TO_CONTRACT[flagCode];
  if (!ck) return false;
  // modules.payroll_* ou modules.hr global
  const mods = (contract.features && contract.features.modules) || contract.modules || {};
  if (mods[ck] === true) return true;
  if (featureOn(contract, 'module:' + ck)) return true;
  // Si RH global autorisé sans granularité, on autorise la configuration (pas l'auto-ON)
  if (featureOn(contract, 'can_access_hr') || featureOn(contract, 'module:hr')) return true;
  return false;
}

// ---------- Catalogue + statut (client) ----------
r.get('/hr/payroll-modules', need('hr.manage', 'hr.payroll', 'hr.settings'), wrap(async (req, res) => {
  const contract = req.contract || await loadContractForUser(req.user.id, req.user.is_global);
  const flags = await getPayrollRules(req.sid);
  const configs = await getModuleConfigs(req.sid);
  const modules = Object.values(MODULE_DEFS).map(def => {
    const authorized = isAuthorized(contract, def.code);
    const flagOn = !!flags[def.code];
    const cfg = configs[def.code] || null;
    return {
      code: def.code,
      label: def.label,
      description: def.description,
      contract_key: def.contract_key,
      authorized,
      flag_on: flagOn,
      config: cfg,
      defaults: def.defaults,
      fields: def.fields,
      can_activate: authorized && !flagOn,
      can_deactivate: authorized && flagOn,
      can_reconfigure: authorized && flagOn
    };
  });
  res.json({
    modules,
    note: 'Le SuperAdmin autorise le module sur le contrat. Le client active manuellement en renseignant les taux (modifiables). Sources indicatives : CLEISS / INPS / DGI Mali.',
    sources: [
      'CLEISS — Cotisations Mali 2025',
      'INPS / CANAM — AMO',
      'DGI Mali — ITS (réductions familiales)'
    ]
  });
}));

// Activer un module avec formulaire de paramètres
r.post('/hr/payroll-modules/:code/activate', need('hr.manage'), body(z.object({
  config: z.record(z.any()),
  reason: z.string().min(5),
  confirm: z.boolean().optional()
})), wrap(async (req, res) => {
  const code = req.params.code;
  const def = MODULE_DEFS[code];
  if (!def) throw new HttpError(404, 'Module inconnu');

  const contract = req.contract || await loadContractForUser(req.user.id, req.user.is_global);
  if (!isAuthorized(contract, code)) {
    throw new HttpError(403, 'Module non autorisé par le SuperAdmin sur votre contrat. Demandez l\'activation de « ' + def.label + ' ».');
  }
  if (!req.body.confirm) throw new HttpError(400, 'Confirmation requise (confirm: true)');

  const cfg = { ...def.defaults, ...req.body.config };
  // Normalisations
  if (cfg.deduct_inps_before_its === 'true') cfg.deduct_inps_before_its = true;
  if (cfg.deduct_inps_before_its === 'false') cfg.deduct_inps_before_its = false;
  if (cfg.apply_to === 'selected' && (!Array.isArray(cfg.employee_ids) || !cfg.employee_ids.length)) {
    throw new HttpError(400, 'Sélectionnez au moins un employé ou choisissez « Tous les employés »');
  }
  if (!cfg.effective_from) throw new HttpError(400, 'Date d\'effet obligatoire');

  const out = await tx(async c => {
    const flags = await getPayrollRules(req.sid);
    const configs = await getModuleConfigs(req.sid);
    flags[code] = true;
    configs[code] = {
      ...cfg,
      activated_at: new Date().toISOString(),
      activated_by: req.user.id,
      reason: req.body.reason
    };
    await saveSetting(c, req.sid, 'payroll_rules', flags);
    await saveSetting(c, req.sid, 'payroll_module_config', configs);
    await audit(c, req, 'paie', `Activation ${def.label} : ${req.body.reason}`, 'settings', null, null, { flag: code, config: configs[code] });
    return { flag: code, flag_on: true, config: configs[code] };
  });
  res.status(201).json(out);
}));

// Reconfigurer les taux sans désactiver
r.put('/hr/payroll-modules/:code/config', need('hr.manage'), body(z.object({
  config: z.record(z.any()),
  reason: z.string().min(5)
})), wrap(async (req, res) => {
  const code = req.params.code;
  const def = MODULE_DEFS[code];
  if (!def) throw new HttpError(404, 'Module inconnu');
  const contract = req.contract || await loadContractForUser(req.user.id, req.user.is_global);
  if (!isAuthorized(contract, code)) throw new HttpError(403, 'Module non autorisé par le SuperAdmin');

  const flags = await getPayrollRules(req.sid);
  if (!flags[code]) throw new HttpError(409, 'Activez d\'abord le module avant de reconfigurer');

  const cfg = { ...def.defaults, ...(await getModuleConfigs(req.sid))[code], ...req.body.config };
  if (cfg.deduct_inps_before_its === 'true') cfg.deduct_inps_before_its = true;
  if (cfg.deduct_inps_before_its === 'false') cfg.deduct_inps_before_its = false;

  const out = await tx(async c => {
    const configs = await getModuleConfigs(req.sid);
    configs[code] = {
      ...cfg,
      updated_at: new Date().toISOString(),
      updated_by: req.user.id,
      reason: req.body.reason
    };
    await saveSetting(c, req.sid, 'payroll_module_config', configs);
    await audit(c, req, 'paie', `Reconfiguration ${def.label} : ${req.body.reason}`, 'settings', null, null, { flag: code, config: configs[code] });
    return { flag: code, config: configs[code] };
  });
  res.json(out);
}));

// Désactiver
r.post('/hr/payroll-modules/:code/deactivate', need('hr.manage'), body(z.object({
  reason: z.string().min(5)
})), wrap(async (req, res) => {
  const code = req.params.code;
  const def = MODULE_DEFS[code];
  if (!def) throw new HttpError(404, 'Module inconnu');

  await tx(async c => {
    const flags = await getPayrollRules(req.sid);
    flags[code] = false;
    await saveSetting(c, req.sid, 'payroll_rules', flags);
    await audit(c, req, 'paie', `Désactivation ${def.label} : ${req.body.reason}`, 'settings', null, null, { flag: code });
  });
  res.json({ flag: code, flag_on: false });
}));

// Activer tous les modules autorisés (avec configs fournies ou défauts)
r.post('/hr/payroll-modules/activate-all', need('hr.manage'), body(z.object({
  reason: z.string().min(5),
  confirm: z.boolean(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  configs: z.record(z.record(z.any())).optional()
})), wrap(async (req, res) => {
  if (!req.body.confirm) throw new HttpError(400, 'Confirmation requise');
  const contract = req.contract || await loadContractForUser(req.user.id, req.user.is_global);
  const effective = req.body.effective_from || new Date().toISOString().slice(0, 10);
  const results = [];

  await tx(async c => {
    const flags = await getPayrollRules(req.sid);
    const configs = await getModuleConfigs(req.sid);
    for (const def of Object.values(MODULE_DEFS)) {
      if (!isAuthorized(contract, def.code)) {
        results.push({ code: def.code, status: 'skipped', reason: 'non autorisé SuperAdmin' });
        continue;
      }
      const extra = (req.body.configs && req.body.configs[def.code]) || {};
      flags[def.code] = true;
      configs[def.code] = {
        ...def.defaults,
        ...extra,
        effective_from: extra.effective_from || effective,
        activated_at: new Date().toISOString(),
        activated_by: req.user.id,
        reason: req.body.reason
      };
      results.push({ code: def.code, status: 'activated' });
    }
    await saveSetting(c, req.sid, 'payroll_rules', flags);
    await saveSetting(c, req.sid, 'payroll_module_config', configs);
    await audit(c, req, 'paie', `Activation groupée modules paie : ${req.body.reason}`, 'settings', null, null, { results });
  });
  res.status(201).json({ results });
}));

module.exports = r;
module.exports.MODULE_DEFS = MODULE_DEFS;
module.exports.isAuthorized = isAuthorized;
