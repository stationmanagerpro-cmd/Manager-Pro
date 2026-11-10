/**
 * Module Fiscalité — Manager PRO
 * Assistance à la préparation des obligations fiscales (Mali).
 * N'est PAS un service de dépôt à la DGI. Les calculs sont des ESTIMATIONS.
 *
 * Rôles (strict) :
 * - Superadmin (is_global, sans station) : UNIQUEMENT autoriser / interdire via le contrat client
 *   (routes /admin/clients/:id/fiscal). Ne gère PAS le parcours fiscal opérationnel.
 * - Administrateur / utilisateurs du compte client : profil, modules, périodes, estimations,
 *   pièces, échéances — dans la limite des flags accordés par le Superadmin.
 */
'use strict';
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { swallow, ignored } = require('./safe');
const { loadContractForUser, featureOn, mergeFeatures } = require('./contracts');
const calc = require('./fiscal_calc');
const FS = require('./fiscal_settings');
const REF = require('./fiscal_reference');
const profitability = require('./profitability');   // source unique : chiffre d'affaires, charges et paie (mêmes définitions que le tableau de bord et les rapports)

const r = express.Router();

// Catalogue des modules : généré depuis le jeu de référence versionné (src/fiscal_reference.js)
const MODULE_DEFS = REF.CODES.map(code => ({ code, label: REF.MODULES[code].label, desc: REF.MODULES[code].presentation.role, group: REF.MODULES[code].group, payroll: !!REF.MODULES[code].payroll }));

const DISCLAIMER = 'Les montants affichés sont des estimations indicatives destinées à la préparation. '
  + 'Ils ne constituent ni une déclaration officielle, ni un avis de la Direction générale des Impôts, '
  + 'ni un conseil fiscal. Faites valider par un professionnel habilité avant tout dépôt ou paiement.';

/**
 * Accès opérationnel Fiscalité — réservé au compte CLIENT (pas Superadmin).
 * Le Superadmin n’a pas de station et ne gère pas le parcours fiscal : il autorise via le contrat.
 */
async function requireFiscalAccess(req) {
  if (req.user && req.user.is_global) {
    throw new HttpError(403,
      'Le Superadmin n’utilise pas le parcours Fiscalité opérationnel. '
      + 'Autorisez le module sur la fiche contrat du client (interface des autorisations).',
      { code: 'FISCAL_SUPERADMIN_NO_OPS' }
    );
  }
  if (!req.user.client_id) {
    throw new HttpError(403, 'Aucun compte client lié. Fiscalité réservée aux utilisateurs d’un client.', {
      code: 'FISCAL_NO_CLIENT'
    });
  }
  if (!req.user.perms || !req.user.perms.has('fiscal.access')) {
    throw new HttpError(403, 'Permission Fiscalité refusée pour votre rôle. Contactez l’Administrateur Principal.', {
      code: 'FISCAL_PERMISSION_DENIED'
    });
  }
  const contract = await loadContractForUser(req.user.id, false);
  if (!featureOn(contract, 'can_access_fiscal') && !featureOn(contract, 'module:fiscal')) {
    throw new HttpError(403, 'Module Fiscalité non autorisé sur votre contrat. Contactez l’Administrateur Principal.', {
      code: 'FISCAL_DISABLED'
    });
  }
  return contract;
}

function clientIdOf(req) {
  return req.user.client_id || null;
}

async function logFiscal(clientId, userId, action, entityType, entityId, oldData, newData, ip) {
  await pool.query(
    `INSERT INTO fiscal_audit_log (client_id, user_id, action, entity_type, entity_id, old_data, new_data, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [clientId, userId, action, entityType || null, entityId || null,
      oldData ? JSON.stringify(oldData) : null,
      newData ? JSON.stringify(newData) : null, ip || null]
  );
}

/**
 * Masquage des montants : un module non activé (via l'assistant) n'affiche AUCUN montant — jamais de « 0 » trompeur.
 * Les estimations anciennes de modules non activés sont remplacées par un marqueur « Module non activé ».
 */
const NOT_ACTIVATED_MARK = { module_not_activated: true, message: 'Module non activé', warnings: [] };
async function maskEstimates(clientId, rows) {
  if (!rows || !rows.length) return rows;
  const { rows: act } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated = true AND settings_version IS NOT NULL', [clientId]
  );
  const on = new Set(act.map(a => a.module_code));
  for (const row of rows) {
    if (!row || !row.module_code || on.has(row.module_code)) continue;
    if (row.status && ['valide_interne', 'archive'].includes(row.status) && row.estimates && !row.estimates.module_not_activated) continue; // période clôturée : figée
    row.estimates = { ...NOT_ACTIVATED_MARK };
  }
  return rows;
}

// ---------- Catalogue des modules (lecture) ----------
r.get('/fiscal/modules', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  let activations = [];
  if (cid) {
    const { rows } = await pool.query(
      'SELECT module_code, activated, activated_at, settings_version, effective_from FROM fiscal_module_activations WHERE client_id = $1', [cid]
    );
    activations = rows;
  }
  const actMap = Object.fromEntries(activations.map(a => [a.module_code, a]));
  const features = contract.features || mergeFeatures({});
  const list = MODULE_DEFS.map(m => {
    const allowed = contract.unrestricted
      || featureOn(contract, 'module:fiscal_' + m.code)
      || (features.modules && features.modules['fiscal_' + m.code] === true);
    const act = actMap[m.code];
    return {
      ...m,
      allowed_by_superadmin: !!allowed,
      activated_by_client: !!(act && act.activated && act.settings_version),
      needs_wizard: !!(act && act.activated && !act.settings_version),
      settings_version: act ? act.settings_version : null,
      effective_from: act && act.effective_from ? String(act.effective_from).slice(0, 10) : null,
      activated_at: act ? act.activated_at : null
    };
  });
  res.json({ modules: list, disclaimer: DISCLAIMER });
}));

// ---------- Profil fiscal ----------
r.get('/fiscal/profile', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié à ce compte');
  const { rows: [p] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  res.json({ profile: p || null, disclaimer: DISCLAIMER });
}));

r.put('/fiscal/profile', need('settings.edit'), body(z.object({
  legal_name: z.string().max(200).optional().nullable(),
  trade_name: z.string().max(200).optional().nullable(),
  legal_form: z.string().max(50).optional().nullable(),
  nif: z.string().max(50).optional().nullable(),
  activity_sector: z.string().max(100).optional().nullable(),
  main_activity: z.string().max(200).optional().nullable(),
  secondary_activities: z.string().max(500).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  tax_center: z.string().max(150).optional().nullable(),
  activity_start_date: z.string().optional().nullable(),
  fiscal_year_start: z.number().int().min(1).max(12).optional().nullable(),
  registration_status: z.enum(['a_completer', 'en_cours', 'valide', 'a_verifier']).optional(),
  estimated_annual_ca: z.number().min(0).optional().nullable(),
  current_year_ca: z.number().min(0).optional().nullable(),
  has_employees: z.boolean().optional(),
  employee_count: z.number().int().min(0).optional().nullable(),
  has_other_establishments: z.boolean().optional(),
  has_exemption: z.boolean().optional(),
  exemption_details: z.string().max(500).optional().nullable(),
  declared_regime: z.string().max(50).optional().nullable(),
  notes: z.string().max(2000).optional().nullable()
}).partial()), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query('SELECT * FROM fiscal_profiles WHERE client_id = $1 FOR UPDATE', [cid]);
    if (!old) {
      const { rows: [n] } = await c.query(
        `INSERT INTO fiscal_profiles (
          client_id, legal_name, trade_name, legal_form, nif, activity_sector, main_activity,
          secondary_activities, address, city, tax_center, activity_start_date, fiscal_year_start,
          registration_status, estimated_annual_ca, current_year_ca, has_employees, employee_count,
          has_other_establishments, has_exemption, exemption_details, declared_regime, notes,
          last_updated_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        RETURNING *`,
        [cid, b.legal_name, b.trade_name, b.legal_form, b.nif, b.activity_sector, b.main_activity,
          b.secondary_activities, b.address, b.city, b.tax_center, b.activity_start_date || null,
          b.fiscal_year_start || 1, b.registration_status || 'a_completer',
          b.estimated_annual_ca, b.current_year_ca, b.has_employees || false, b.employee_count,
          b.has_other_establishments || false, b.has_exemption || false, b.exemption_details,
          b.declared_regime, b.notes, req.user.id]
      );
      await logFiscal(cid, req.user.id, 'create_profile', 'fiscal_profiles', n.id, null, n, req.ip);
      return n;
    }
    const keys = Object.keys(b).filter(k => b[k] !== undefined);
    if (!keys.length) return old;
    const sets = keys.map((k, i) => `${k} = $${i + 3}`);
    sets.push('last_updated_at = now()', 'last_updated_by = $2');
    const { rows: [n] } = await c.query(
      `UPDATE fiscal_profiles SET ${sets.join(', ')} WHERE client_id = $1 RETURNING *`,
      [cid, req.user.id, ...keys.map(k => b[k])]
    );
    await logFiscal(cid, req.user.id, 'update_profile', 'fiscal_profiles', n.id, old, n, req.ip);
    return n;
  });
  res.json({ profile: out, disclaimer: DISCLAIMER });
}));

// ---------- Activation modules par le client ----------
// L'activation passe EXCLUSIVEMENT par l'assistant (src/fiscal_wizard.js) : paramètres, test, confirmation, journal.
const WIZARD_ONLY = wrap(async () => {
  throw new HttpError(409, 'Activation et désactivation passent par l’assistant d’activation du module (paramètres, test, confirmation).', { code: 'FISCAL_USE_WIZARD' });
});
r.post('/fiscal/modules/:code/activate', need('settings.edit'), WIZARD_ONLY);
r.post('/fiscal/modules/:code/deactivate', need('settings.edit'), WIZARD_ONLY);

// ---------- Périodes / estimations (squelette — calculs détaillés lot suivant) ----------
r.get('/fiscal/periods', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const params = [cid];
  let where = 'WHERE client_id = $1';
  if (req.query.module) {
    params.push(req.query.module);
    where += ` AND module_code = $${params.length}`;
  }
  if (req.query.status) {
    params.push(req.query.status);
    where += ` AND status = $${params.length}`;
  }
  if (req.query.from) {
    params.push(req.query.from);
    where += ` AND period_start >= $${params.length}::date`;
  }
  if (req.query.to) {
    params.push(req.query.to);
    where += ` AND period_end <= $${params.length}::date`;
  }
  if (req.query.q) {
    params.push('%' + String(req.query.q).slice(0, 100) + '%');
    where += ` AND (notes ILIKE $${params.length} OR data::text ILIKE $${params.length})`;
  }
  if (req.query.tag) {
    params.push(String(req.query.tag).slice(0, 50));
    where += ` AND data->'tags' ? $${params.length}`;
  }
  if (req.query.pinned === '1' || req.query.pinned === 'true') {
    where += ` AND (data->>'pinned')::text = 'true'`;
  }
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  params.push(limit);
  const q = await pool.query(
    `SELECT * FROM fiscal_periods ${where} ORDER BY period_start DESC LIMIT $${params.length}`,
    params
  );
  await maskEstimates(cid, q.rows);
  res.json({ periods: q.rows, disclaimer: DISCLAIMER });
}));

r.post('/fiscal/periods', need('settings.edit'), body(z.object({
  module_code: z.string().min(1),
  period_type: z.enum(['month', 'quarter', 'year', 'custom']),
  period_start: z.string(),
  period_end: z.string(),
  data: z.record(z.any()).optional(),
  notes: z.string().max(2000).optional()
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_prepare') && !contract.unrestricted) {
    throw new HttpError(403, 'Préparation des périodes fiscales non autorisée sur votre contrat.');
  }
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const b = req.body;
  // Vérifier activation
  const { rows: [act] } = await pool.query(
    'SELECT activated FROM fiscal_module_activations WHERE client_id = $1 AND module_code = $2',
    [cid, b.module_code]
  );
  if (!act || !act.activated) {
    throw new HttpError(400, 'Activez d’abord ce module fiscal avant de créer une période.');
  }
  const { rows: [profile] } = await pool.query(
    'SELECT registration_status, nif, declared_regime FROM fiscal_profiles WHERE client_id = $1', [cid]
  );
  const warnings = [];
  if (!profile || profile.registration_status === 'a_completer' || !profile.nif) {
    warnings.push('Profil fiscal incomplet (NIF / statut). Complétez l’étape 1 pour des estimations plus utiles.');
  }
  // Chevauchement de périodes même module (Lot 12)
  const { rows: overlaps } = await pool.query(
    `SELECT id, period_start, period_end, status FROM fiscal_periods
     WHERE client_id = $1 AND module_code = $2 AND status <> 'archive'
       AND period_start <= $4::date AND period_end >= $3::date
     LIMIT 5`,
    [cid, b.module_code, b.period_start, b.period_end]
  );
  if (overlaps.length) {
    warnings.push(
      'Chevauchement avec période(s) existante(s) : '
      + overlaps.map(o => `#${o.id} (${o.period_start}→${o.period_end})`).join(', ')
    );
    if (req.body.force !== true && req.query.force !== '1') {
      // avertissement non bloquant : on crée quand même, le client voit le warning
    }
  }
  const { rows: [p] } = await pool.query(
    `INSERT INTO fiscal_periods (client_id, station_id, module_code, period_type, period_start, period_end, data, prepared_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [cid, req.sid || null, b.module_code, b.period_type, b.period_start, b.period_end,
      JSON.stringify(b.data || {}), req.user.id, b.notes || null]
  );
  await ensureChecklist(cid, p.id, p.module_code).catch(swallow('fiscal:ensureChecklist', undefined));
  await logFiscal(cid, req.user.id, 'create_period', 'fiscal_periods', p.id, null, p, req.ip);
  res.status(201).json({ period: p, warnings, overlaps, disclaimer: DISCLAIMER });
}));

// ---------- Tableau de bord fiscal (indicateurs dynamiques) ----------
r.get('/fiscal/dashboard', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  const { rows: acts } = await pool.query(
    'SELECT module_code, activated FROM fiscal_module_activations WHERE client_id = $1 AND activated = true', [cid]
  );
  const { rows: periods } = await pool.query(
    `SELECT module_code, status, period_start, period_end, estimates
     FROM fiscal_periods WHERE client_id = $1 ORDER BY period_start DESC LIMIT 20`, [cid]
  );
  await maskEstimates(cid, periods);
  const { rows: deadlines } = await pool.query(
    `SELECT * FROM fiscal_deadlines
     WHERE (client_id = $1 OR client_id IS NULL) AND status IN ('a_venir','en_cours','depasse')
     ORDER BY due_date ASC LIMIT 15`, [cid]
  );
  const cards = [];
  if (!profile || profile.registration_status === 'a_completer') {
    cards.push({ id: 'profile', type: 'warning', title: 'Profil fiscal à compléter', value: 'À renseigner', hint: 'Étape 1 du parcours Fiscalité' });
  } else {
    cards.push({
      id: 'regime',
      type: 'info',
      title: 'Régime déclaré',
      value: profile.declared_regime || 'Non renseigné',
      hint: profile.regime_validated ? 'Validé en interne' : 'À vérifier'
    });
  }
  for (const a of acts) {
    const last = periods.find(p => p.module_code === a.module_code);
    cards.push({
      id: 'mod_' + a.module_code,
      type: 'module',
      title: (MODULE_DEFS.find(m => m.code === a.module_code) || {}).label || a.module_code,
      value: last ? (last.status === 'pret' || last.status === 'valide_interne' ? 'Période prête' : 'En cours') : 'Aucune période',
      hint: last ? `${last.period_start} → ${last.period_end}` : 'Créer une période'
    });
  }
  if (!acts.length) {
    cards.push({ id: 'no_mod', type: 'info', title: 'Aucun module activé', value: '—', hint: 'Activez au moins un module (Étape 2)' });
  }
  res.json({
    cards,
    profile_status: profile ? profile.registration_status : 'a_completer',
    activated_modules: acts.map(a => a.module_code),
    upcoming_deadlines: deadlines,
    disclaimer: DISCLAIMER
  });
}));

// ---------- Superadmin : autorisations fiscales d’un client ----------
r.get('/admin/clients/:id/fiscal', need('user.manage'), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal');
  const clientId = +req.params.id;
  const { rows: [ct] } = await pool.query('SELECT features FROM client_contracts WHERE client_id = $1', [clientId]);
  const features = mergeFeatures(ct ? ct.features : {});
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [clientId]);
  const { rows: acts } = await pool.query(
    'SELECT * FROM fiscal_module_activations WHERE client_id = $1', [clientId]
  );
  res.json({
    features: {
      can_access_fiscal: !!features.can_access_fiscal,
      can_fiscal_estimates: !!features.can_fiscal_estimates,
      can_fiscal_exports: !!features.can_fiscal_exports,
      can_fiscal_prepare: !!features.can_fiscal_prepare,
      can_fiscal_deadlines: !!features.can_fiscal_deadlines,
      modules: Object.fromEntries(
        MODULE_DEFS.map(m => ['fiscal_' + m.code, !!(features.modules && features.modules['fiscal_' + m.code])])
      )
    },
    profile,
    activations: acts,
    module_defs: MODULE_DEFS,
    disclaimer: DISCLAIMER
  });
}));

r.put('/admin/clients/:id/fiscal', need('user.manage'), body(z.object({
  can_access_fiscal: z.boolean().optional(),
  can_fiscal_estimates: z.boolean().optional(),
  can_fiscal_exports: z.boolean().optional(),
  can_fiscal_prepare: z.boolean().optional(),
  can_fiscal_deadlines: z.boolean().optional(),
  modules: z.record(z.boolean()).optional()
}).partial()), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal');
  const clientId = +req.params.id;
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [ct] } = await c.query(
      'SELECT id, features FROM client_contracts WHERE client_id = $1 FOR UPDATE', [clientId]
    );
    if (!ct) throw new HttpError(404, 'Contrat client introuvable');
    const features = mergeFeatures(ct.features || {});
    if (b.can_access_fiscal !== undefined) features.can_access_fiscal = b.can_access_fiscal;
    if (b.can_fiscal_estimates !== undefined) features.can_fiscal_estimates = b.can_fiscal_estimates;
    if (b.can_fiscal_exports !== undefined) features.can_fiscal_exports = b.can_fiscal_exports;
    if (b.can_fiscal_prepare !== undefined) features.can_fiscal_prepare = b.can_fiscal_prepare;
    if (b.can_fiscal_deadlines !== undefined) features.can_fiscal_deadlines = b.can_fiscal_deadlines;
    if (b.modules) {
      features.modules = features.modules || {};
      for (const [k, v] of Object.entries(b.modules)) {
        if (k.startsWith('fiscal_') || k === 'fiscal') features.modules[k] = !!v;
      }
      // Si au moins un sous-module ou le flag principal est ON, l'accès global doit
      // être activé immédiatement. mergeFeatures normalise aussi les contrats existants.
      const fiscalSubmoduleEnabled = Object.entries(features.modules).some(([key, value]) =>
        key.startsWith('fiscal_') && value === true
      );
      if (features.can_access_fiscal || fiscalSubmoduleEnabled) {
        features.can_access_fiscal = true;
        features.modules.fiscal = true;
      }
    }
    await c.query('UPDATE client_contracts SET features = $2, updated_at = now(), updated_by = $3 WHERE id = $1',
      [ct.id, JSON.stringify(features), req.user.id]);
    await audit(c, req, 'contrats', 'Autorisations fiscales client ' + clientId, 'client_contracts', ct.id,
      ct.features, features);
    return features;
  });
  res.json({ features: out, disclaimer: DISCLAIMER });
}));

// ---------- Règles fiscales (lecture + Superadmin écriture) ----------
r.get('/fiscal/rules', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const tax = req.query.tax || null;
  const q = tax
    ? await pool.query(
      `SELECT * FROM fiscal_rules WHERE tax_code = $1 AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
       ORDER BY version DESC`, [tax]
    )
    : await pool.query(
      `SELECT * FROM fiscal_rules WHERE effective_to IS NULL OR effective_to >= CURRENT_DATE ORDER BY tax_code, version DESC`
    );
  res.json({ rules: q.rows, disclaimer: DISCLAIMER });
}));

r.post('/fiscal/rules', need('user.manage'), body(z.object({
  tax_code: z.string().min(1),
  rule_key: z.string().min(1),
  rule_value: z.record(z.any()),
  conditions: z.record(z.any()).optional(),
  regime: z.string().optional().nullable(),
  effective_from: z.string(),
  effective_to: z.string().optional().nullable(),
  legal_source: z.string().optional().nullable(),
  legal_reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal');
  const b = req.body;
  const { rows: [last] } = await pool.query(
    'SELECT COALESCE(MAX(version),0) AS v FROM fiscal_rules WHERE tax_code = $1 AND rule_key = $2',
    [b.tax_code, b.rule_key]
  );
  const version = (last?.v || 0) + 1;
  const { rows: [row] } = await pool.query(
    `INSERT INTO fiscal_rules (
      tax_code, rule_key, rule_value, conditions, regime, effective_from, effective_to,
      legal_source, legal_reference, version, verification_status, notes, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'a_verifier',$11,$12) RETURNING *`,
    [b.tax_code, b.rule_key, JSON.stringify(b.rule_value), JSON.stringify(b.conditions || {}),
      b.regime || null, b.effective_from, b.effective_to || null,
      b.legal_source || null, b.legal_reference || null, version, b.notes || null, req.user.id]
  );
  res.status(201).json({ rule: row, disclaimer: DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// LOT 2 — Moteurs d'estimation (indicatifs)
// ---------------------------------------------------------------------------

/** Charge la règle active la plus récente pour un impôt/clé (statut verifiee prioritaire, sinon a_verifier). */
async function getActiveRule(taxCode, ruleKey, asOfDate) {
  const d = asOfDate || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT * FROM fiscal_rules
     WHERE tax_code = $1 AND rule_key = $2
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY CASE verification_status WHEN 'verifiee' THEN 0 ELSE 1 END, version DESC
     LIMIT 1`,
    [taxCode, ruleKey, d]
  );
  return rows[0] || null;
}

/**
 * Estimation TVA sur une période à partir des ventes (sale_details.tax_rate)
 * et des achats facturés (approximation — pas de TVA ligne à ligne sur purchases).
 * Toujours accompagnée de warnings et du disclaimer.
 */
async function estimateTVA(clientId, stationId, periodStart, periodEnd, manualData, cfg) {
  const warnings = [];
  const P = cfg.params;
  const defaultRate = Number(P.standard_rate);

  // Stations du client
  let stationFilter = '';
  const params = [clientId, periodStart, periodEnd];
  if (stationId) {
    stationFilter = ' AND s.station_id = $4';
    params.push(stationId);
  }

  // TVA collectée depuis sale_details (tax_rate saisi par produit)
  const salesQ = await pool.query(
    `SELECT
       COALESCE(SUM(sd.amount), 0) AS total_ttc_approx,
       COALESCE(SUM(CASE WHEN sd.tax_rate > 0 THEN sd.amount / (1 + sd.tax_rate/100.0) ELSE sd.amount END), 0) AS base_ht,
       COALESCE(SUM(CASE WHEN sd.tax_rate > 0 THEN sd.amount - (sd.amount / (1 + sd.tax_rate/100.0)) ELSE 0 END), 0) AS tva_collected,
       COALESCE(SUM(CASE WHEN sd.tax_rate = 0 THEN sd.amount ELSE 0 END), 0) AS exempt_or_zero,
       COUNT(*)::int AS line_count
     FROM sale_details sd
     JOIN sales s ON s.id = sd.sale_id
     JOIN stations st ON st.id = s.station_id
     WHERE st.client_id = $1
       AND s.status = 'valide'
       AND s.sold_at::date >= $2::date AND s.sold_at::date <= $3::date
       ${stationFilter}`,
    params
  );
  const sales = salesQ.rows[0] || {};
  // Lien Fiscalité ↔ Ventes/Compteurs : la base TVA vient des lignes de vente saisies ; le chiffre d'affaires du système
  // (ventes produits + compteurs de pompes des quarts clôturés) peut différer si des litres ne sont pas saisis en vente.
  // Écart entre le chiffre d'affaires du système (ventes + compteurs de pompes des quarts clôturés, comme la comptabilité)
  // et les lignes de vente saisies : chiffré, et — si le paramètre « inclure le carburant des compteurs » est activé — ajouté.
  let ecartBase = null, tvaSurEcart = 0;
  try {
    const ref = await profitability.clientTotals(clientId, stationId || null, periodStart, periodEnd);
    const lines = Number(sales.total_ttc_approx || 0);
    const ecart = Math.round((ref.revenue - lines) * 100) / 100;
    const tvaPotentielle = ecart > 0 ? Math.round(ecart * defaultRate / (100 + defaultRate) * 100) / 100 : 0;
    ecartBase = { chiffre_affaires_systeme: Math.round(ref.revenue * 100) / 100, total_lignes_vente: Math.round(lines * 100) / 100, ecart, tva_potentielle_sur_ecart: tvaPotentielle, inclus_dans_le_calcul: false };
    if (ref.revenue > 0 && Math.abs(ecart) / ref.revenue > 0.01) {
      if (P.include_fuel_counters && ecart > 0) {
        tvaSurEcart = tvaPotentielle; ecartBase.inclus_dans_le_calcul = true;
        warnings.push(`Écart de base TVA de ${Math.round(ecart)} (carburant des compteurs de pompes non saisi en lignes de vente) : TVA estimée sur cet écart (${Math.round(tvaPotentielle)}) incluse, comme dans la comptabilité. Vérifier.`);
      } else {
        warnings.push(`Écart de base TVA de ${Math.round(ecart)} entre le chiffre d'affaires du système (${Math.round(ref.revenue)}) et les lignes de vente (${Math.round(lines)}) ; TVA potentielle sur cet écart : ${Math.round(tvaPotentielle)} (non incluse).`);
      }
    }
  } catch (_) { /* contrôle indicatif : sans effet sur l'estimation */ }
  const tvaCollected = Number(sales.tva_collected || 0) + tvaSurEcart;
  const baseHt = Number(sales.base_ht || 0);
  const exempt = Number(sales.exempt_or_zero || 0);

  // Achats : TVA déductible depuis purchase_details.tax_rate (Lot 3) + saisie manuelle prioritaire
  let tvaDeductible = 0;
  let purchasesTotal = 0;
  let tvaFromLines = 0;
  let deductibleCalculable = true;
  const purchParams = stationId
    ? [clientId, periodStart, periodEnd, stationId]
    : [clientId, periodStart, periodEnd];
  const purchFilter = stationId ? ' AND p.station_id = $4' : '';
  const purchQ = await pool.query(
    `SELECT COALESCE(SUM(COALESCE(p.invoice_total, p.total)), 0) AS total
     FROM purchases p
     JOIN stations st ON st.id = p.station_id
     WHERE st.client_id = $1
       AND p.status IN ('facture','paye','recu')
       AND COALESCE(p.invoice_date, p.received_at::date, p.ordered_at::date) >= $2::date
       AND COALESCE(p.invoice_date, p.received_at::date, p.ordered_at::date) <= $3::date
       ${purchFilter}`,
    purchParams
  );
  purchasesTotal = Number(purchQ.rows[0]?.total || 0);

  try {
    const linesQ = await pool.query(
      `SELECT
         COALESCE(SUM(pd.qty_received * pd.unit_cost), 0) AS base_approx,
         COALESCE(SUM(
           CASE WHEN pd.tax_rate > 0
             THEN (pd.qty_received * pd.unit_cost) * (pd.tax_rate / 100.0)
             ELSE 0 END
         ), 0) AS tva_lines,
         COUNT(*) FILTER (WHERE pd.tax_rate > 0)::int AS lines_with_tax
       FROM purchase_details pd
       JOIN purchases p ON p.id = pd.purchase_id
       JOIN stations st ON st.id = p.station_id
       WHERE st.client_id = $1
         AND p.status IN ('facture','paye','recu')
         AND COALESCE(p.invoice_date, p.received_at::date, p.ordered_at::date) >= $2::date
         AND COALESCE(p.invoice_date, p.received_at::date, p.ordered_at::date) <= $3::date
         ${purchFilter}`,
      purchParams
    );
    tvaFromLines = Number(linesQ.rows[0]?.tva_lines || 0);
    if (linesQ.rows[0]?.lines_with_tax > 0) {
      tvaDeductible = tvaFromLines;
    }
  } catch (e) {
    warnings.push('Lecture tax_rate achats indisponible (migration 048 non appliquée ?).');
  }

  if (manualData && manualData.tva_deductible != null) {
    tvaDeductible = Number(manualData.tva_deductible);
    warnings.push('TVA déductible saisie manuellement (prioritaire sur le calcul lignes).');
  } else if (tvaFromLines > 0) {
    // ok — depuis lignes
  } else if (manualData && manualData.purchases_with_vat != null && defaultRate) {
    const withVat = Number(manualData.purchases_with_vat);
    tvaDeductible = withVat * (defaultRate / (100 + defaultRate));
    warnings.push('TVA déductible estimée par approximation « achats TTC ». Vérifier l’admissibilité réelle.');
  } else if (purchasesTotal > 0 && P.purchase_rate_fallback != null && Number(P.purchase_rate_fallback) > 0) {
    const fr = Number(P.purchase_rate_fallback);
    tvaDeductible = purchasesTotal * (fr / (100 + fr));
    deductibleCalculable = true;
    warnings.push(`TVA déductible estimée avec le taux de repli de ${fr} % sur les achats facturés (${Math.round(purchasesTotal)} TTC) : aucun taux n'est saisi sur les lignes d'achat.`);
  } else if (purchasesTotal > 0) {
    deductibleCalculable = false;
    warnings.push(`ALERTE : TVA déductible NON calculable — ${Math.round(purchasesTotal)} d'achats facturés sans taux de TVA sur les lignes, et aucun taux de repli paramétré. La TVA nette est probablement SURESTIMÉE. Renseignez le taux sur les lignes d'achat, saisissez la TVA déductible ou paramétrez un taux de repli.`);
  } else {
    warnings.push('Aucun achat facturé sur la période : TVA déductible à 0.');
  }

  const manualCredit = manualData && manualData.credit_anterieur != null ? Number(manualData.credit_anterieur) : null;
  const regularisations = Number(manualData?.regularisations || 0);
  const net = calc.computeTvaNet({ collected: tvaCollected, deductible: tvaDeductible }, { ...P, credit_anterieur: manualCredit != null ? manualCredit : P.credit_anterieur });
  const creditAnterieur = net.credit_anterieur;
  tvaDeductible = net.deductible_retenue;
  const tvaNette = net.net + regularisations;

  return {
    module: 'tva',
    period: { start: periodStart, end: periodEnd },
    taux_normal: defaultRate,
    sales: {
      line_count: sales.line_count || 0,
      base_ht: Math.round(baseHt * 100) / 100,
      tva_collected: Math.round(tvaCollected * 100) / 100,
      exempt_or_zero_rate: Math.round(exempt * 100) / 100
    },
    purchases: {
      total_invoiced: Math.round(purchasesTotal * 100) / 100,
      tva_from_lines: Math.round(tvaFromLines * 100) / 100,
      tva_deductible_estimated: Math.round(tvaDeductible * 100) / 100,
      tva_deductible_brute: net.deductible_brute,
      part_non_deductible_pct: net.non_deductible_pct,
      deductible_calculable: deductibleCalculable
    },
    ecart_base: ecartBase,
    credit_anterieur: creditAnterieur,
    regularisations,
    tva_nette_estimee: Math.round(tvaNette * 100) / 100,
    interpretation: tvaNette >= 0
      ? 'Estimation positive : possible TVA à reverser (sous réserve des règles légales et de la situation réelle).'
      : 'Estimation négative : possible crédit de TVA (sous réserve des conditions de report ou de remboursement).',
    warnings,
    disclaimer: DISCLAIMER
  };
}

/**
 * Estimation IBIC / IS — résultat simplifié à partir du CA ventes et des charges saisies.
 * Ne confond pas IBIC et IS. Méthode déclarative + données ventes.
 */
async function estimateProfitTax(clientId, stationId, periodStart, periodEnd, moduleCode, manualData, cfg) {
  const warnings = [];
  const P = cfg.params;
  if (moduleCode !== 'ibic' && moduleCode !== 'is') {
    throw new HttpError(400, 'Module doit être ibic ou is');
  }
  const rate = Number(P.rate);

  // Chiffre d'affaires et charges : définition commune du système (ventes produits + compteurs carburant clôturés ;
  // coût d'achat des ventes + dépenses + charges patronales de la paie). La saisie manuelle reste prioritaire.
  const totals = await profitability.clientTotals(clientId, stationId || null, periodStart, periodEnd);
  const ca = Number(manualData?.chiffre_affaires != null ? manualData.chiffre_affaires : totals.revenue || 0);

  let charges;
  if (manualData && manualData.charges_deductibles != null) {
    charges = Number(manualData.charges_deductibles || 0);
  } else {
    charges = totals.deductible;
    warnings.push(`Charges déductibles reprises automatiquement du système : coût d'achat des ventes ${Math.round(totals.cogs)} + dépenses hors « Impôts et taxes » ${Math.round(totals.expenses_excl_taxes)} + charges patronales ${Math.round(totals.employer_charges)}.`);
    if (totals.taxes_in_expenses > 0) warnings.push(`La catégorie de dépenses « Impôts et taxes » (${Math.round(totals.taxes_in_expenses)}) n'est pas reprise automatiquement (elle peut contenir l'impôt lui-même).`);
    if (!totals.reliable) warnings.push("Coût d'achat manquant sur certaines ventes : charges sous-estimées, résultat fiscal surestimé.");
  }
  const nonDeductible = Number(manualData?.charges_non_deductibles || 0);
  const amortissements = Number(manualData?.amortissements || 0);
  const acomptes = Number(manualData?.acomptes || 0);

  // Déficits antérieurs : montant global ou liste [{year, amount}] ; durée de report appliquée si paramétrée
  const endYear = Number(String(periodEnd).slice(0, 4));
  const carry = P.deficit_carry_years != null ? Number(P.deficit_carry_years) : null;
  let deficits;
  if (Array.isArray(manualData?.deficits_detail)) {
    const u = calc.usableDeficits(manualData.deficits_detail, endYear, carry);
    deficits = u.total;
    if (u.excluded > 0) warnings.push(`Déficits antérieurs de ${u.excluded} exclus : au-delà de la durée de report paramétrée (${carry} an(s)).`);
  } else {
    deficits = Number(manualData?.deficits_anterieurs || 0);
    if (deficits > 0 && carry == null) warnings.push('Déficits antérieurs déduits sans limite de durée : aucune durée de report n\'est paramétrée.');
    if (deficits > 0 && carry != null) warnings.push(`Déficits antérieurs saisis en bloc : vérifier qu'ils respectent la durée de report de ${carry} an(s) (ou détaillez-les par année).`);
  }

  const t = calc.computeProfitTax({ ca, charges, nonDeductible, amortissements, deficits, acomptes }, P);
  if (t.minimum_applique) warnings.push(`Impôt minimum forfaitaire appliqué (${P.imf_rate} % du chiffre d'affaires HT) : il dépasse l'impôt calculé au taux de ${rate} % sur le bénéfice.`);
  if (P.regime_ca_threshold != null && ca > Number(P.regime_ca_threshold)) warnings.push(`Le chiffre d'affaires dépasse le seuil de régime paramétré (${P.regime_ca_threshold}) : vérifier le régime applicable.`);

  return {
    module: moduleCode,
    period: { start: periodStart, end: periodEnd },
    chiffre_affaires: Math.round(ca * 100) / 100,
    charges_deductibles: charges,
    charges_non_deductibles: nonDeductible,
    amortissements,
    deficits_imputes: deficits,
    resultat_comptable: t.resultat_comptable,
    resultat_fiscal: t.resultat_fiscal,
    taux_applique: rate,
    impot_brut_estime: t.impot_du_estime,
    impot_au_taux_normal: t.impot_brut_taux_normal,
    impot_minimum_forfaitaire: t.impot_minimum_forfaitaire,
    minimum_applique: t.minimum_applique,
    acomptes,
    solde_estime: t.solde_estime,
    warnings,
    disclaimer: DISCLAIMER
  };
}

/** Impôt synthétique — estimation déclarative selon CA de référence */
async function estimateSynthetique(clientId, stationId, periodStart, periodEnd, manualData, cfg) {
  const warnings = [];
  const P = cfg.params;
  const totals = await profitability.clientTotals(clientId, stationId || null, periodStart, periodEnd);
  const ca = Number(manualData?.chiffre_affaires != null ? manualData.chiffre_affaires : totals.revenue || 0);
  // CA annuel de comparaison au seuil : saisi, sinon CA estimé du profil fiscal, sinon CA de la période
  let annualCa = manualData?.chiffre_affaires_annuel != null ? Number(manualData.chiffre_affaires_annuel) : null;
  if (annualCa == null) {
    const { rows: [pf] } = await pool.query('SELECT estimated_annual_ca FROM fiscal_profiles WHERE client_id = $1', [clientId]);
    if (pf && pf.estimated_annual_ca != null) annualCa = Number(pf.estimated_annual_ca);
  }
  const t = calc.computeSynthetic({ ca, annualCa }, P);
  if (t.seuil_depasse) warnings.push(`Le chiffre d'affaires annuel (${Math.round(t.ca_annuel_compare)}) dépasse le seuil du régime (${t.seuil}) : examiner le basculement vers le régime réel.`);
  const dejaPaye = Number(manualData?.montants_payes || 0);
  return {
    module: 'synthetique',
    period: { start: periodStart, end: periodEnd },
    chiffre_affaires_reference: t.ca_reference,
    seuil_regime: t.seuil,
    seuil_depasse: t.seuil_depasse,
    estimation: t.estimation,
    montants_payes: dejaPaye,
    reste_estime: Math.round(Math.max(0, t.estimation - dejaPaye) * 100) / 100,
    warnings,
    disclaimer: DISCLAIMER
  };
}

/** ITS — agrège les bulletins RH existants pour la période */
async function estimateITSFromHR(clientId, stationId, periodStart, periodEnd, cfg) {
  const warnings = [];
  // stations du client
  const stQ = stationId
    ? await pool.query('SELECT id FROM stations WHERE id = $1 AND client_id = $2', [stationId, clientId])
    : await pool.query('SELECT id FROM stations WHERE client_id = $1', [clientId]);
  const stationIds = stQ.rows.map(r => r.id);
  if (!stationIds.length) {
    return { module: 'its', total_its: 0, bulletin_count: 0, warnings: ['Aucune station pour ce client'], disclaimer: DISCLAIMER };
  }
  // Bulletins : table réelle « payslips » (bulletins validés ou payés dont le mois est dans la période).
  const pay = await profitability.payrollTotals(stationIds, periodStart, periodEnd);
  if (!pay) {
    warnings.push('Impossible de lire les bulletins RH (schéma de paie indisponible). Vérifier le module Paie / ITS.');
    return { module: 'its', total_its: 0, bulletin_count: 0, warnings, disclaimer: DISCLAIMER };
  }
  const itsTotal = pay.its;
  const count = pay.n;
  if (count === 0) warnings.push('Aucun bulletin de paie trouvé pour la période. Activez et calculez l’ITS dans le module RH.');
  return {
    module: 'its',
    period: { start: periodStart, end: periodEnd },
    total_its: Math.round(itsTotal * 100) / 100,
    bulletin_count: count,
    source: 'bulletins_rh',
    warnings,
    disclaimer: DISCLAIMER
  };
}

/** Cotisations sociales (INPS, AMO) : agrégat des bulletins de paie validés ou payés de la période. */
async function estimateSocial(clientId, stationId, periodStart, periodEnd, moduleCode, cfg) {
  const warnings = [];
  const stQ = stationId
    ? await pool.query('SELECT id FROM stations WHERE id = $1 AND client_id = $2', [stationId, clientId])
    : await pool.query('SELECT id FROM stations WHERE client_id = $1', [clientId]);
  const ids = stQ.rows.map(r => r.id);
  const pay = ids.length ? await profitability.payrollTotals(ids, periodStart, periodEnd) : null;
  if (!pay) { warnings.push('Bulletins de paie illisibles ou absents : estimation impossible.'); return { module: moduleCode, estimation: 0, bulletin_count: 0, warnings, disclaimer: DISCLAIMER }; }
  if (!pay.n) warnings.push('Aucun bulletin validé ou payé sur la période : calculez et validez la paie.');
  const emp = moduleCode === 'inps' ? pay.inps_employee : pay.amo_employee;
  const er = moduleCode === 'inps' ? pay.inps_employer : pay.amo_employer;
  return {
    module: moduleCode, period: { start: periodStart, end: periodEnd }, source: 'bulletins_rh', bulletin_count: pay.n,
    part_salariale: Math.round(emp * 100) / 100, part_employeur: Math.round(er * 100) / 100,
    estimation: Math.round((emp + er) * 100) / 100, reste_estime: Math.round((emp + er) * 100) / 100, warnings, disclaimer: DISCLAIMER
  };
}

/** Aiguillage commun des estimations (estimation, mise à jour de période, recalcul, simulation de l'assistant). */
async function dispatchEstimate(cid, stationId, code, start, end, data, cfg) {
  let result;
  switch (code) {
    case 'tva': result = await estimateTVA(cid, stationId, start, end, data, cfg); break;
    case 'ibic': case 'is': result = await estimateProfitTax(cid, stationId, start, end, code, data, cfg); break;
    case 'synthetique': result = await estimateSynthetique(cid, stationId, start, end, data, cfg); break;
    case 'its': result = await estimateITSFromHR(cid, stationId, start, end, cfg); break;
    case 'inps': case 'amo': result = await estimateSocial(cid, stationId, start, end, code, cfg); break;
    case 'cfe': case 'tfp': result = await estimateEmployerTax(cid, stationId, start, end, code, data, cfg); break;
    default:
      if (!REF.has(code)) throw new HttpError(400, 'Module fiscal inconnu');
      result = await estimateManual(cid, code, start, end, data, cfg);
  }
  // Version des paramètres utilisée + indication des valeurs personnalisées (affichées avec chaque estimation)
  result.rule_used = { kind: 'parametres', version: cfg.version, dataset_version: cfg.dataset_version, effective_from: cfg.effective_from || null, customized: cfg.customized || [], source: cfg.simulation ? 'simulation (non enregistrée)' : 'assistant d\'activation' };
  result.warnings = [...(cfg.warnings || []), ...(result.warnings || [])];
  return result;
}

/** Estimation d'un module : refusée tant que le module n'est pas activé ET paramétré (aucun « 0 » trompeur). */
async function estimateFor(cid, stationId, code, start, end, data) {
  if (!REF.has(code)) throw new HttpError(400, 'Module fiscal inconnu');
  const a = await FS.requireActive(cid, code, end);
  const cfg = { params: a.params, version: a.settings.version, dataset_version: a.settings.dataset_version, effective_from: String(a.settings.effective_from).slice(0, 10), customized: a.settings.customized || [], warnings: a.warnings };
  return dispatchEstimate(cid, stationId, code, start, end, data || {}, cfg);
}

// ---------- API estimation ----------
r.post('/fiscal/estimate', need('settings.edit'), body(z.object({
  module_code: z.string().min(1),
  period_start: z.string(),
  period_end: z.string(),
  station_id: z.number().optional().nullable(),
  data: z.record(z.any()).optional()
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_estimates') && !contract.unrestricted) {
    throw new HttpError(403, 'Estimations fiscales non autorisées sur votre contrat.');
  }
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const { module_code, period_start, period_end, station_id, data } = req.body;

  const result = await estimateFor(cid, station_id || req.sid, module_code, period_start, period_end, data || {});
  res.json(result);
}));

// ---------- Mise à jour période + calcul ----------
r.patch('/fiscal/periods/:id', need('settings.edit'), body(z.object({
  data: z.record(z.any()).optional(),
  status: z.enum(['brouillon', 'a_completer', 'pret', 'valide_interne', 'archive']).optional(),
  notes: z.string().max(2000).optional(),
  run_estimate: z.boolean().optional()
}).partial()), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(
      'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2 FOR UPDATE',
      [req.params.id, cid]
    );
    if (!old) throw new HttpError(404, 'Période introuvable');
    // Lot 13 — verrouillage : période validée / archivée non modifiable (sauf via réouverture)
    if (['valide_interne', 'archive'].includes(old.status)) {
      if (b.status && b.status !== old.status) {
        throw new HttpError(400,
          'Période verrouillée (« ' + old.status + ' »). Utilisez « Rouvrir » avant toute modification.');
      }
      if (b.data || b.run_estimate || (b.notes !== undefined && b.notes !== old.notes)) {
        throw new HttpError(400,
          'Période verrouillée (« ' + old.status + ' »). Utilisez « Rouvrir » avant toute modification.');
      }
    }
    let estimates = old.estimates || {};
    let ruleVersions = old.rule_versions || {};
    if (b.run_estimate) {
      if (!featureOn(contract, 'can_fiscal_estimates') && !contract.unrestricted) {
        throw new HttpError(403, 'Estimations non autorisées');
      }
      const data = { ...(old.data || {}), ...(b.data || {}) };
      const result = await estimateFor(cid, old.station_id, old.module_code, old.period_start, old.period_end, data);
      estimates = result;
      if (result.rule_used) ruleVersions = { [old.module_code]: result.rule_used };
    }
    const dataMerge = b.data ? { ...(old.data || {}), ...b.data } : old.data;
    const { rows: [n] } = await c.query(
      `UPDATE fiscal_periods SET
         data = COALESCE($3, data),
         estimates = $4,
         rule_versions = $5,
         status = COALESCE($6, status),
         notes = COALESCE($7, notes),
         updated_at = now()
       WHERE id = $1 AND client_id = $2 RETURNING *`,
      [old.id, cid,
        dataMerge ? JSON.stringify(dataMerge) : null,
        JSON.stringify(estimates),
        JSON.stringify(ruleVersions),
        b.status || null,
        b.notes != null ? b.notes : null]
    );
    await logFiscal(cid, req.user.id, 'update_period', 'fiscal_periods', n.id, old, n, req.ip);
    return n;
  });
  res.json({ period: out, disclaimer: DISCLAIMER });
}));

// ---------- Échéances ----------
r.get('/fiscal/deadlines', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows } = await pool.query(
    `SELECT * FROM fiscal_deadlines
     WHERE client_id = $1 OR client_id IS NULL
     ORDER BY due_date ASC LIMIT 100`,
    [cid]
  );
  res.json({ deadlines: rows, disclaimer: DISCLAIMER });
}));

r.post('/fiscal/deadlines', need('settings.edit'), body(z.object({
  module_code: z.string().min(1),
  title: z.string().min(1).max(200),
  due_date: z.string(),
  period_label: z.string().optional().nullable(),
  source: z.enum(['reglementaire', 'interne', 'parametre']).default('interne'),
  legal_reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_deadlines') && !contract.unrestricted) {
    throw new HttpError(403, 'Suivi des échéances non autorisé sur votre contrat.');
  }
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun client lié');
  const b = req.body;
  const { rows: [row] } = await pool.query(
    `INSERT INTO fiscal_deadlines (client_id, module_code, title, due_date, period_label, source, legal_reference, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [cid, b.module_code, b.title, b.due_date, b.period_label || null, b.source || 'interne',
      b.legal_reference || null, b.notes || null]
  );
  await logFiscal(cid, req.user.id, 'create_deadline', 'fiscal_deadlines', row.id, null, row, req.ip);
  res.status(201).json({ deadline: row, disclaimer: DISCLAIMER });
}));

r.patch('/fiscal/deadlines/:id', need('settings.edit'), body(z.object({
  status: z.enum(['a_venir', 'en_cours', 'depasse', 'termine', 'annule']).optional(),
  notes: z.string().optional().nullable()
}).partial()), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const b = req.body;
  const { rows: [row] } = await pool.query(
    `UPDATE fiscal_deadlines SET
       status = COALESCE($3, status),
       notes = COALESCE($4, notes)
     WHERE id = $1 AND (client_id = $2 OR client_id IS NULL) RETURNING *`,
    [req.params.id, cid, b.status || null, b.notes != null ? b.notes : null]
  );
  if (!row) throw new HttpError(404, 'Échéance introuvable');
  res.json({ deadline: row, disclaimer: DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// LOT 3 — CFE / TFP, confirmation règles, PDF, alertes échéances
// ---------------------------------------------------------------------------

/** CFE / TFP : estimation à partir de la masse salariale (bulletins RH) + taux règle */
async function estimateEmployerTax(clientId, stationId, periodStart, periodEnd, moduleCode, manualData, cfg) {
  const warnings = [];
  const P = cfg.params;
  const rate = Number(P.rate);
  const stQ = stationId
    ? await pool.query('SELECT id FROM stations WHERE id = $1 AND client_id = $2', [stationId, clientId])
    : await pool.query('SELECT id FROM stations WHERE client_id = $1', [clientId]);
  const stationIds = stQ.rows.map(r => r.id);
  let masse = Number(manualData?.masse_salariale || 0);
  let bulletinCount = 0;
  if (!masse && stationIds.length) {
    const pay = await profitability.payrollTotals(stationIds, periodStart, periodEnd);
    if (pay) { masse = pay.gross; bulletinCount = pay.n; }
    else warnings.push('Masse salariale non lue depuis RH (schéma de paie indisponible). Saisir manuellement.');
  }
  if (!masse) warnings.push('Masse salariale à 0 — vérifier la paie ou saisir manuellement.');
  const estimation = calc.computeSimpleTax(masse, { rate });
  const dejaPaye = Number(manualData?.montants_payes || 0);
  return {
    module: moduleCode,
    period: { start: periodStart, end: periodEnd },
    masse_salariale: Math.round(masse * 100) / 100,
    bulletin_count: bulletinCount,
    taux_applique: rate,
    estimation,
    montants_payes: dejaPaye,
    reste_estime: Math.round(Math.max(0, estimation - dejaPaye) * 100) / 100,
    warnings,
    disclaimer: DISCLAIMER
  };
}

// Confirmation juridique d'une règle (Superadmin uniquement)
r.post('/fiscal/rules/:id/confirm', need('user.manage'), body(z.object({
  reason: z.string().min(5).max(500)
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal');
  const { rows: [rule] } = await pool.query(
    'SELECT * FROM fiscal_rules WHERE id = $1 FOR UPDATE', [req.params.id]
  ).catch(async () => {
    const r2 = await pool.query('SELECT * FROM fiscal_rules WHERE id = $1', [req.params.id]);
    return r2;
  });
  if (!rule) throw new HttpError(404, 'Règle introuvable');
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_rules SET verification_status = 'verifiee', verified_at = now(), verified_by = $2
     WHERE id = $1 RETURNING *`,
    [rule.id, req.user.id]
  );
  await pool.query(
    `INSERT INTO fiscal_audit_log (client_id, user_id, action, entity_type, entity_id, old_data, new_data)
     VALUES (0, $1, 'confirm_rule', 'fiscal_rules', $2, $3, $4)`,
    [req.user.id, rule.id, JSON.stringify({ status: rule.verification_status }),
      JSON.stringify({ status: 'verifiee', reason: req.body.reason })]
  ).catch(swallow('fiscal:fiscal_audit_log', undefined));
  res.json({
    rule: n,
    message: 'Règle marquée vérifiée. Les estimations utilisant cette version pourront être considérées plus fiables.',
    disclaimer: DISCLAIMER
  });
}));

r.post('/fiscal/rules/:id/unconfirm', need('user.manage'), body(z.object({
  reason: z.string().min(5).max(500)
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l’Administrateur Principal');
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_rules SET verification_status = 'a_verifier', verified_at = NULL, verified_by = NULL
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!n) throw new HttpError(404, 'Règle introuvable');
  res.json({ rule: n, disclaimer: DISCLAIMER });
}));

// Export PDF préparation déclaration (période)
r.get('/fiscal/periods/:id/pdf', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés sur votre contrat.');
  }
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun compte client lié');
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const { rows: [profile] } = await pool.query(
    'SELECT * FROM fiscal_profiles WHERE client_id = $1', [period.client_id]
  );
  const docs = require('./docs');
  const stationId = period.station_id || req.sid;
  const b = stationId ? await docs.branding(stationId) : {
    name: profile?.legal_name || 'Client',
    address: profile?.address || '',
    phone: '', email: '', currency: 'FCFA', tax_id: profile?.nif || ''
  };
  await maskEstimates(period.client_id, [period]);
  const est = period.estimates || {};
  const data = period.data || {};
  const kv = [
    ['Module', (period.module_code || '').toUpperCase()],
    ['Période', `${period.period_start} → ${period.period_end}`],
    ['Statut interne', period.status],
    ['NIF', profile?.nif || '—'],
    ['Raison sociale', profile?.legal_name || '—'],
    ['Régime déclaré', profile?.declared_regime || '—']
  ];
  if (est.tva_nette_estimee != null) {
    kv.push(
      ['Base HT ventes (est.)', est.sales?.base_ht],
      ['TVA collectée', est.sales?.tva_collected],
      ['TVA déductible (est.)', est.purchases?.tva_deductible_estimated],
      ['Crédit antérieur', est.credit_anterieur],
      ['TVA nette estimée', est.tva_nette_estimee]
    );
  } else if (est.solde_estime != null) {
    kv.push(
      ['Chiffre d’affaires', est.chiffre_affaires],
      ['Résultat fiscal', est.resultat_fiscal],
      ['Impôt brut estimé', est.impot_brut_estime],
      ['Acomptes', est.acomptes],
      ['Solde estimé', est.solde_estime]
    );
  } else if (est.estimation != null) {
    kv.push(['Estimation', est.estimation], ['Reste estimé', est.reste_estime]);
  } else if (est.total_its != null) {
    kv.push(['ITS (bulletins RH)', est.total_its], ['Bulletins', est.bulletin_count]);
  } else if (est.masse_salariale != null) {
    kv.push(
      ['Masse salariale', est.masse_salariale],
      ['Taux', est.taux_applique != null ? est.taux_applique + ' %' : '—'],
      ['Estimation', est.estimation],
      ['Reste estimé', est.reste_estime]
    );
  }
  const warnings = (est.warnings || []).join('\n') || 'Aucun avertissement enregistré.';

  // Checklist + documents pour le PDF (Lot 5)
  await ensureChecklist(period.client_id, period.id, period.module_code).catch(swallow('fiscal:ensureChecklist', undefined));
  const { rows: checkItems } = await pool.query(
    'SELECT label, required, status, notes FROM fiscal_checklist_items WHERE period_id = $1 ORDER BY required DESC, id',
    [period.id]
  ).catch(swallow('fiscal:1135', { rows: [] }));
  const { rows: docsList } = await pool.query(
    'SELECT doc_type, title, uploaded_at FROM fiscal_documents WHERE period_id = $1 ORDER BY uploaded_at DESC LIMIT 30',
    [period.id]
  ).catch(swallow('fiscal:1139', { rows: [] }));
  const checkDone = checkItems.filter(x => x.status === 'fourni' || x.status === 'non_applicable').length;
  const checkTable = {
    type: 'table',
    title: `Pièces justificatives (${checkDone}/${checkItems.length})`,
    head: ['Pièce', 'Requis', 'Statut', 'Notes'],
    rows: checkItems.map(it => [
      it.label,
      it.required ? 'Oui' : 'Non',
      it.status,
      it.notes || ''
    ])
  };
  const docsTable = docsList.length ? {
    type: 'table',
    title: 'Documents joints (métadonnées)',
    head: ['Type', 'Titre', 'Déposé le'],
    rows: docsList.map(d => [d.doc_type, d.title, d.uploaded_at])
  } : { type: 'text', title: 'Documents joints', text: 'Aucun fichier déposé pour cette période.' };

  const buf = await docs.buildPdf({
    b,
    title: 'PRÉPARATION FISCALE',
    subtitle: `Module ${period.module_code} — document interne de préparation`,
    ref: `FISCAL-${period.id}`,
    landscape: false,
    sections: [
      { type: 'text', title: 'Avertissement', text: DISCLAIMER },
      { type: 'kv', title: 'Synthèse', rows: kv },
      { type: 'text', title: 'Avertissements du calcul', text: warnings },
      checkTable,
      docsTable,
      { type: 'text', title: 'Notes', text: period.notes || data.notes || '—' },
      {
        type: 'text',
        title: 'Statut',
        text: 'Ce document est une aide à la préparation. Il ne constitue pas une déclaration déposée ni un avis de la DGI.'
      }
    ],
    signatures: [{ label: 'Préparé par' }, { label: 'Revu par (comptable / conseil)' }]
  });
  docs.send(res, 'pdf', buf, `fiscal-${period.module_code}-${period.period_start}`);
}));

// Scanner échéances fiscales (appelable par le scheduler ou manuellement)
async function scanFiscalDeadlines() {
  const { rows } = await pool.query(
    `SELECT d.*, c.name AS client_name
     FROM fiscal_deadlines d
     LEFT JOIN clients c ON c.id = d.client_id
     WHERE d.status IN ('a_venir','en_cours')
       AND d.due_date <= CURRENT_DATE + 7
       AND d.due_date >= CURRENT_DATE - 1`
  );
  let sent = 0;
  for (const d of rows) {
    if (!d.client_id) continue;
    const days = Math.ceil((new Date(d.due_date) - new Date()) / 86400000);
    const label = days < 0 ? 'ÉCHÉANCE DÉPASSÉE' : days === 0 ? 'ÉCHÉANCE AUJOURD’HUI' : `Échéance dans ${days} j`;
    try {
      const { sendSystemAlert } = require('./messaging');
      // Une station du client pour le contexte
      const { rows: [st] } = await pool.query(
        'SELECT id FROM stations WHERE client_id = $1 ORDER BY id LIMIT 1', [d.client_id]
      );
      if (!st) continue;
      await sendSystemAlert({
        clientId: d.client_id,
        stationId: st.id,
        kind: 'fiscal_deadline',
        title: `${label} — ${d.title}`,
        body: `Échéance fiscale « ${d.title} » (${d.module_code}) le ${d.due_date}. Source: ${d.source || 'interne'}.`,
        refTable: 'fiscal_deadlines',
        refId: d.id
      });
      if (days < 0 && d.status !== 'depasse') {
        await pool.query(`UPDATE fiscal_deadlines SET status = 'depasse' WHERE id = $1`, [d.id]);
      } else if (days >= 0 && days <= 7 && d.status === 'a_venir') {
        await pool.query(`UPDATE fiscal_deadlines SET status = 'en_cours' WHERE id = $1`, [d.id]);
      }
      sent++;
    } catch (e) {
      console.warn('[fiscal-deadlines]', e.message);
    }
  }
  return { scanned: rows.length, alerts_sent: sent };
}

r.post('/fiscal/deadlines/scan', need('user.manage'), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé Superadmin');
  const result = await scanFiscalDeadlines();
  res.json({ ...result, disclaimer: DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// LOT 4 — Checklist, Excel multi-périodes, métadonnées documents
// ---------------------------------------------------------------------------

const CHECKLIST_TEMPLATES = {
  tva: [
    { code: 'factures_ventes', label: 'Factures de ventes de la période', required: true },
    { code: 'factures_achats', label: 'Factures d’achats / notes de débit fournisseurs', required: true },
    { code: 'releve_tva', label: 'Relevé / brouillon de calcul TVA', required: false },
    { code: 'credit_anterieur', label: 'Justificatif crédit de TVA reporté', required: false },
    { code: 'nif', label: 'Attestation NIF / situation fiscale', required: true }
  ],
  synthetique: [
    { code: 'ca_reference', label: 'Justificatif du chiffre d’affaires de référence', required: true },
    { code: 'quittances', label: 'Quittances de paiements antérieurs', required: false },
    { code: 'nif', label: 'Attestation NIF / situation fiscale', required: true }
  ],
  ibic: [
    { code: 'compte_resultat', label: 'Compte de résultat / extrait comptable', required: true },
    { code: 'charges', label: 'Détail des charges déductibles', required: true },
    { code: 'acomptes', label: 'Quittances d’acomptes', required: false },
    { code: 'nif', label: 'Attestation NIF / situation fiscale', required: true }
  ],
  is: [
    { code: 'etats_financiers', label: 'États financiers de l’exercice', required: true },
    { code: 'liasse', label: 'Éléments de liasse / résultat fiscal', required: true },
    { code: 'acomptes', label: 'Quittances d’acomptes IS', required: false },
    { code: 'nif', label: 'Attestation NIF / situation fiscale', required: true }
  ],
  its: [
    { code: 'bulletins', label: 'Bulletins de paie de la période', required: true },
    { code: 'etat_its', label: 'État récapitulatif ITS', required: true },
    { code: 'quittances', label: 'Quittances de versement ITS', required: false }
  ],
  cfe: [
    { code: 'masse_salariale', label: 'État de masse salariale', required: true },
    { code: 'quittances', label: 'Quittances CFE', required: false }
  ],
  tfp: [
    { code: 'masse_salariale', label: 'État de masse salariale', required: true },
    { code: 'quittances', label: 'Quittances TFP', required: false }
  ],
  default: [
    { code: 'nif', label: 'Attestation NIF / situation fiscale', required: true },
    { code: 'autres', label: 'Autres pièces justificatives', required: false }
  ]
};

function checklistTemplateFor(moduleCode) {
  return CHECKLIST_TEMPLATES[moduleCode] || CHECKLIST_TEMPLATES.default;
}

/** Initialise la checklist d’une période si absente */
async function ensureChecklist(clientId, periodId, moduleCode) {
  const { rows: existing } = await pool.query(
    'SELECT item_code FROM fiscal_checklist_items WHERE period_id = $1', [periodId]
  );
  if (existing.length) return existing;
  const tpl = checklistTemplateFor(moduleCode);
  for (const it of tpl) {
    await pool.query(
      `INSERT INTO fiscal_checklist_items (client_id, period_id, item_code, label, required, status)
       VALUES ($1,$2,$3,$4,$5,'manquant')
       ON CONFLICT (period_id, item_code) DO NOTHING`,
      [clientId, periodId, it.code, it.label, it.required]
    );
  }
  return tpl;
}

r.get('/fiscal/periods/:id/checklist', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  await ensureChecklist(period.client_id, period.id, period.module_code);
  const { rows } = await pool.query(
    'SELECT * FROM fiscal_checklist_items WHERE period_id = $1 ORDER BY required DESC, id',
    [period.id]
  );
  const done = rows.filter(x => x.status === 'fourni' || x.status === 'non_applicable').length;
  res.json({
    period_id: period.id,
    module_code: period.module_code,
    items: rows,
    progress: { done, total: rows.length },
    disclaimer: DISCLAIMER
  });
}));

r.patch('/fiscal/periods/:id/checklist/:itemId', need('settings.edit'), body(z.object({
  status: z.enum(['manquant', 'fourni', 'non_applicable', 'a_verifier']).optional(),
  notes: z.string().max(500).optional().nullable()
}).partial()), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT id, client_id FROM fiscal_periods WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const b = req.body;
  const { rows: [item] } = await pool.query(
    `UPDATE fiscal_checklist_items SET
       status = COALESCE($3, status),
       notes = COALESCE($4, notes),
       updated_by = $5,
       updated_at = now()
     WHERE id = $1 AND period_id = $2 RETURNING *`,
    [req.params.itemId, period.id, b.status || null, b.notes != null ? b.notes : null, req.user.id]
  );
  if (!item) throw new HttpError(404, 'Élément de checklist introuvable');
  res.json({ item, disclaimer: DISCLAIMER });
}));

// Documents métadonnées (lien checklist)
r.get('/fiscal/periods/:id/documents', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT id, client_id FROM fiscal_periods WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const { rows } = await pool.query(
    'SELECT * FROM fiscal_documents WHERE period_id = $1 ORDER BY uploaded_at DESC',
    [period.id]
  );
  res.json({ documents: rows, disclaimer: DISCLAIMER });
}));

r.post('/fiscal/periods/:id/documents', need('settings.edit'), body(z.object({
  doc_type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  file_path: z.string().max(500).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  module_code: z.string().optional().nullable()
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const b = req.body;
  const { rows: [doc] } = await pool.query(
    `INSERT INTO fiscal_documents (client_id, period_id, module_code, doc_type, title, file_path, uploaded_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [period.client_id, period.id, b.module_code || period.module_code, b.doc_type, b.title,
      b.file_path || null, req.user.id, b.notes || null]
  );
  await logFiscal(period.client_id, req.user.id, 'add_document', 'fiscal_documents', doc.id, null, doc, req.ip);
  res.status(201).json({ document: doc, disclaimer: DISCLAIMER });
}));

// Export Excel multi-périodes
r.get('/fiscal/export.xlsx', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  if (!cid) throw new HttpError(400, 'Aucun compte client lié');
  const moduleFilter = req.query.module || null;
  const from = req.query.from || null;
  const to = req.query.to || null;
  const params = [cid];
  let where = 'WHERE client_id = $1';
  if (moduleFilter) { params.push(moduleFilter); where += ` AND module_code = $${params.length}`; }
  if (from) { params.push(from); where += ` AND period_start >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` AND period_end <= $${params.length}::date`; }

  const { rows: periods } = await pool.query(
    `SELECT id, module_code, period_type, period_start, period_end, status, estimates, data, notes, created_at
     FROM fiscal_periods ${where} ORDER BY period_start DESC LIMIT 500`,
    params
  );
  await maskEstimates(clientIdOf(req), periods);
  const { rows: [profile] } = await pool.query(
    'SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]
  );

  const docs = require('./docs');
  const stationId = req.sid;
  const b = stationId ? await docs.branding(stationId) : {
    name: profile?.legal_name || 'Client',
    currency: 'FCFA',
    address: profile?.address || '',
    tax_id: profile?.nif || ''
  };

  const head = ['ID', 'Module', 'Début', 'Fin', 'Statut', 'Estimation clé', 'Warnings', 'Notes'];
  const rows = periods.map(p => {
    const est = p.estimates || {};
    let key = '';
    if (est.tva_nette_estimee != null) key = est.tva_nette_estimee;
    else if (est.solde_estime != null) key = est.solde_estime;
    else if (est.estimation != null) key = est.estimation;
    else if (est.total_its != null) key = est.total_its;
    else if (est.reste_estime != null) key = est.reste_estime;
    const warns = Array.isArray(est.warnings) ? est.warnings.join(' | ') : '';
    return [p.id, p.module_code, p.period_start, p.period_end, p.status, key, warns, p.notes || ''];
  });

  const buf = await docs.buildXlsx({
    b,
    title: 'Export fiscal multi-périodes',
    subtitle: 'Préparation interne — non officiel',
    ref: `FISCAL-XLSX-${new Date().toISOString().slice(0, 10)}`,
    sheets: [{
      name: 'Périodes',
      head,
      rows,
      notes: [DISCLAIMER, 'Les montants sont indicatifs. Valider avec un professionnel habilité.']
    }]
  });
  docs.send(res, 'xlsx', buf, `fiscal-periodes-${new Date().toISOString().slice(0, 10)}`);
}));

// Liste complète des règles pour Superadmin (toutes versions)
r.get('/admin/fiscal/rules', need('user.manage'), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé Superadmin');
  const tax = req.query.tax || null;
  const q = tax
    ? await pool.query('SELECT * FROM fiscal_rules WHERE tax_code = $1 ORDER BY tax_code, rule_key, version DESC', [tax])
    : await pool.query('SELECT * FROM fiscal_rules ORDER BY tax_code, rule_key, version DESC');
  res.json({ rules: q.rows, disclaimer: DISCLAIMER });
}));

// Mise à jour du taux d’une règle (crée une NOUVELLE version — jamais d’écrasement rétroactif)
r.post('/admin/fiscal/rules/new-version', need('user.manage'), body(z.object({
  tax_code: z.string().min(1),
  rule_key: z.string().min(1),
  rate: z.number().min(0).max(100).optional(),
  fixed_amount: z.number().min(0).optional(),
  label: z.string().optional(),
  effective_from: z.string(),
  effective_to: z.string().optional().nullable(),
  legal_source: z.string().optional().nullable(),
  legal_reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé Superadmin');
  const b = req.body;
  const ruleValue = {};
  if (b.rate != null) ruleValue.rate = b.rate;
  if (b.fixed_amount != null) ruleValue.fixed_amount = b.fixed_amount;
  if (b.label) ruleValue.label = b.label;
  const { rows: [last] } = await pool.query(
    'SELECT COALESCE(MAX(version),0) AS v FROM fiscal_rules WHERE tax_code = $1 AND rule_key = $2',
    [b.tax_code, b.rule_key]
  );
  const version = (last?.v || 0) + 1;
  // Clôturer l’ancienne version active si besoin
  await pool.query(
    `UPDATE fiscal_rules SET effective_to = $3::date - 1
     WHERE tax_code = $1 AND rule_key = $2 AND effective_to IS NULL AND effective_from < $3::date`,
    [b.tax_code, b.rule_key, b.effective_from]
  ).catch(swallow('fiscal:fiscal_rules', undefined));
  const { rows: [row] } = await pool.query(
    `INSERT INTO fiscal_rules (
      tax_code, rule_key, rule_value, effective_from, effective_to,
      legal_source, legal_reference, version, verification_status, notes, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'a_verifier',$9,$10) RETURNING *`,
    [b.tax_code, b.rule_key, JSON.stringify(ruleValue), b.effective_from, b.effective_to || null,
      b.legal_source || null, b.legal_reference || null, version, b.notes || null, req.user.id]
  );
  res.status(201).json({
    rule: row,
    message: 'Nouvelle version créée (a_verifier). Confirmez-la après validation juridique.',
    disclaimer: DISCLAIMER
  });
}));

// ---------------------------------------------------------------------------
// LOT 5 — Upload justificatifs, téléchargement, dashboard Superadmin
// ---------------------------------------------------------------------------

/** Calcule l’usage stockage fiscal d’un client (octets) */
async function fiscalStorageBytes(clientId) {
  const filesMod = require('./files');
  const { rows: docs } = await pool.query(
    'SELECT file_path FROM fiscal_documents WHERE client_id = $1 AND file_path IS NOT NULL',
    [clientId]
  );
  let bytes = 0;
  for (const d of docs) {
    try {
      const buf = await filesMod.read(d.file_path);
      if (buf) bytes += buf.length;
    } catch (e) { ignored('fiscal:taille-fichier-quota', e); }
  }
  return bytes;
}

r.post('/fiscal/periods/:id/documents/upload', need('settings.edit'), body(z.object({
  data_url: z.string().min(30),
  doc_type: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  notes: z.string().max(500).optional().nullable(),
  checklist_item_id: z.number().int().optional().nullable()
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');

  // Lot 17 — quota stockage contrat
  const quotaMb = Number(contract.features?.fiscal_storage_mb);
  const limitMb = Number.isFinite(quotaMb) ? quotaMb : 100;
  if (limitMb > 0) {
    const used = await fiscalStorageBytes(period.client_id);
    // estimation taille data_url base64
    const approx = Math.floor((req.body.data_url.length * 3) / 4);
    if (used + approx > limitMb * 1024 * 1024) {
      throw new HttpError(413,
        `Quota stockage fiscal atteint (${limitMb} Mo). Supprimez des pièces ou demandez une augmentation sur le contrat.`,
        { code: 'FISCAL_STORAGE_QUOTA', used_mb: Math.round(used / 1024 / 1024 * 100) / 100, limit_mb: limitMb }
      );
    }
  }

  const files = require('./files');
  const rel = await files.save(`fiscal/${period.client_id}/${period.id}`, req.body.data_url, true); // PNG/JPEG/PDF
  const b = req.body;
  const { rows: [doc] } = await pool.query(
    `INSERT INTO fiscal_documents (client_id, period_id, module_code, doc_type, title, file_path, uploaded_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [period.client_id, period.id, period.module_code, b.doc_type, b.title, rel, req.user.id, b.notes || null]
  );
  if (b.checklist_item_id) {
    await pool.query(
      `UPDATE fiscal_checklist_items SET status = 'fourni', document_id = $3, updated_by = $4, updated_at = now()
       WHERE id = $1 AND period_id = $2`,
      [b.checklist_item_id, period.id, doc.id, req.user.id]
    ).catch(swallow('fiscal:fiscal_checklist_items', undefined));
  }
  await logFiscal(period.client_id, req.user.id, 'upload_document', 'fiscal_documents', doc.id, null, { title: doc.title, path: rel }, req.ip);
  res.status(201).json({ document: doc, disclaimer: DISCLAIMER });
}));

r.get('/fiscal/documents/:id/file', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [doc] } = await pool.query(
    'SELECT * FROM fiscal_documents WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!doc || !doc.file_path) throw new HttpError(404, 'Document introuvable');
  const files = require('./files');
  const buf = await files.read(doc.file_path);
  if (!buf) throw new HttpError(404, 'Fichier absent sur le disque');
  const mime = await files.typeOf(doc.file_path);
  const name = (doc.title || 'justificatif').replace(/[^\w.-]+/g, '_');
  res.set('Content-Type', mime)
    .set('Content-Disposition', `attachment; filename="${name}${require('path').extname(doc.file_path)}"`)
    .send(buf);
}));

/** Lot 16 — prévisualisation inline (PDF / images) */
r.get('/fiscal/documents/:id/preview', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [doc] } = await pool.query(
    'SELECT * FROM fiscal_documents WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!doc || !doc.file_path) throw new HttpError(404, 'Document introuvable');
  const files = require('./files');
  const buf = await files.read(doc.file_path);
  if (!buf) throw new HttpError(404, 'Fichier absent sur le disque');
  const mime = await files.typeOf(doc.file_path) || 'application/octet-stream';
  const ok = /^(image\/(png|jpeg|jpg|gif|webp)|application\/pdf)$/i.test(mime);
  if (!ok) throw new HttpError(415, 'Prévisualisation disponible pour PDF et images uniquement.');
  res.set('Content-Type', mime)
    .set('Content-Disposition', 'inline')
    .set('Cache-Control', 'private, max-age=60')
    .send(buf);
}));

r.delete('/fiscal/documents/:id', need('settings.edit'), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [doc] } = await pool.query(
    'SELECT * FROM fiscal_documents WHERE id = $1 AND ($2::bigint IS NULL OR client_id = $2)',
    [req.params.id, cid]
  );
  if (!doc) throw new HttpError(404, 'Document introuvable');
  const files = require('./files');
  if (doc.file_path) await files.remove(doc.file_path);
  await pool.query('UPDATE fiscal_checklist_items SET document_id = NULL WHERE document_id = $1', [doc.id]).catch(swallow('fiscal:fiscal_checklist_items', undefined));
  await pool.query('DELETE FROM fiscal_documents WHERE id = $1', [doc.id]);
  await logFiscal(doc.client_id, req.user.id, 'delete_document', 'fiscal_documents', doc.id, doc, null, req.ip);
  res.json({ ok: true, disclaimer: DISCLAIMER });
}));

/** Tableau de bord Superadmin consolidé multi-clients */
r.get('/admin/fiscal/overview', need('user.manage'), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé Superadmin');

  const { rows: clients } = await pool.query(
    `SELECT c.id, c.name, c.status AS client_status,
            ct.features,
            fp.registration_status, fp.declared_regime, fp.nif, fp.last_updated_at AS profile_updated
     FROM clients c
     LEFT JOIN client_contracts ct ON ct.client_id = c.id
     LEFT JOIN fiscal_profiles fp ON fp.client_id = c.id
     ORDER BY c.name`
  );

  const { rows: acts } = await pool.query(
    `SELECT client_id, module_code, activated
     FROM fiscal_module_activations WHERE activated = true`
  );
  const { rows: periodStats } = await pool.query(
    `SELECT client_id,
            COUNT(*)::int AS periods,
            COUNT(*) FILTER (WHERE status IN ('pret','valide_interne'))::int AS ready,
            MAX(period_end) AS last_period_end
     FROM fiscal_periods GROUP BY client_id`
  );
  const { rows: deadlineStats } = await pool.query(
    `SELECT client_id,
            COUNT(*) FILTER (WHERE status IN ('a_venir','en_cours') AND due_date <= CURRENT_DATE + 7)::int AS upcoming,
            COUNT(*) FILTER (WHERE status = 'depasse')::int AS overdue
     FROM fiscal_deadlines WHERE client_id IS NOT NULL GROUP BY client_id`
  );
  const { rows: checkStats } = await pool.query(
    `SELECT client_id,
            COUNT(*)::int AS items,
            COUNT(*) FILTER (WHERE status IN ('fourni','non_applicable'))::int AS done
     FROM fiscal_checklist_items GROUP BY client_id`
  ).catch(swallow('fiscal:1672', { rows: [] }));

  const actMap = {};
  for (const a of acts) {
    if (!actMap[a.client_id]) actMap[a.client_id] = [];
    actMap[a.client_id].push(a.module_code);
  }
  const pMap = Object.fromEntries(periodStats.map(r => [r.client_id, r]));
  const dMap = Object.fromEntries(deadlineStats.map(r => [r.client_id, r]));
  const cMap = Object.fromEntries(checkStats.map(r => [r.client_id, r]));

  const rows = clients.map(c => {
    const f = c.features || {};
    const fiscalOn = f.can_access_fiscal === true || (f.modules && f.modules.fiscal === true);
    const ps = pMap[c.id] || {};
    const ds = dMap[c.id] || {};
    const cs = cMap[c.id] || {};
    return {
      client_id: c.id,
      name: c.name,
      client_status: c.client_status,
      fiscal_authorized: fiscalOn,
      profile_status: c.registration_status || 'absent',
      declared_regime: c.declared_regime || null,
      nif: c.nif || null,
      modules_active: actMap[c.id] || [],
      periods: ps.periods || 0,
      periods_ready: ps.ready || 0,
      last_period_end: ps.last_period_end || null,
      deadlines_upcoming: ds.upcoming || 0,
      deadlines_overdue: ds.overdue || 0,
      checklist_done: cs.done || 0,
      checklist_total: cs.items || 0
    };
  });

  const summary = {
    clients_total: rows.length,
    fiscal_enabled: rows.filter(r => r.fiscal_authorized).length,
    profiles_incomplete: rows.filter(r => !r.profile_status || r.profile_status === 'a_completer' || r.profile_status === 'absent').length,
    deadlines_overdue: rows.reduce((a, r) => a + r.deadlines_overdue, 0),
    deadlines_upcoming: rows.reduce((a, r) => a + r.deadlines_upcoming, 0)
  };

  res.json({ summary, clients: rows, disclaimer: DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// LOT 6 — Complements client (ops) : manuels, ZIP, audit, workflow, synthèse
// Superadmin reste hors parcours (requireFiscalAccess)
// ---------------------------------------------------------------------------

async function estimateManual(clientId, moduleCode, periodStart, periodEnd, manualData, cfg) {
  const P = cfg.params;
  const warnings = [`Taxe calculée avec les paramètres confirmés (${P.calc_mode === 'fixed' ? 'montant forfaitaire' : 'taux ' + P.rate + ' %'} ; base : ${P.base_label} ; texte : ${P.legal_ref}).`,
    'Faire valider par un professionnel habilité avant tout paiement.'];
  const base = Number(manualData?.base_imposable || manualData?.montant_base || 0);
  const deja = Number(manualData?.montants_payes || 0);
  let estimation = 0;
  if (manualData?.estimation != null) { estimation = Number(manualData.estimation); warnings.push('Estimation saisie directement (prioritaire sur le calcul).'); }
  else if (P.calc_mode === 'fixed') estimation = calc.computeSimpleTax(0, { calc_mode: 'fixed', fixed_amount: P.fixed_amount });
  else if (base > 0) estimation = calc.computeSimpleTax(base, { rate: P.rate });
  else warnings.push(`Saisir la base d'imposition (${P.base_label}) pour calculer.`);
  return {
    module: moduleCode,
    period: { start: periodStart, end: periodEnd },
    base_imposable: Math.round(base * 100) / 100,
    taux_applique: P.calc_mode === 'rate' ? Number(P.rate) : null,
    montant_fixe: P.calc_mode === 'fixed' ? Number(P.fixed_amount) : null,
    estimation: Math.round(estimation * 100) / 100,
    montants_payes: deja,
    reste_estime: Math.round(Math.max(0, estimation - deja) * 100) / 100,
    warnings,
    disclaimer: DISCLAIMER
  };
}

r.post('/fiscal/periods/:id/mark-ready', need('settings.edit'), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  await ensureChecklist(period.client_id, period.id, period.module_code);
  const { rows: missing } = await pool.query(
    `SELECT label FROM fiscal_checklist_items
     WHERE period_id = $1 AND required = true AND status = 'manquant'`,
    [period.id]
  );
  if (missing.length) {
    throw new HttpError(400,
      'Pièces obligatoires manquantes : ' + missing.map(m => m.label).join(', '),
      { code: 'FISCAL_CHECKLIST_INCOMPLETE', missing: missing.map(m => m.label) }
    );
  }
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET status = 'pret', updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id]
  );
  await logFiscal(cid, req.user.id, 'mark_ready', 'fiscal_periods', period.id,
    { status: period.status }, { status: 'pret' }, req.ip);
  res.json({
    period: n,
    message: 'Période marquée prête pour revue interne — pas un dépôt DGI.',
    disclaimer: DISCLAIMER
  });
}));

r.post('/fiscal/periods/:id/archive', need('settings.edit'), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET status = 'archive', updated_at = now()
     WHERE id = $1 AND client_id = $2 RETURNING *`,
    [req.params.id, cid]
  );
  if (!n) throw new HttpError(404, 'Période introuvable');
  await logFiscal(cid, req.user.id, 'archive', 'fiscal_periods', n.id, null, { status: 'archive' }, req.ip);
  res.json({ period: n, disclaimer: DISCLAIMER });
}));

r.get('/fiscal/periods/:id/documents.zip', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const { rows: docs } = await pool.query(
    'SELECT * FROM fiscal_documents WHERE period_id = $1 AND file_path IS NOT NULL ORDER BY id',
    [period.id]
  );
  if (!docs.length) throw new HttpError(404, 'Aucun fichier à empaqueter');
  const filesMod = require('./files');
  const path = require('path');
  const { spawn } = require('child_process');
  const os = require('os');
  const fs = require('fs');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fiscal-zip-'));
  const zipPath = path.join(tmpDir, `fiscal-${period.id}.zip`);
  try {
    const names = [];
    for (const d of docs) {
      const buf = await filesMod.read(d.file_path);
      if (!buf) continue;
      const safe = (d.title || 'doc').replace(/[^\w.-]+/g, '_').slice(0, 80);
      const name = `${d.id}_${safe}${path.extname(d.file_path) || ''}`;
      fs.writeFileSync(path.join(tmpDir, name), buf);
      names.push(name);
    }
    if (!names.length) throw new HttpError(404, 'Fichiers introuvables sur le disque');
    await new Promise((resolve, reject) => {
      const p = spawn('zip', ['-q', '-j', zipPath, ...names.map(n => path.join(tmpDir, n))], { cwd: tmpDir });
      p.on('error', reject);
      p.on('close', code => (code === 0 ? resolve() : reject(new Error('zip exit ' + code))));
    });
    res.set('Content-Type', 'application/zip')
      .set('Content-Disposition', `attachment; filename="fiscal-pieces-${period.id}.zip"`)
      .send(fs.readFileSync(zipPath));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
}));

r.get('/fiscal/audit', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const { rows } = await pool.query(
    `SELECT id, action, entity_type, entity_id, old_data, new_data, ip, created_at, user_id
     FROM fiscal_audit_log WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [cid, limit]
  );
  res.json({ entries: rows, disclaimer: DISCLAIMER });
}));

r.get('/fiscal/dashboard/summary', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  const { rows: acts } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated', [cid]
  );
  const { rows: [ps] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'brouillon')::int AS brouillon,
            COUNT(*) FILTER (WHERE status = 'pret')::int AS pret,
            COUNT(*) FILTER (WHERE status = 'valide_interne')::int AS valide_interne,
            COUNT(*) FILTER (WHERE status = 'archive')::int AS archive
     FROM fiscal_periods WHERE client_id = $1`, [cid]
  );
  const { rows: [cs] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('fourni','non_applicable'))::int AS done,
            COUNT(*) FILTER (WHERE required AND status = 'manquant')::int AS missing_required
     FROM fiscal_checklist_items WHERE client_id = $1`, [cid]
  ).catch(swallow('fiscal:1872', { rows: [{ total: 0, done: 0, missing_required: 0 }] }));
  const { rows: [ds] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('a_venir','en_cours') AND due_date <= CURRENT_DATE + 7)::int AS upcoming,
            COUNT(*) FILTER (WHERE status = 'depasse')::int AS overdue
     FROM fiscal_deadlines WHERE client_id = $1 OR client_id IS NULL`,
    [cid]
  );
  const { rows: [docn] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM fiscal_documents WHERE client_id = $1', [cid]
  );
  res.json({
    profile: profile ? {
      registration_status: profile.registration_status,
      declared_regime: profile.declared_regime,
      nif: profile.nif,
      legal_name: profile.legal_name
    } : null,
    modules_active: acts.map(a => a.module_code),
    periods: ps || {},
    checklist: cs || {},
    deadlines: ds || {},
    documents_count: docn?.n || 0,
    disclaimer: DISCLAIMER
  });
}));

// ---------------------------------------------------------------------------
// LOT 7 — Validation interne, clone, règles lues, calendrier, stockage
// ---------------------------------------------------------------------------

r.post('/fiscal/periods/:id/validate-internal', need('settings.edit'), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  if (period.status !== 'pret' && period.status !== 'valide_interne') {
    throw new HttpError(400, 'La période doit être au statut « prêt » avant validation interne.');
  }
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET status = 'valide_interne', updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id]
  );
  await logFiscal(cid, req.user.id, 'validate_internal', 'fiscal_periods', period.id,
    { status: period.status }, { status: 'valide_interne' }, req.ip);
  res.json({
    period: n,
    message: 'Validation interne enregistrée. Cela ne constitue pas un dépôt auprès de la DGI.',
    disclaimer: DISCLAIMER
  });
}));

r.post('/fiscal/periods/:id/clone', need('settings.edit'), body(z.object({
  period_start: z.string(),
  period_end: z.string(),
  period_type: z.enum(['month', 'quarter', 'year', 'custom']).optional()
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [src] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!src) throw new HttpError(404, 'Période source introuvable');
  const b = req.body;
  const { rows: [n] } = await pool.query(
    `INSERT INTO fiscal_periods (
      client_id, station_id, module_code, period_type, period_start, period_end,
      status, data, notes, prepared_by
    ) VALUES ($1,$2,$3,$4,$5,$6,'brouillon',$7,$8,$9) RETURNING *`,
    [cid, src.station_id, src.module_code, b.period_type || src.period_type,
      b.period_start, b.period_end,
      JSON.stringify(src.data || {}),
      (src.notes ? 'Clone de #' + src.id + ' — ' + src.notes : 'Clone de période #' + src.id),
      req.user.id]
  );
  await ensureChecklist(cid, n.id, n.module_code);
  await logFiscal(cid, req.user.id, 'clone_period', 'fiscal_periods', n.id,
    { from: src.id }, { id: n.id }, req.ip);
  res.status(201).json({ period: n, disclaimer: DISCLAIMER });
}));

r.get('/fiscal/rules/applicable', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const asOf = req.query.as_of || new Date().toISOString().slice(0, 10);
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (tax_code, rule_key)
       id, tax_code, rule_key, rule_value, version, verification_status,
       effective_from, effective_to, legal_source, legal_reference, notes
     FROM fiscal_rules
     WHERE effective_from <= $1::date
       AND (effective_to IS NULL OR effective_to >= $1::date)
     ORDER BY tax_code, rule_key,
       CASE verification_status WHEN 'verifiee' THEN 0 ELSE 1 END,
       version DESC`,
    [asOf]
  );
  res.json({
    as_of: asOf,
    rules: rows,
    note: 'Lecture seule. Les règles « a_verifier » rendent les estimations non fiables.',
    disclaimer: DISCLAIMER
  });
}));

r.post('/fiscal/deadlines/generate-year', need('settings.edit'), body(z.object({
  year: z.number().int().min(2020).max(2100),
  module_code: z.string().default('tva'),
  day_of_month: z.number().int().min(1).max(31).optional(),
  title_prefix: z.string().optional()
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_deadlines') && !contract.unrestricted) {
    throw new HttpError(403, 'Suivi des échéances non autorisé.');
  }
  const cid = clientIdOf(req);
  const year = req.body.year;
  const module_code = req.body.module_code || 'tva';
  // Calendrier issu des paramètres confirmés du module (périodicité, jour limite, pénalité) ; à défaut : mensuel, le 15
  const stg = await FS.getSettings(cid, module_code, `${year}-12-31`);
  const P = (stg && stg.params) || {};
  const dueDay = req.body.day_of_month || (P.due_day != null ? Number(P.due_day) : 15);
  const months = P.periodicity === 'annuelle' ? [12] : P.periodicity === 'trimestrielle' ? [3, 6, 9, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const prefix = req.body.title_prefix || `Échéance ${module_code.toUpperCase()}`;
  const penaltyNote = P.late_penalty_pct != null ? `Pénalité de retard paramétrée : ${P.late_penalty_pct} % du montant dû.` : null;
  const created = [];
  for (const m of months) {
    const lastDay = new Date(year, m, 0).getDate();
    const due = `${year}-${String(m).padStart(2, '0')}-${String(Math.min(dueDay, lastDay)).padStart(2, '0')}`;
    const label = `${prefix} ${String(m).padStart(2, '0')}/${year}`;
    const { rows: exist } = await pool.query(
      `SELECT id FROM fiscal_deadlines WHERE client_id = $1 AND module_code = $2 AND due_date = $3::date LIMIT 1`,
      [cid, module_code, due]
    );
    if (exist.length) continue;
    const { rows: [row] } = await pool.query(
      `INSERT INTO fiscal_deadlines (client_id, module_code, title, due_date, period_label, source, status, notes)
       VALUES ($1,$2,$3,$4::date,$5,$6,'a_venir',$7) RETURNING *`,
      [cid, module_code, label, due, `${year}-${String(m).padStart(2, '0')}`, stg ? 'parametre' : 'interne', penaltyNote]
    );
    if (row) created.push(row);
  }
  await logFiscal(cid, req.user.id, 'generate_deadlines', 'fiscal_deadlines', null,
    null, { year, module_code, count: created.length }, req.ip);
  res.status(201).json({
    created: created.length,
    deadlines: created,
    message: `${created.length} échéance(s) créée(s) pour ${year}. Calendrier indicatif interne.`,
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/storage', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: docs } = await pool.query(
    'SELECT id, file_path, title, uploaded_at FROM fiscal_documents WHERE client_id = $1 AND file_path IS NOT NULL',
    [cid]
  );
  const filesMod = require('./files');
  let bytes = 0;
  let filesOk = 0;
  for (const d of docs) {
    try {
      const buf = await filesMod.read(d.file_path);
      if (buf) { bytes += buf.length; filesOk++; }
    } catch (e) { ignored('fiscal:taille-fichier-stockage', e); }
  }
  const q = Number(contract.features?.fiscal_storage_mb);
  const limitMb = Number.isFinite(q) ? q : 100;
  const usedMb = Math.round(bytes / 1024 / 1024 * 100) / 100;
  res.json({
    documents: docs.length,
    files_on_disk: filesOk,
    bytes,
    mb: usedMb,
    quota_mb: limitMb,
    quota_unlimited: limitMb === 0,
    remaining_mb: limitMb === 0 ? null : Math.max(0, Math.round((limitMb - usedMb) * 100) / 100),
    note: 'Limite technique par fichier : 2 Mo (PNG/JPEG/PDF). Quota global selon contrat (fiscal_storage_mb).',
    disclaimer: DISCLAIMER
  });
}));

// ---------------------------------------------------------------------------
// LOT 8 — Réouverture, export Excel unitaire, archivage groupé
// ---------------------------------------------------------------------------

r.post('/fiscal/periods/:id/reopen', need('settings.edit'), body(z.object({
  reason: z.string().min(3).max(500).optional()
}).partial()), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  if (!['pret', 'valide_interne', 'archive'].includes(period.status)) {
    throw new HttpError(400, 'Seules les périodes prêtes, validées ou archivées peuvent être rouvertes.');
  }
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET status = 'a_completer', updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id]
  );
  await logFiscal(cid, req.user.id, 'reopen_period', 'fiscal_periods', period.id,
    { status: period.status }, { status: 'a_completer', reason: req.body.reason || null }, req.ip);
  res.json({
    period: n,
    message: 'Période rouverte (à compléter). Aucun effet sur un dépôt officiel.',
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/periods/:id/export.xlsx', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const { rows: [profile] } = await pool.query(
    'SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]
  );
  const { rows: checkItems } = await pool.query(
    'SELECT label, required, status, notes FROM fiscal_checklist_items WHERE period_id = $1 ORDER BY id',
    [period.id]
  ).catch(swallow('fiscal:2101', { rows: [] }));
  const docs = require('./docs');
  const stationId = period.station_id || req.sid;
  const b = stationId ? await docs.branding(stationId) : {
    name: profile?.legal_name || 'Client', currency: 'FCFA', tax_id: profile?.nif || ''
  };
  await maskEstimates(period.client_id, [period]);
  const est = period.estimates || {};
  const rows = [
    ['Module', period.module_code],
    ['Début', period.period_start],
    ['Fin', period.period_end],
    ['Statut', period.status],
    ['NIF', profile?.nif || ''],
    ['Raison sociale', profile?.legal_name || ''],
    ['Estimates (JSON)', JSON.stringify(est)],
    ['Notes', period.notes || '']
  ];
  if (est.tva_nette_estimee != null) {
    rows.push(['TVA nette estimée', est.tva_nette_estimee]);
    rows.push(['TVA collectée', est.sales?.tva_collected]);
    rows.push(['TVA déductible', est.purchases?.tva_deductible_estimated]);
  }
  if (est.solde_estime != null) rows.push(['Solde estimé', est.solde_estime]);
  if (est.estimation != null) rows.push(['Estimation', est.estimation]);
  if (est.total_its != null) rows.push(['ITS total', est.total_its]);

  const buf = await docs.buildXlsx({
    b,
    title: 'Export période fiscale',
    subtitle: 'Préparation interne — non officiel',
    ref: `FISCAL-P-${period.id}`,
    sheets: [
      { name: 'Période', head: ['Champ', 'Valeur'], rows, notes: [DISCLAIMER] },
      {
        name: 'Checklist',
        head: ['Pièce', 'Requis', 'Statut', 'Notes'],
        rows: checkItems.map(it => [it.label, it.required ? 'Oui' : 'Non', it.status, it.notes || '']),
        notes: ['Checklist interne']
      }
    ]
  });
  docs.send(res, 'xlsx', buf, `fiscal-periode-${period.id}`);
}));

r.post('/fiscal/periods/bulk-archive', need('settings.edit'), body(z.object({
  ids: z.array(z.number().int()).min(1).max(100)
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows } = await pool.query(
    `UPDATE fiscal_periods SET status = 'archive', updated_at = now()
     WHERE client_id = $1 AND id = ANY($2::bigint[]) AND status <> 'archive'
     RETURNING id, module_code, status`,
    [cid, req.body.ids]
  );
  await logFiscal(cid, req.user.id, 'bulk_archive', 'fiscal_periods', null,
    null, { ids: rows.map(r => r.id) }, req.ip);
  res.json({ archived: rows.length, periods: rows, disclaimer: DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// LOT 9 — Notes chronologiques, comparaison, export audit CSV
// ---------------------------------------------------------------------------

r.post('/fiscal/periods/:id/notes', need('settings.edit'), body(z.object({
  text: z.string().min(1).max(2000)
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const data = period.data && typeof period.data === 'object' ? { ...period.data } : {};
  const log = Array.isArray(data.notes_log) ? data.notes_log.slice() : [];
  const entry = {
    at: new Date().toISOString(),
    by: req.user.id,
    text: req.body.text
  };
  log.push(entry);
  data.notes_log = log.slice(-50);
  const notes = [period.notes, req.body.text].filter(Boolean).join('\n—\n').slice(0, 4000);
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET data = $2::jsonb, notes = $3, updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id, JSON.stringify(data), notes]
  );
  await logFiscal(cid, req.user.id, 'add_note', 'fiscal_periods', period.id, null, entry, req.ip);
  res.json({ period: n, entry, disclaimer: DISCLAIMER });
}));

r.get('/fiscal/periods/compare', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const a = parseInt(req.query.a, 10);
  const b = parseInt(req.query.b, 10);
  if (!a || !b) throw new HttpError(400, 'Paramètres a et b (ids de périodes) requis');
  const { rows } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE client_id = $1 AND id = ANY($2::bigint[])',
    [cid, [a, b]]
  );
  if (rows.length < 2) throw new HttpError(404, 'Une ou deux périodes introuvables');
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const pa = byId[a], pb = byId[b];
  const pick = (est) => {
    if (!est || typeof est !== 'object') return null;
    if (est.tva_nette_estimee != null) return { key: 'tva_nette', value: est.tva_nette_estimee };
    if (est.solde_estime != null) return { key: 'solde', value: est.solde_estime };
    if (est.estimation != null) return { key: 'estimation', value: est.estimation };
    if (est.total_its != null) return { key: 'its', value: est.total_its };
    if (est.reste_estime != null) return { key: 'reste', value: est.reste_estime };
    return null;
  };
  await maskEstimates(clientIdOf(req), [pa, pb]);
  const ea = pick(pa.estimates), eb = pick(pb.estimates);
  let delta = null;
  if (ea && eb && ea.key === eb.key && typeof ea.value === 'number' && typeof eb.value === 'number') {
    delta = { key: ea.key, a: ea.value, b: eb.value, diff: Math.round((eb.value - ea.value) * 100) / 100 };
  }
  res.json({
    period_a: { id: pa.id, module_code: pa.module_code, period_start: pa.period_start, period_end: pa.period_end, status: pa.status, estimates: pa.estimates },
    period_b: { id: pb.id, module_code: pb.module_code, period_start: pb.period_start, period_end: pb.period_end, status: pb.status, estimates: pb.estimates },
    delta,
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/audit.csv', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows } = await pool.query(
    `SELECT created_at, action, entity_type, entity_id, user_id, ip
     FROM fiscal_audit_log WHERE client_id = $1 ORDER BY created_at DESC LIMIT 500`,
    [cid]
  );
  const docs = require('./docs');
  const csv = docs.csv(
    ['created_at', 'action', 'entity_type', 'entity_id', 'user_id', 'ip'],
    rows.map(r => [r.created_at, r.action, r.entity_type, r.entity_id, r.user_id, r.ip])
  );
  docs.send(res, 'csv', csv, `fiscal-audit-${cid}`);
}));

// ---------------------------------------------------------------------------
// LOT 10 — Fiche période, historique statuts, CSV documents, finition
// ---------------------------------------------------------------------------

r.get('/fiscal/periods/:id/detail', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2',
    [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  await ensureChecklist(period.client_id, period.id, period.module_code).catch(swallow('fiscal:ensureChecklist', undefined));
  const { rows: checklist } = await pool.query(
    'SELECT id, item_code, label, required, status, notes FROM fiscal_checklist_items WHERE period_id = $1 ORDER BY required DESC, id',
    [period.id]
  ).catch(swallow('fiscal:2261', { rows: [] }));
  const { rows: documents } = await pool.query(
    'SELECT id, doc_type, title, file_path, uploaded_at FROM fiscal_documents WHERE period_id = $1 ORDER BY uploaded_at DESC',
    [period.id]
  ).catch(swallow('fiscal:2265', { rows: [] }));
  const { rows: history } = await pool.query(
    `SELECT action, old_data, new_data, user_id, created_at
     FROM fiscal_audit_log
     WHERE client_id = $1 AND entity_type = 'fiscal_periods' AND entity_id = $2
     ORDER BY created_at DESC LIMIT 40`,
    [cid, period.id]
  ).catch(swallow('fiscal:2272', { rows: [] }));
  const done = checklist.filter(x => x.status === 'fourni' || x.status === 'non_applicable').length;
  const missingRequired = checklist.filter(x => x.required && x.status === 'manquant').length;
  const notesLog = (period.data && period.data.notes_log) || [];
  const workflow = {
    steps: ['brouillon', 'a_completer', 'pret', 'valide_interne', 'archive'],
    current: period.status,
    can_mark_ready: missingRequired === 0 && ['brouillon', 'a_completer'].includes(period.status),
    can_validate: period.status === 'pret',
    can_reopen: ['pret', 'valide_interne', 'archive'].includes(period.status)
  };
  res.json({
    period,
    checklist: { items: checklist, done, total: checklist.length, missing_required: missingRequired },
    documents,
    history,
    notes_log: notesLog,
    workflow,
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/documents.csv', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows } = await pool.query(
    `SELECT d.id, d.period_id, d.module_code, d.doc_type, d.title, d.file_path, d.uploaded_at, d.notes,
            p.period_start, p.period_end, p.status AS period_status
     FROM fiscal_documents d
     LEFT JOIN fiscal_periods p ON p.id = d.period_id
     WHERE d.client_id = $1
     ORDER BY d.uploaded_at DESC LIMIT 500`,
    [cid]
  );
  const docs = require('./docs');
  const csv = docs.csv(
    ['id', 'period_id', 'module_code', 'doc_type', 'title', 'file_path', 'uploaded_at', 'period_start', 'period_end', 'period_status', 'notes'],
    rows.map(r => [r.id, r.period_id, r.module_code, r.doc_type, r.title, r.file_path, r.uploaded_at, r.period_start, r.period_end, r.period_status, r.notes])
  );
  docs.send(res, 'csv', csv, `fiscal-documents-${cid}`);
}));

r.get('/fiscal/health', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  const { rows: acts } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated', [cid]
  );
  const checks = [
    { id: 'profile', ok: !!(profile && profile.nif && profile.registration_status !== 'a_completer'), label: 'Profil fiscal renseigné (NIF)' },
    { id: 'modules', ok: acts.length > 0, label: 'Au moins un module activé' },
    { id: 'access', ok: true, label: 'Accès Fiscalité autorisé par contrat' }
  ];
  res.json({
    ok: checks.every(c => c.ok),
    checks,
    modules_active: acts.map(a => a.module_code),
    disclaimer: DISCLAIMER
  });
}));

// ---------------------------------------------------------------------------
// LOT 11 — Synthèse PDF client, suggestion de période, score complétude
// ---------------------------------------------------------------------------

r.get('/fiscal/periods/suggest-next', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const module = req.query.module;
  if (!module) throw new HttpError(400, 'Paramètre module requis');
  const { rows: [last] } = await pool.query(
    `SELECT * FROM fiscal_periods
     WHERE client_id = $1 AND module_code = $2
     ORDER BY period_end DESC LIMIT 1`,
    [cid, module]
  );
  if (!last) {
    return res.json({
      has_previous: false,
      suggestion: null,
      message: 'Aucune période précédente pour ce module.',
      disclaimer: DISCLAIMER
    });
  }
  const end = new Date(last.period_end);
  const start = new Date(end);
  start.setDate(start.getDate() + 1);
  const period_type = last.period_type || 'month';
  let nextEnd = new Date(start);
  if (period_type === 'month') {
    nextEnd = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  } else if (period_type === 'quarter') {
    nextEnd = new Date(start.getFullYear(), start.getMonth() + 3, 0);
  } else if (period_type === 'year') {
    nextEnd = new Date(start.getFullYear(), 11, 31);
  } else {
    nextEnd.setMonth(nextEnd.getMonth() + 1);
    nextEnd.setDate(0);
  }
  const iso = d => d.toISOString().slice(0, 10);
  res.json({
    has_previous: true,
    previous: {
      id: last.id,
      period_start: last.period_start,
      period_end: last.period_end,
      period_type: last.period_type
    },
    suggestion: {
      period_type,
      period_start: iso(start),
      period_end: iso(nextEnd)
    },
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/completeness', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  const { rows: acts } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated', [cid]
  );
  const { rows: [ps] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('pret','valide_interne'))::int AS ready
     FROM fiscal_periods WHERE client_id = $1`, [cid]
  );
  const { rows: [cs] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('fourni','non_applicable'))::int AS done
     FROM fiscal_checklist_items WHERE client_id = $1`, [cid]
  ).catch(swallow('fiscal:2406', { rows: [{ total: 0, done: 0 }] }));
  const { rows: [ds] } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'depasse')::int AS overdue
     FROM fiscal_deadlines WHERE client_id = $1`, [cid]
  );
  let score = 0;
  const items = [];
  const add = (ok, pts, label) => {
    items.push({ ok: !!ok, points: pts, label });
    if (ok) score += pts;
  };
  add(profile && profile.nif, 20, 'NIF renseigné');
  add(profile && profile.declared_regime, 15, 'Régime déclaré');
  add(profile && profile.registration_status && profile.registration_status !== 'a_completer', 10, 'Profil non « à compléter »');
  add(acts.length > 0, 15, 'Au moins un module activé');
  add((ps?.total || 0) > 0, 15, 'Au moins une période créée');
  add((ps?.ready || 0) > 0, 15, 'Au moins une période prête / validée');
  add((cs?.total || 0) === 0 || (cs?.done || 0) >= (cs?.total || 0) * 0.5, 10, 'Checklist ≥ 50 % (si pièces)');
  if ((ds?.overdue || 0) > 0) {
    items.push({ ok: false, points: 0, label: `${ds.overdue} échéance(s) dépassée(s)` });
  } else {
    items.push({ ok: true, points: 0, label: 'Pas d’échéance dépassée' });
  }
  res.json({
    score: Math.min(100, score),
    max: 100,
    items,
    summary: {
      modules: acts.map(a => a.module_code),
      periods: ps?.total || 0,
      periods_ready: ps?.ready || 0,
      checklist_done: cs?.done || 0,
      checklist_total: cs?.total || 0,
      deadlines_overdue: ds?.overdue || 0
    },
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/summary.pdf', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  const { rows: acts } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated', [cid]
  );
  const { rows: periods } = await pool.query(
    `SELECT id, module_code, period_start, period_end, status, estimates
     FROM fiscal_periods WHERE client_id = $1 ORDER BY period_start DESC LIMIT 30`, [cid]
  );
  await maskEstimates(cid, periods);
  const { rows: deadlines } = await pool.query(
    `SELECT title, due_date, status, module_code FROM fiscal_deadlines
     WHERE client_id = $1 AND status IN ('a_venir','en_cours','depasse')
     ORDER BY due_date ASC LIMIT 20`, [cid]
  );
  const docs = require('./docs');
  const b = req.sid ? await docs.branding(req.sid) : {
    name: profile?.legal_name || 'Client',
    currency: 'FCFA',
    tax_id: profile?.nif || '',
    address: profile?.address || ''
  };
  const kv = [
    ['Raison sociale', profile?.legal_name || '—'],
    ['NIF', profile?.nif || '—'],
    ['Régime déclaré', profile?.declared_regime || '—'],
    ['Statut profil', profile?.registration_status || '—'],
    ['Modules actifs', acts.map(a => a.module_code).join(', ') || '—']
  ];
  const periodRows = periods.map(p => {
    const est = p.estimates || {};
    let key = '';
    if (est.tva_nette_estimee != null) key = est.tva_nette_estimee;
    else if (est.solde_estime != null) key = est.solde_estime;
    else if (est.estimation != null) key = est.estimation;
    else if (est.total_its != null) key = est.total_its;
    return [p.id, p.module_code, p.period_start, p.period_end, p.status, key];
  });
  const buf = await docs.buildPdf({
    b,
    title: 'SYNTHÈSE FISCALE',
    subtitle: 'Document interne de préparation — non officiel',
    ref: `FISCAL-SUM-${cid}-${new Date().toISOString().slice(0, 10)}`,
    landscape: false,
    sections: [
      { type: 'text', title: 'Avertissement', text: DISCLAIMER },
      { type: 'kv', title: 'Profil', rows: kv },
      {
        type: 'table',
        title: 'Périodes récentes',
        head: ['ID', 'Module', 'Début', 'Fin', 'Statut', 'Estimation'],
        rows: periodRows
      },
      {
        type: 'table',
        title: 'Échéances actives',
        head: ['Module', 'Titre', 'Date', 'Statut'],
        rows: deadlines.map(d => [d.module_code, d.title, d.due_date, d.status])
      }
    ],
    signatures: [{ label: 'Préparé par' }, { label: 'Revu par' }]
  });
  docs.send(res, 'pdf', buf, `fiscal-synthese-${cid}`);
}));

// ---------------------------------------------------------------------------
// LOT 12 — Chevauchement (ci-dessus), recalcul, bulk prêt, PDF complétude
// ---------------------------------------------------------------------------

r.post('/fiscal/periods/:id/recalculate', need('settings.edit'), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_estimates') && !contract.unrestricted) {
    throw new HttpError(403, 'Estimations non autorisées sur votre contrat.');
  }
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  if (['archive', 'valide_interne'].includes(period.status)) {
    throw new HttpError(400, 'Recalcul refusé sur une période archivée ou validée en interne. Rouvrez-la d’abord.');
  }
  const data = (period.data && typeof period.data === 'object') ? period.data : {};
  const code = period.module_code;
  const result = await estimateFor(cid, period.station_id || req.sid, code, period.period_start, period.period_end, data);

  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET estimates = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id, JSON.stringify(result)]
  );
  await logFiscal(cid, req.user.id, 'recalculate', 'fiscal_periods', period.id, period.estimates, result, req.ip);
  res.json({ period: n, estimates: result, disclaimer: DISCLAIMER });
}));

r.post('/fiscal/periods/bulk-ready', need('settings.edit'), body(z.object({
  ids: z.array(z.number().int()).min(1).max(50)
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const ok = [];
  const failed = [];
  for (const id of req.body.ids) {
    try {
      const { rows: [period] } = await pool.query(
        'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [id, cid]
      );
      if (!period) { failed.push({ id, error: 'introuvable' }); continue; }
      await ensureChecklist(cid, period.id, period.module_code);
      const { rows: missing } = await pool.query(
        `SELECT label FROM fiscal_checklist_items
         WHERE period_id = $1 AND required = true AND status = 'manquant'`,
        [period.id]
      );
      if (missing.length) {
        failed.push({ id, error: 'pièces manquantes', missing: missing.map(m => m.label) });
        continue;
      }
      await pool.query(
        `UPDATE fiscal_periods SET status = 'pret', updated_at = now() WHERE id = $1`,
        [period.id]
      );
      await logFiscal(cid, req.user.id, 'mark_ready', 'fiscal_periods', period.id,
        { status: period.status }, { status: 'pret' }, req.ip);
      ok.push(id);
    } catch (e) {
      failed.push({ id, error: e.message || 'erreur' });
    }
  }
  res.json({
    ready: ok.length,
    failed: failed.length,
    ok_ids: ok,
    errors: failed,
    message: 'Statut « prêt » = revue interne, pas un dépôt DGI.',
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/completeness.pdf', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  // réutiliser la logique score via requête directe
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  const { rows: acts } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated', [cid]
  );
  const { rows: [ps] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('pret','valide_interne'))::int AS ready
     FROM fiscal_periods WHERE client_id = $1`, [cid]
  );
  const { rows: [cs] } = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('fourni','non_applicable'))::int AS done
     FROM fiscal_checklist_items WHERE client_id = $1`
  ).catch(swallow('fiscal:2608', { rows: [{ total: 0, done: 0 }] }));

  let score = 0;
  const rows = [];
  const add = (ok, pts, label) => {
    rows.push([ok ? 'OK' : '—', label, pts]);
    if (ok) score += pts;
  };
  add(profile && profile.nif, 20, 'NIF renseigné');
  add(profile && profile.declared_regime, 15, 'Régime déclaré');
  add(profile && profile.registration_status && profile.registration_status !== 'a_completer', 10, 'Profil non « à compléter »');
  add(acts.length > 0, 15, 'Au moins un module activé');
  add((ps?.total || 0) > 0, 15, 'Au moins une période créée');
  add((ps?.ready || 0) > 0, 15, 'Au moins une période prête / validée');
  add((cs?.total || 0) === 0 || (cs?.done || 0) >= (cs?.total || 0) * 0.5, 10, 'Checklist ≥ 50 %');

  const docs = require('./docs');
  const b = req.sid ? await docs.branding(req.sid) : {
    name: profile?.legal_name || 'Client', currency: 'FCFA', tax_id: profile?.nif || ''
  };
  const buf = await docs.buildPdf({
    b,
    title: 'COMPLÉTUDE FISCALE',
    subtitle: `Score ${Math.min(100, score)} / 100 — document interne`,
    ref: `FISCAL-SCORE-${cid}`,
    landscape: false,
    sections: [
      { type: 'text', title: 'Avertissement', text: DISCLAIMER },
      { type: 'kv', title: 'Synthèse', rows: [
        ['Score', Math.min(100, score) + ' / 100'],
        ['Modules actifs', acts.map(a => a.module_code).join(', ') || '—'],
        ['Périodes', `${ps?.ready || 0} prêtes / ${ps?.total || 0}`],
        ['Pièces', `${cs?.done || 0} / ${cs?.total || 0}`]
      ]},
      { type: 'table', title: 'Critères', head: ['État', 'Critère', 'Points'], rows }
    ],
    signatures: [{ label: 'Préparé par' }]
  });
  docs.send(res, 'pdf', buf, `fiscal-completude-${cid}`);
}));

// ---------------------------------------------------------------------------
// LOT 13 — Tags, activité récente, verrouillage (patch ci-dessus)
// ---------------------------------------------------------------------------

r.post('/fiscal/periods/:id/tags', need('settings.edit'), body(z.object({
  tags: z.array(z.string().min(1).max(40)).max(10)
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  if (['valide_interne', 'archive'].includes(period.status)) {
    throw new HttpError(400, 'Période verrouillée. Rouvrez-la pour modifier les tags.');
  }
  const data = period.data && typeof period.data === 'object' ? { ...period.data } : {};
  const tags = [...new Set(req.body.tags.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  data.tags = tags;
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET data = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id, JSON.stringify(data)]
  );
  await logFiscal(cid, req.user.id, 'set_tags', 'fiscal_periods', period.id, period.data, { tags }, req.ip);
  res.json({ period: n, tags, disclaimer: DISCLAIMER });
}));

r.get('/fiscal/activity', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const { rows } = await pool.query(
    `SELECT id, action, entity_type, entity_id, user_id, created_at
     FROM fiscal_audit_log WHERE client_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [cid, limit]
  );
  res.json({ activity: rows, disclaimer: DISCLAIMER });
}));

// ---------------------------------------------------------------------------
// LOT 14 — Épinglage, export sélection, rafraîchissement échéances client
// ---------------------------------------------------------------------------

r.post('/fiscal/periods/:id/pin', need('settings.edit'), body(z.object({
  pinned: z.boolean()
})), wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const { rows: [period] } = await pool.query(
    'SELECT * FROM fiscal_periods WHERE id = $1 AND client_id = $2', [req.params.id, cid]
  );
  if (!period) throw new HttpError(404, 'Période introuvable');
  const data = period.data && typeof period.data === 'object' ? { ...period.data } : {};
  data.pinned = !!req.body.pinned;
  const { rows: [n] } = await pool.query(
    `UPDATE fiscal_periods SET data = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [period.id, JSON.stringify(data)]
  );
  await logFiscal(cid, req.user.id, data.pinned ? 'pin' : 'unpin', 'fiscal_periods', period.id,
    null, { pinned: data.pinned }, req.ip);
  res.json({ period: n, pinned: data.pinned, disclaimer: DISCLAIMER });
}));

r.post('/fiscal/periods/bulk-export.xlsx', need('settings.edit'), body(z.object({
  ids: z.array(z.number().int()).min(1).max(30)
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  const { rows: periods } = await pool.query(
    `SELECT * FROM fiscal_periods WHERE client_id = $1 AND id = ANY($2::bigint[])
     ORDER BY period_start`,
    [cid, req.body.ids]
  );
  if (!periods.length) throw new HttpError(404, 'Aucune période trouvée');
  await maskEstimates(cid, periods);
  const { rows: [profile] } = await pool.query(
    'SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]
  );
  const docs = require('./docs');
  const b = req.sid ? await docs.branding(req.sid) : {
    name: profile?.legal_name || 'Client', currency: 'FCFA', tax_id: profile?.nif || ''
  };
  const sheets = periods.map(p => {
    const est = p.estimates || {};
    const rows = [
      ['ID', p.id],
      ['Module', p.module_code],
      ['Début', p.period_start],
      ['Fin', p.period_end],
      ['Statut', p.status],
      ['Notes', p.notes || ''],
      ['Estimates JSON', JSON.stringify(est)]
    ];
    if (est.tva_nette_estimee != null) rows.push(['TVA nette', est.tva_nette_estimee]);
    if (est.solde_estime != null) rows.push(['Solde estimé', est.solde_estime]);
    if (est.estimation != null) rows.push(['Estimation', est.estimation]);
    if (est.total_its != null) rows.push(['ITS', est.total_its]);
    return {
      name: `${p.module_code}-${p.id}`.slice(0, 31),
      head: ['Champ', 'Valeur'],
      rows,
      notes: [DISCLAIMER]
    };
  });
  const buf = await docs.buildXlsx({
    b,
    title: 'Export périodes fiscales sélectionnées',
    subtitle: 'Préparation interne — non officiel',
    ref: `FISCAL-BULK-${cid}`,
    sheets
  });
  docs.send(res, 'xlsx', buf, `fiscal-selection-${cid}`);
}));

/** Rafraîchit uniquement les échéances du client courant (statuts a_venir / en_cours / depasse) */
r.post('/fiscal/deadlines/refresh', need('settings.edit'), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_deadlines') && !contract.unrestricted) {
    throw new HttpError(403, 'Suivi des échéances non autorisé.');
  }
  const cid = clientIdOf(req);
  const { rowCount: overdue } = await pool.query(
    `UPDATE fiscal_deadlines SET status = 'depasse'
     WHERE client_id = $1 AND status IN ('a_venir','en_cours') AND due_date < CURRENT_DATE`,
    [cid]
  );
  const { rowCount: current } = await pool.query(
    `UPDATE fiscal_deadlines SET status = 'en_cours'
     WHERE client_id = $1 AND status = 'a_venir'
       AND due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + 7`,
    [cid]
  );
  await logFiscal(cid, req.user.id, 'refresh_deadlines', 'fiscal_deadlines', null,
    null, { overdue, current }, req.ip);
  res.json({
    overdue_updated: overdue || 0,
    current_updated: current || 0,
    message: 'Statuts des échéances actualisés pour ce compte client.',
    disclaimer: DISCLAIMER
  });
}));

// ---------------------------------------------------------------------------
// LOT 15 — Vue annuelle, PDF profil, création batch mensuelle
// ---------------------------------------------------------------------------

r.get('/fiscal/year-overview', wrap(async (req, res) => {
  await requireFiscalAccess(req);
  const cid = clientIdOf(req);
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year + 1}-01-01`;
  const { rows: periods } = await pool.query(
    `SELECT id, module_code, period_start, period_end, status, estimates
     FROM fiscal_periods
     WHERE client_id = $1
       AND period_start >= $2::date AND period_start < $3::date
     ORDER BY module_code, period_start`,
    [cid, from, to]
  );
  await maskEstimates(cid, periods);
  const byModule = {};
  for (const p of periods) {
    if (!byModule[p.module_code]) {
      byModule[p.module_code] = { module_code: p.module_code, count: 0, ready: 0, total_estimate: 0, periods: [] };
    }
    const m = byModule[p.module_code];
    m.count++;
    if (p.status === 'pret' || p.status === 'valide_interne') m.ready++;
    const est = p.estimates || {};
    let v = null;
    if (est.tva_nette_estimee != null) v = Number(est.tva_nette_estimee);
    else if (est.solde_estime != null) v = Number(est.solde_estime);
    else if (est.estimation != null) v = Number(est.estimation);
    else if (est.total_its != null) v = Number(est.total_its);
    else if (est.reste_estime != null) v = Number(est.reste_estime);
    if (v != null && !Number.isNaN(v)) m.total_estimate += v;
    m.periods.push({
      id: p.id, period_start: p.period_start, period_end: p.period_end, status: p.status, estimate: v
    });
  }
  const { rows: deadlines } = await pool.query(
    `SELECT id, module_code, title, due_date, status FROM fiscal_deadlines
     WHERE client_id = $1 AND due_date >= $2::date AND due_date < $3::date
     ORDER BY due_date`,
    [cid, from, to]
  );
  res.json({
    year,
    modules: Object.values(byModule),
    periods_total: periods.length,
    deadlines,
    disclaimer: DISCLAIMER
  });
}));

r.get('/fiscal/profile.pdf', wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_exports') && !contract.unrestricted) {
    throw new HttpError(403, 'Exports fiscaux non autorisés.');
  }
  const cid = clientIdOf(req);
  const { rows: [profile] } = await pool.query('SELECT * FROM fiscal_profiles WHERE client_id = $1', [cid]);
  if (!profile) throw new HttpError(404, 'Profil fiscal non renseigné');
  const { rows: acts } = await pool.query(
    'SELECT module_code FROM fiscal_module_activations WHERE client_id = $1 AND activated', [cid]
  );
  const docs = require('./docs');
  const b = req.sid ? await docs.branding(req.sid) : {
    name: profile.legal_name || 'Client', currency: 'FCFA', tax_id: profile.nif || '',
    address: profile.address || ''
  };
  const buf = await docs.buildPdf({
    b,
    title: 'PROFIL FISCAL',
    subtitle: 'Fiche interne — non officielle',
    ref: `FISCAL-PROF-${cid}`,
    landscape: false,
    sections: [
      { type: 'text', title: 'Avertissement', text: DISCLAIMER },
      {
        type: 'kv',
        title: 'Identification',
        rows: [
          ['Raison sociale', profile.legal_name || '—'],
          ['Forme juridique', profile.legal_form || '—'],
          ['NIF', profile.nif || '—'],
          ['RCCM', profile.rccm || '—'],
          ['Adresse', profile.address || '—'],
          ['Téléphone', profile.phone || '—'],
          ['Email', profile.email || '—']
        ]
      },
      {
        type: 'kv',
        title: 'Situation déclarée',
        rows: [
          ['Régime', profile.declared_regime || '—'],
          ['Statut inscription', profile.registration_status || '—'],
          ['Validé en interne', profile.regime_validated ? 'Oui' : 'Non'],
          ['Activité principale', profile.main_activity || '—'],
          ['Modules activés', acts.map(a => a.module_code).join(', ') || '—']
        ]
      }
    ],
    signatures: [{ label: 'Contrôlé par' }]
  });
  docs.send(res, 'pdf', buf, `fiscal-profil-${cid}`);
}));

r.post('/fiscal/periods/batch-year', need('settings.edit'), body(z.object({
  module_code: z.string().min(1),
  year: z.number().int().min(2020).max(2100),
  skip_existing: z.boolean().optional()
})), wrap(async (req, res) => {
  const contract = await requireFiscalAccess(req);
  if (!featureOn(contract, 'can_fiscal_prepare') && !contract.unrestricted) {
    throw new HttpError(403, 'Préparation des périodes non autorisée.');
  }
  const cid = clientIdOf(req);
  const { module_code, year } = req.body;
  const skip = req.body.skip_existing !== false;
  const { rows: [act] } = await pool.query(
    'SELECT activated FROM fiscal_module_activations WHERE client_id = $1 AND module_code = $2',
    [cid, module_code]
  );
  if (!act || !act.activated) {
    throw new HttpError(400, 'Activez d’abord ce module fiscal.');
  }
  const created = [];
  const skipped = [];
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${String(m).padStart(2, '0')}-01`;
    const endDate = new Date(year, m, 0);
    const end = endDate.toISOString().slice(0, 10);
    if (skip) {
      const { rows: exist } = await pool.query(
        `SELECT id FROM fiscal_periods WHERE client_id = $1 AND module_code = $2
         AND period_start = $3::date LIMIT 1`,
        [cid, module_code, start]
      );
      if (exist.length) {
        skipped.push(start);
        continue;
      }
    }
    const { rows: [p] } = await pool.query(
      `INSERT INTO fiscal_periods (client_id, station_id, module_code, period_type, period_start, period_end, data, prepared_by, notes)
       VALUES ($1,$2,$3,'month',$4,$5,'{}',$6,$7) RETURNING *`,
      [cid, req.sid || null, module_code, start, end, req.user.id,
        `Création batch ${year}`]
    );
    await ensureChecklist(cid, p.id, module_code).catch(swallow('fiscal:ensureChecklist', undefined));
    created.push({ id: p.id, period_start: start, period_end: end });
  }
  await logFiscal(cid, req.user.id, 'batch_year', 'fiscal_periods', null,
    null, { module_code, year, created: created.length, skipped: skipped.length }, req.ip);
  res.status(201).json({
    created: created.length,
    skipped: skipped.length,
    periods: created,
    message: `${created.length} période(s) créée(s) pour ${year} (${skipped.length} déjà existante(s)).`,
    disclaimer: DISCLAIMER
  });
}));

module.exports = {
  r, MODULE_DEFS, DISCLAIMER,
  estimateTVA, estimateProfitTax, estimateSynthetique, estimateITSFromHR,
  estimateEmployerTax, estimateManual, scanFiscalDeadlines, ensureChecklist,
  estimateFor, dispatchEstimate, requireFiscalAccess, clientIdOf, logFiscal
};
