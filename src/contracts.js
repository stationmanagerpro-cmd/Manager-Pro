// Contrats clients — Administrateur Principal (is_global) uniquement pour la configuration.
// Le Gérant consomme les droits ; il ne peut jamais les augmenter.
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');

const DEFAULT_FEATURES = {
  // Par defaut TOUT est actif (sauf fiscalite). Le Super Admin desactive explicitement.
  can_view_reports: true,
  can_export_reports: true,
  can_view_advanced_reports: true,
  can_access_settings: true,
  can_access_advanced_settings: true,
  can_customize_signature: true,
  signature_mode: 'none',   // signature client autorisée par le Super Admin : none | handwritten | image | both
  can_access_hr: true,
  can_manage_hr: true,
  can_access_finance: true,
  can_access_personalization: true,
  can_manage_services: true,
  can_use_messaging: true,
  messaging_attachments: true,
  messaging_groups: true,
  messaging_broadcast: true,
  messaging_support: true,
  can_use_auto_alerts: true,
  employee_portal_payslips: true,
  employee_portal_commissions: true,
  can_customize_report_exports: true,
  can_view_coming_soon: true,
  can_use_billing: true,
  demo_mode: false,
  can_access_fiscal: false,
  can_access_accounting: false,
  can_fiscal_estimates: false,
  can_fiscal_exports: false,
  can_fiscal_prepare: false,
  can_fiscal_deadlines: false,
  fiscal_storage_mb: 100,
  modules: {
    sales: true,
    stock: true,
    purchases: true,
    suppliers: true,
    customers: true,
    shifts: true,
    employees: true,
    pumps: true,
    reports: true,
    finance: true,
    hr: true,
    personalization: true,
    reconcile: true,
    period_lock: true,
    receipts: true,
    price_history: true,
    payroll_amo: true,
    payroll_inps: true,
    payroll_its: true,
    payroll_charges: true,
    messaging: true,
    auto_alerts: true,
    report_colors: true,
    billing: true,
    imports: true,
    direction: true,
    eod: true,
    mm_commission: true,
    seller_commissions: true,
    multistation: true,
    fiscal: false,
    fiscal_tva: false,
    fiscal_synthetique: false,
    fiscal_ibic: false,
    fiscal_is: false,
    fiscal_its: false,
    fiscal_cfe: false,
    fiscal_tfp: false,
    fiscal_logement: false,
    fiscal_retenues: false,
    fiscal_autres: false,
    accounting: false,
    accounting_entries: false,
    accounting_assets: false,
    accounting_vat: false,
    accounting_closing: false,
    accounting_export: false
  }
};

function coerceBool(v, fallback) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return fallback;
}

function mergeFeatures(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const f = { ...DEFAULT_FEATURES, ...src };
  // Normaliser les booléens top-level (évite "true" string resté en base)
  for (const k of Object.keys(DEFAULT_FEATURES)) {
    if (k === 'modules' || k === 'fiscal_storage_mb') continue;
    if (typeof DEFAULT_FEATURES[k] === 'boolean' && k in src) {
      f[k] = coerceBool(src[k], DEFAULT_FEATURES[k]);
    }
  }
  if (!['none', 'handwritten', 'image', 'both'].includes(f.signature_mode)) f.signature_mode = 'none';
  const srcMods = (src.modules && typeof src.modules === 'object') ? src.modules : {};
  f.modules = { ...DEFAULT_FEATURES.modules };
  for (const [mk, mv] of Object.entries({ ...DEFAULT_FEATURES.modules, ...srcMods })) {
    f.modules[mk] = coerceBool(mv, DEFAULT_FEATURES.modules[mk] !== undefined ? DEFAULT_FEATURES.modules[mk] : false);
  }
  // Cohérence fiscalité : un accès principal OU un sous-module explicitement autorisé
  // doit rendre le module global accessible. Sinon l'UI et l'API refusaient l'accès
  // alors que l'administrateur avait activé des autorisations fiscales détaillées.
  const fiscalSubmoduleEnabled = Object.entries(f.modules).some(([key, value]) =>
    key.startsWith('fiscal_') && value === true
  );
  if (f.can_access_fiscal === true || f.modules.fiscal === true || fiscalSubmoduleEnabled) {
    f.can_access_fiscal = true;
    f.modules.fiscal = true;
  }
  // Cohérence comptabilité : une option comptable autorisée rend le module Comptabilité accessible.
  const accSub = Object.entries(f.modules).some(([key, value]) => key.startsWith('accounting_') && value === true);
  if (f.can_access_accounting === true || f.modules.accounting === true || accSub) {
    f.can_access_accounting = true;
    f.modules.accounting = true;
  }
  return f;
}

/** Charge le contrat du client de l'utilisateur (null si admin global ou sans client). */
async function loadContractForUser(userId, isGlobal) {
  if (isGlobal) return { is_principal: true, unrestricted: true };
  const { rows: [u] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [userId]);
  if (!u || !u.client_id) return { is_principal: false, unrestricted: true, client_id: null, note: 'Sans client lié — comportement historique' };
  return loadContract(u.client_id);
}

/** Calcule expires_at à partir d'un début + durée. */
function computeExpiry(startsAt, durationValue, durationUnit) {
  if (!durationUnit || durationUnit === 'indefinite') return null;
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date de début invalide');
  const v = Math.max(1, parseInt(durationValue, 10) || 1);
  if (durationUnit === 'day') d.setUTCDate(d.getUTCDate() + v);
  else if (durationUnit === 'month') d.setUTCMonth(d.getUTCMonth() + v);
  else if (durationUnit === 'year') d.setUTCFullYear(d.getUTCFullYear() + v);
  else if (durationUnit === 'custom') d.setUTCDate(d.getUTCDate() + v); // custom = N jours
  else throw new HttpError(400, 'Unité de durée invalide');
  // Fin de journée UTC - 1s pour clarté « jour J inclus »
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Seuils d'avertissement (jours) — configurables via settings.license_warning_thresholds */
async function getWarningThresholds() {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key = 'license_warning_thresholds' LIMIT 1`
    );
    if (rows[0]?.value) {
      const arr = String(rows[0].value).split(/[,;\s]+/).map(Number).filter((n) => n > 0);
      if (arr.length) return arr.sort((a, b) => b - a); // ex: [30,15,7,3,1]
    }
  } catch (_) { /* settings table may lack row */ }
  return [30, 15, 7, 3, 1];
}

/** Statut licence normalisé pour l'UI et le middleware.
 *  expiringThresholdDays : seuil max pour EXPIRANT_BIENTOT (défaut 30). */
function licenseStatusOf(row, now = new Date(), expiringThresholdDays = 30) {
  if (row.client_status === 'suspendu' || row.contract_status === 'suspendu') return 'SUSPENDUE';
  if (row.is_indefinite || (!row.expires_at && !row.end_date)) return 'INDEFINIE';
  const exp = row.expires_at ? new Date(row.expires_at) : (row.end_date ? new Date(row.end_date + 'T23:59:59Z') : null);
  if (!exp) return 'INDEFINIE';
  if (exp.getTime() < now.getTime()) return 'EXPIREE';
  const daysLeft = (exp.getTime() - now.getTime()) / 864e5;
  if (daysLeft <= expiringThresholdDays) return 'EXPIRANT_BIENTOT';
  return 'ACTIVE';
}

function daysRemaining(expiresAt, now = new Date()) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  return Math.ceil((exp.getTime() - now.getTime()) / 864e5);
}

async function recordLicenseHistory(c, {
  clientId, contractId, operation, oldStatus, newStatus,
  oldStartsAt, oldExpiresAt, newStartsAt, newExpiresAt,
  durationValue, durationUnit, isIndefinite, note, performedBy, meta
}) {
  await c.query(
    `INSERT INTO license_history(
       client_id, contract_id, operation, old_status, new_status,
       old_starts_at, old_expires_at, new_starts_at, new_expires_at,
       duration_value, duration_unit, is_indefinite, note, performed_by, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      clientId, contractId || null, operation, oldStatus || null, newStatus || null,
      oldStartsAt || null, oldExpiresAt || null, newStartsAt || null, newExpiresAt || null,
      durationValue ?? null, durationUnit || null, !!isIndefinite, note || null,
      performedBy || null, meta ? JSON.stringify(meta) : null
    ]
  );
}

async function loadContract(clientId) {
  const { rows: [row] } = await pool.query(
    `SELECT c.id AS client_id, c.name AS client_name, c.status AS client_status, c.owner_user_id,
            c.manager_name, c.contact_email, c.contact_phone, c.code,
            ct.id AS contract_id, ct.contract_type, ct.start_date, ct.end_date, ct.status AS contract_status,
            ct.can_create_station, ct.max_stations, ct.can_manage_users, ct.max_users,
            ct.features, ct.forced_signature, ct.notes,
            ct.duration_value, ct.duration_unit, ct.starts_at, ct.expires_at, ct.is_indefinite,
            ct.last_renewed_at, ct.suspended_at, ct.suspend_reason, ct.access_revoked, ct.contract_snapshot
     FROM clients c
     LEFT JOIN client_contracts ct ON ct.client_id = c.id
     WHERE c.id = $1`, [clientId]
  );
  if (!row) throw new HttpError(404, 'Client introuvable');
  // Expiration automatique soft (status DB + timestamps)
  let status = row.contract_status || 'actif';
  const now = new Date();
  const expTs = row.expires_at ? new Date(row.expires_at) : (row.end_date ? new Date(row.end_date + 'T23:59:59Z') : null);
  // Auto-réparation : contrat marqué « expire » par expiration naturelle alors que l'échéance a depuis été repoussée
  // (ni résiliation ni suspension manuelle) → on le remet « actif ».
  if (status === 'expire' && !row.suspended_at && row.client_status !== 'suspendu' && !row.access_revoked &&
      (row.is_indefinite || (expTs && expTs.getTime() > now.getTime()))) {
    status = 'actif';
    await pool.query(`UPDATE client_contracts SET status = 'actif' WHERE client_id = $1 AND status = 'expire'`, [clientId]);
  }
  if (status === 'actif' && expTs && expTs.getTime() < now.getTime() && !row.is_indefinite) {
    status = 'expire';
    await pool.query(`UPDATE client_contracts SET status = 'expire' WHERE client_id = $1 AND status = 'actif'`, [clientId]);
  }
  const license_status = licenseStatusOf({ ...row, contract_status: status }, now);
  const features = mergeFeatures(row.features);
  const suspended = !!row.access_revoked || row.client_status === 'suspendu' || status === 'suspendu' || status === 'expire' || license_status === 'EXPIREE' || license_status === 'SUSPENDUE';
  const stations_used = await countClientStations(clientId);
  const users_used = await countClientUsers(clientId);
  const maxS = row.max_stations;
  const maxU = row.max_users;
  const days_left = row.is_indefinite ? null : daysRemaining(row.expires_at || (row.end_date ? row.end_date + 'T23:59:59Z' : null), now);
  return {
    is_principal: false,
    unrestricted: false,
    client_id: row.client_id,
    client_name: row.client_name,
    client_status: row.client_status,
    manager_name: row.manager_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    code: row.code,
    contract_id: row.contract_id,
    contract_type: row.contract_type,
    start_date: row.start_date,
    end_date: row.end_date,
    starts_at: row.starts_at || row.start_date,
    expires_at: row.expires_at || (row.end_date ? row.end_date + 'T23:59:59Z' : null),
    duration_value: row.duration_value,
    duration_unit: row.duration_unit,
    is_indefinite: !!row.is_indefinite || (!row.expires_at && !row.end_date && status === 'actif'),
    license_status,
    days_remaining: days_left,
    contract_status: status,
    can_create_station: !!row.can_create_station && !suspended,
    max_stations: maxS,
    can_manage_users: !!row.can_manage_users && !suspended,
    max_users: maxU,
    features,
    forced_signature: row.forced_signature,
    suspended,
    license_expired: license_status === 'EXPIREE',
    license_suspended: license_status === 'SUSPENDUE',
    access_revoked: !!row.access_revoked,
    contract_snapshot: row.contract_snapshot || null,
    notes: row.notes,
    last_renewed_at: row.last_renewed_at,
    suspended_at: row.suspended_at,
    suspend_reason: row.suspend_reason,
    quotas: {
      stations: {
        used: stations_used,
        max: maxS,
        unlimited: maxS == null,
        remaining: maxS == null ? null : Math.max(0, maxS - stations_used),
        at_limit: maxS != null && stations_used >= maxS,
        can_create: !!row.can_create_station && !suspended && (maxS == null || stations_used < maxS)
      },
      users: {
        used: users_used,
        max: maxU,
        unlimited: maxU == null,
        remaining: maxU == null ? null : Math.max(0, maxU - users_used),
        at_limit: maxU != null && users_used >= maxU,
        can_create: !!row.can_manage_users && !suspended && (maxU == null || users_used < maxU)
      }
    }
  };
}
function featureOn(contract, key) {
  if (!contract || contract.unrestricted) return true;
  if (contract.suspended) return false;
  const f = contract.features || {};
  if (key.startsWith('module:')) {
    const m = key.slice(7);
    const v = f.modules && f.modules[m];
    return v === true || v === 'true' || v === 1;
  }
  const v = f[key];
  return v === true || v === 'true' || v === 1;
}

async function countClientStations(clientId) {
  const { rows: [r] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM stations WHERE client_id = $1 AND active', [clientId]
  );
  return r.n;
}

async function countClientUsers(clientId) {
  const { rows: [r] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE client_id = $1 AND deleted_at IS NULL AND active`, [clientId]
  );
  return r.n;
}

/** Middleware : exige is_global */
const needPrincipal = wrap(async (req, res, next) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé à l\'Administrateur Principal');
  next();
});

/** Attache req.contract pour l'utilisateur courant */
const attachContract = wrap(async (req, res, next) => {
  req.contract = await loadContractForUser(req.user.id, req.user.is_global);
  next();
});

function requireFeature(key) {
  return wrap(async (req, res, next) => {
    if (!req.contract) req.contract = await loadContractForUser(req.user.id, req.user.is_global);
    if (req.contract.unrestricted) return next();
    if (req.contract.suspended) throw new HttpError(403, 'Contrat client suspendu ou expiré.');
    if (!featureOn(req.contract, key)) throw new HttpError(403, `Fonctionnalité non incluse dans votre contrat (${key}).`);
    next();
  });
}

// ---------- Routes Admin Principal ----------
const r = express.Router();

r.get('/admin/clients', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.code, c.name, c.status, c.contact_email, c.contact_phone, c.manager_name,
            c.owner_user_id, u.login AS owner_login,
            ct.contract_type, ct.status AS contract_status, ct.max_stations, ct.max_users,
            ct.can_create_station, ct.can_manage_users, ct.start_date, ct.end_date,
            ct.starts_at, ct.expires_at, ct.is_indefinite, ct.duration_value, ct.duration_unit,
            ct.features,
            (SELECT COUNT(*)::int FROM stations s WHERE s.client_id = c.id AND s.active) AS stations_count,
            (SELECT COUNT(*)::int FROM users x WHERE x.client_id = c.id AND x.deleted_at IS NULL) AS users_count
     FROM clients c
     LEFT JOIN client_contracts ct ON ct.client_id = c.id
     LEFT JOIN users u ON u.id = c.owner_user_id
     ORDER BY c.id DESC`
  );
  const now = new Date();
  res.json(rows.map(r => {
    const lic = licenseStatusOf(r, now);
    const exp = r.expires_at || (r.end_date ? r.end_date + 'T23:59:59Z' : null);
    return {
      ...r,
      license_status: lic,
      days_remaining: r.is_indefinite ? null : daysRemaining(exp, now),
      features: mergeFeatures(r.features)
    };
  }));
}));

/** Vue consolidée de la plateforme : clients, stations et licences, Super Admin uniquement. */
r.get('/admin/platform/overview', needPrincipal, wrap(async (req, res) => {
  const thresholds = await getWarningThresholds();
  const maxWarn = thresholds[0] || 30;
  const { rows } = await pool.query(
    `SELECT c.id AS client_id, c.name AS client_name, c.code AS client_code,
            c.status AS client_status, c.manager_name, c.contact_email,
            ct.status AS contract_status, ct.starts_at, ct.expires_at,
            ct.start_date, ct.end_date, ct.is_indefinite, ct.features,
            (SELECT COUNT(*)::int FROM stations s WHERE s.client_id=c.id) AS station_count,
            (SELECT COUNT(*)::int FROM stations s WHERE s.client_id=c.id AND s.active) AS active_station_count,
            (SELECT COUNT(*)::int FROM users u WHERE u.client_id=c.id AND u.deleted_at IS NULL AND u.active) AS active_user_count,
            COALESCE((SELECT jsonb_agg(jsonb_build_object(
              'id', s.id, 'name', s.name, 'active', s.active, 'address', s.address
            ) ORDER BY s.name, s.id) FROM stations s WHERE s.client_id=c.id), '[]'::jsonb) AS stations
     FROM clients c
     LEFT JOIN client_contracts ct ON ct.client_id=c.id
     WHERE c.status <> 'archive'
     ORDER BY c.name, c.id`
  );
  const now = new Date();
  const clients = rows.map(row => {
    const license_status = licenseStatusOf(row, now, maxWarn);
    const expiry = row.expires_at || (row.end_date ? row.end_date + 'T23:59:59Z' : null);
    return {
      ...row,
      license_status,
      expires_at: expiry,
      days_remaining: row.is_indefinite ? null : daysRemaining(expiry, now),
      stations: Array.isArray(row.stations) ? row.stations : []
    };
  });
  const totals = {
    clients: clients.length,
    active_clients: clients.filter(c => c.client_status === 'actif' && !['SUSPENDUE', 'EXPIREE'].includes(c.license_status)).length,
    suspended_clients: clients.filter(c => c.client_status === 'suspendu' || c.license_status === 'SUSPENDUE').length,
    active_stations: clients.reduce((n, c) => n + Number(c.active_station_count || 0), 0),
    inactive_stations: clients.reduce((n, c) => n + Math.max(0, Number(c.station_count || 0) - Number(c.active_station_count || 0)), 0),
    stations: clients.reduce((n, c) => n + Number(c.station_count || 0), 0),
    expiring_soon: clients.filter(c => c.license_status === 'EXPIRANT_BIENTOT').length,
    expired: clients.filter(c => c.license_status === 'EXPIREE').length,
    active_licenses: clients.filter(c => ['ACTIVE', 'INDEFINIE'].includes(c.license_status)).length
  };
  const { rows: unassignedRows } = await pool.query(
    `SELECT id, name, active, address FROM stations WHERE client_id IS NULL ORDER BY name, id`
  );
  res.json({ generated_at: now.toISOString(), totals, clients, unassigned_stations: unassignedRows });
}));

/** Tableau de bord licences — Administrateur Principal */
r.get('/admin/licenses/dashboard', needPrincipal, wrap(async (req, res) => {
  const thresholds = await getWarningThresholds();
  const maxWarn = thresholds[0] || 30;
  const clients = (await pool.query(
    `SELECT c.id, c.name, c.status AS client_status, c.contact_email, c.manager_name, c.contact_phone,
            ct.status AS contract_status, ct.starts_at, ct.expires_at, ct.is_indefinite,
            ct.duration_value, ct.duration_unit, ct.start_date, ct.end_date, ct.features,
            ct.max_users, ct.can_manage_users,
            (SELECT COUNT(*)::int FROM users x WHERE x.client_id = c.id AND x.deleted_at IS NULL) AS users_count
     FROM clients c
     LEFT JOIN client_contracts ct ON ct.client_id = c.id
     WHERE c.status <> 'archive'
     ORDER BY c.name`
  )).rows;
  const now = new Date();
  const items = clients.map(r => {
    const lic = licenseStatusOf(r, now, maxWarn);
    const exp = r.expires_at || (r.end_date ? r.end_date + 'T23:59:59Z' : null);
    const days = r.is_indefinite ? null : daysRemaining(exp, now);
    // Bande d'avertissement la plus proche (30/15/7/3/1)
    let warn_band = null;
    if (days != null && days >= 0) {
      for (const t of thresholds) {
        if (days <= t) warn_band = t;
      }
    }
    return {
      client_id: r.id, name: r.name, manager_name: r.manager_name,
      contact_email: r.contact_email, contact_phone: r.contact_phone,
      starts_at: r.starts_at || r.start_date, expires_at: exp,
      duration_value: r.duration_value, duration_unit: r.duration_unit,
      is_indefinite: !!r.is_indefinite, license_status: lic,
      days_remaining: days, warn_band,
      users_count: r.users_count, max_users: r.max_users,
      can_manage_users: r.can_manage_users,
      modules: (mergeFeatures(r.features).modules) || {}
    };
  });
  const count = (s) => items.filter(i => i.license_status === s).length;
  const { rows: recent } = await pool.query(
    `SELECT h.*, c.name AS client_name, u.login AS admin_login
     FROM license_history h
     JOIN clients c ON c.id = h.client_id
     LEFT JOIN users u ON u.id = h.performed_by
     ORDER BY h.performed_at DESC LIMIT 20`
  ).catch(swallow('contracts:478', { rows: [] }));
  const { rows: pendingRenewals } = await pool.query(
    `SELECT rr.*, c.name AS client_name, u.login AS requester_login
     FROM license_renewal_requests rr
     JOIN clients c ON c.id = rr.client_id
     LEFT JOIN users u ON u.id = rr.requested_by
     WHERE rr.status = 'pending'
     ORDER BY rr.requested_at DESC LIMIT 50`
  ).catch(swallow('contracts:486', { rows: [] }));
  res.json({
    warning_thresholds: thresholds,
    pending_renewal_requests: pendingRenewals,
    totals: {
      clients: items.length,
      active: count('ACTIVE') + count('INDEFINIE'),
      expiring_soon: count('EXPIRANT_BIENTOT'),
      expired: count('EXPIREE'),
      suspended: count('SUSPENDUE'),
      indefinite: count('INDEFINIE'),
      users: items.reduce((a, i) => a + (i.users_count || 0), 0)
    },
    clients: items,
    recent_operations: recent
  });
}));

// Station par défaut d'un client : caisse, moyens de paiement, tolérance carburant (mêmes valeurs que src/setup.js et POST /stations).
// Corrige B1 (« Aucune station trouvée ») : sans station liée au gérant, /me renvoie une liste vide.
async function seedDefaultStation(c, { clientId, name, ownerId }) {
  const { rows: [s] } = await c.query('INSERT INTO stations(name, client_id) VALUES ($1,$2) RETURNING id, name', [name, clientId]);
  await c.query("INSERT INTO cash_registers(station_id, name) VALUES ($1, 'Caisse principale')", [s.id]);
  await c.query(`INSERT INTO payment_methods(station_id, code, label, kind) VALUES ($1,'especes','Espèces','especes'),($1,'mobile_money','Mobile Money','mobile_money'),($1,'orange_money','Orange Money','mobile_money'),($1,'wave','Wave','mobile_money'),($1,'carte','Carte bancaire','carte'),($1,'banque','Virement / banque','banque'),($1,'credit','Crédit client','credit'),($1,'autre','Autre','autre')`, [s.id]);
  await c.query("INSERT INTO settings(station_id, key, value) VALUES ($1, 'tolerance_fuel_liters', '5') ON CONFLICT DO NOTHING", [s.id]);
  if (ownerId) await c.query('INSERT INTO user_stations(user_id, station_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ownerId, s.id]);
  return s;
}

r.post('/admin/clients', needPrincipal, body(z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(40).optional().nullable(),
  contact_email: z.string().optional().nullable(),
  contact_phone: z.string().optional().nullable(),
  manager_name: z.string().max(120).optional().nullable(),
  owner_user_id: z.number().int().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Licence
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  duration_value: z.number().int().positive().optional().nullable(),
  duration_unit: z.enum(['day','month','year','indefinite','custom']).optional(),
  is_indefinite: z.boolean().optional(),
  // Limites & modules
  can_create_station: z.boolean().optional(),
  max_stations: z.number().int().positive().optional().nullable(),
  can_manage_users: z.boolean().optional(),
  max_users: z.number().int().positive().optional().nullable(),
  features: z.record(z.any()).optional(),
  contract_type: z.string().max(60).optional(),
  invoice_amount: z.number().min(0).max(1e12).optional().nullable(),
  generate_invoice: z.boolean().optional().default(true),
  mark_invoice_paid: z.boolean().optional().default(false),
  // Compte administrateur local obligatoire : ne pas créer un client sans compte de gestion.
  owner_login: z.string().trim().min(3).max(60),
  owner_password: z.string().min(8).max(120)
})), wrap(async (req, res) => {
  const b = req.body;
  const bcrypt = require('bcryptjs');
  const startsAt = b.start_date ? new Date(b.start_date + 'T00:00:00.000Z') : new Date();
  const indefinite = b.is_indefinite || b.duration_unit === 'indefinite' || (!b.duration_unit && !b.duration_value);
  const unit = indefinite ? 'indefinite' : (b.duration_unit || 'month');
  const value = indefinite ? null : (b.duration_value || 1);
  const expiresAt = indefinite ? null : computeExpiry(startsAt, value, unit);
  const features = mergeFeatures(b.features);

  const out = await tx(async c => {
    const { rows: [cl] } = await c.query(
      `INSERT INTO clients(code, name, contact_email, contact_phone, manager_name, owner_user_id, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name`,
      [b.code || null, b.name, b.contact_email || null, b.contact_phone || null,
       b.manager_name || null, b.owner_user_id || null, b.notes || null, req.user.id]
    );
    let ownerId = b.owner_user_id || null;
    if (b.owner_login && b.owner_password) {
      const { rows: [role] } = await c.query("SELECT id FROM roles WHERE code = 'ADMIN'");
      if (!role) throw new HttpError(500, 'Rôle ADMIN (administrateur local) introuvable');
      // CORR-029 : le compte ADMIN créé ici suit la même politique de mot de passe que les autres comptes
      { const pwErr = require('./password_policy').checkPassword(b.owner_password, { role: 'ADMIN', isGlobal: false, login: b.owner_login }); if (pwErr) throw new HttpError(400, pwErr); }
      const hash = await bcrypt.hash(b.owner_password, 12);
      const { rows: [ou] } = await c.query(
        `INSERT INTO users(login, password_hash, role_id, is_global, client_id)
         VALUES ($1,$2,$3,FALSE,$4) RETURNING id`,
        [b.owner_login.trim(), hash, role.id, cl.id]
      );
      ownerId = ou.id;
      await c.query('UPDATE clients SET owner_user_id = $2 WHERE id = $1', [cl.id, ownerId]);
    } else if (ownerId) {
      await c.query('UPDATE users SET client_id = $2 WHERE id = $1', [ownerId, cl.id]);
    }
    if (!ownerId) throw new HttpError(400, 'La création du client exige un compte administrateur local.');
    // Station par défaut obligatoire, liée à l’administrateur local (création transactionnelle : tout ou rien)
    const st = await seedDefaultStation(c, { clientId: cl.id, name: b.name, ownerId });
const { rows: [ct] } = await c.query(
  `INSERT INTO client_contracts(
     client_id, contract_type, start_date, end_date, status,
     can_create_station, max_stations, can_manage_users, max_users, features, updated_by,
     duration_value, duration_unit, starts_at, expires_at, is_indefinite, contract_snapshot
   ) VALUES (
     $1, $2, $3::date, $4::date, 'actif',
     $5, $6, $7, $8, $9::jsonb, $10,
     $11, $12, $13, $14, $15,
     jsonb_build_object(
       'contract_type', $2::text,
'start_date', to_jsonb($3::date),
'end_date', to_jsonb($4::date),
       'status', 'actif',
       'can_create_station', $5::boolean,
       'max_stations', $6::integer,
       'can_manage_users', $7::boolean,
       'max_users', $8::integer,
       'features', $9::jsonb
     )
   ) RETURNING id`,
  [
    cl.id, b.contract_type || 'standard',
    startsAt.toISOString().slice(0, 10),
    expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
    b.can_create_station ?? false,
    b.max_stations !== undefined ? b.max_stations : 1,
    b.can_manage_users ?? true,
    b.max_users !== undefined ? b.max_users : 5,
    JSON.stringify(features), req.user.id,
    value, unit, startsAt.toISOString(),
    expiresAt ? expiresAt.toISOString() : null, indefinite
  ]
);
    await recordLicenseHistory(c, {
      clientId: cl.id, contractId: ct.id, operation: 'creation',
      newStatus: indefinite ? 'INDEFINIE' : 'ACTIVE',
      newStartsAt: startsAt.toISOString(), newExpiresAt: expiresAt ? expiresAt.toISOString() : null,
      durationValue: value, durationUnit: unit, isIndefinite: indefinite,
      note: 'Création client + licence', performedBy: req.user.id
    });
    await audit(c, req, 'contrats', `Client créé : ${cl.name}`, 'clients', cl.id, null, {
      name: b.name, duration_unit: unit, duration_value: value, is_indefinite: indefinite
    });
    const inv = await maybeInvoiceLicense(c, req, {
      clientId: cl.id,
      amount: b.invoice_amount,
      generate: b.generate_invoice !== false,
      markPaid: !!b.mark_invoice_paid,
      periodStart: startsAt.toISOString().slice(0, 10),
      periodEnd: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
      kind: 'licence',
      label: 'Mise en service / licence — ' + cl.name,
      note: 'Création client',
      operation: 'creation'
    });
    return { id: cl.id, name: cl.name, owner_user_id: ownerId, contract_id: ct.id, station_id: st.id, invoice: inv };
  });
  const full = await loadContract(out.id);
  res.status(201).json({ ...out, license: full });
}));

r.get('/admin/clients/:id/contract', needPrincipal, wrap(async (req, res) => {
  res.json(await loadContract(+req.params.id));
}));

const contractBody = z.object({
  contract_type: z.string().min(1).max(60).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['actif', 'expire', 'suspendu']).optional(),
  can_create_station: z.boolean().optional(),
  max_stations: z.number().int().positive().optional().nullable(),
  can_manage_users: z.boolean().optional(),
  max_users: z.number().int().positive().optional().nullable(),
  features: z.record(z.any()).optional(),
  forced_signature: z.string().max(200).optional().nullable(),
  notes: z.string().optional().nullable()
});

r.put('/admin/clients/:id/contract', needPrincipal, body(contractBody), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query('SELECT * FROM client_contracts WHERE client_id = $1', [clientId]);
    if (!old) throw new HttpError(404, 'Contrat introuvable — créez d\'abord le client');
    const features = b.features != null ? mergeFeatures({ ...mergeFeatures(old.features), ...b.features }) : old.features;
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET
         contract_type = COALESCE($2, contract_type),
         start_date = COALESCE($3::date, start_date),
         end_date = CASE WHEN $4::text = '__CLEAR__' THEN NULL WHEN $5::date IS NOT NULL THEN $5::date ELSE end_date END,
         status = COALESCE($6, status),
         can_create_station = COALESCE($7, can_create_station),
         max_stations = CASE WHEN $8::text = 'null' THEN NULL WHEN $9::int IS NOT NULL THEN $9 ELSE max_stations END,
         can_manage_users = COALESCE($10, can_manage_users),
         max_users = CASE WHEN $11::text = 'null' THEN NULL WHEN $12::int IS NOT NULL THEN $12 ELSE max_users END,
         features = $13::jsonb,
         forced_signature = COALESCE($14, forced_signature),
         notes = COALESCE($15, notes),
         updated_at = now(), updated_by = $16
       WHERE client_id = $1 RETURNING *`,
      [
        clientId,
        b.contract_type ?? null,
        b.start_date ?? null,
        b.end_date === null ? '__CLEAR__' : null,
        b.end_date ?? null,
        b.status ?? null,
        b.can_create_station ?? null,
        b.max_stations === null ? 'null' : null,
        b.max_stations ?? null,
        b.can_manage_users ?? null,
        b.max_users === null ? 'null' : null,
        b.max_users ?? null,
        JSON.stringify(features),
        b.forced_signature !== undefined ? b.forced_signature : null,
        b.notes ?? null,
        req.user.id
      ]
    );
    await c.query(
      `UPDATE client_contracts SET contract_snapshot = jsonb_build_object(
        'contract_type', contract_type, 'start_date', start_date, 'end_date', end_date,
        'status', status, 'can_create_station', can_create_station, 'max_stations', max_stations,
        'can_manage_users', can_manage_users, 'max_users', max_users, 'features', features
      ) WHERE client_id = $1`, [clientId]
    );
    await audit(c, req, 'contrats', `Contrat client #${clientId} modifié`, 'client_contracts', n.id, {
      can_create_station: old.can_create_station, max_stations: old.max_stations,
      can_manage_users: old.can_manage_users, max_users: old.max_users, features: old.features
    }, {
      can_create_station: n.can_create_station, max_stations: n.max_stations,
      can_manage_users: n.can_manage_users, max_users: n.max_users, features: n.features
    });
    return n;
  });
  res.json(await loadContract(clientId));
}));

r.post('/admin/clients/:id/assign-station', needPrincipal, body(z.object({
  station_id: z.number().int()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const contract = await loadContract(clientId);
  // Si la station n'est pas déjà à ce client, compter +1
  const { rows: [st] } = await pool.query('SELECT id, client_id, name FROM stations WHERE id = $1', [req.body.station_id]);
  if (!st) throw new HttpError(404, 'Station introuvable');
  if (st.client_id !== clientId) {
    const used = await countClientStations(clientId);
    if (contract.max_stations != null && used >= contract.max_stations) {
      throw new HttpError(403, `Limite de stations du contrat atteinte (${used}/${contract.max_stations}). Augmentez max_stations avant d'assigner.`);
    }
  }
  await pool.query('UPDATE stations SET client_id = $2 WHERE id = $1', [req.body.station_id, clientId]);
  await audit(pool, req, 'contrats', `Station ${req.body.station_id} → client ${clientId}`, 'stations', req.body.station_id);
  const quotas = (await loadContract(clientId)).quotas;
  res.json({ ok: true, quotas });
}));

r.post('/admin/clients/:id/assign-user', needPrincipal, body(z.object({
  user_id: z.number().int(),
  as_owner: z.boolean().optional()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const contract = await loadContract(clientId);
  const { rows: [u] } = await pool.query('SELECT id, client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.body.user_id]);
  if (!u) throw new HttpError(404, 'Utilisateur introuvable');
  if (u.client_id !== clientId) {
    const used = await countClientUsers(clientId);
    if (contract.max_users != null && used >= contract.max_users) {
      throw new HttpError(403, `Limite d'utilisateurs du contrat atteinte (${used}/${contract.max_users}). Augmentez max_users avant d'assigner.`);
    }
  }
  await tx(async c => {
    await c.query('UPDATE users SET client_id = $2 WHERE id = $1', [req.body.user_id, clientId]);
    if (req.body.as_owner) {
      await c.query('UPDATE clients SET owner_user_id = $2 WHERE id = $1', [clientId, req.body.user_id]);
    }
    await audit(c, req, 'contrats', `Utilisateur ${req.body.user_id} → client ${clientId}`, 'users', req.body.user_id);
  });
  const quotas = (await loadContract(clientId)).quotas;
  res.json({ ok: true, quotas });
}));

// ---------- Quotas stations / utilisateurs ----------
r.get('/me/quotas', wrap(async (req, res) => {
  const c = await loadContractForUser(req.user.id, req.user.is_global);
  if (c.unrestricted) {
    return res.json({
      unrestricted: true,
      is_principal: !!c.is_principal,
      quotas: {
        stations: { used: null, max: null, unlimited: true, can_create: true },
        users: { used: null, max: null, unlimited: true, can_create: true }
      },
      note: c.is_principal ? 'Administrateur Principal — aucune limite contractuelle.' : 'Compte hors contrat client.'
    });
  }
  res.json({
    unrestricted: false,
    client_id: c.client_id,
    client_name: c.client_name,
    contract_status: c.contract_status,
    suspended: c.suspended,
    can_create_station: c.can_create_station,
    can_manage_users: c.can_manage_users,
    quotas: c.quotas,
    warnings: [
      ...(c.quotas.stations.at_limit ? ['Limite de stations atteinte.'] : []),
      ...(c.quotas.users.at_limit ? ['Limite d\'utilisateurs atteinte.'] : []),
      ...(c.suspended ? ['Contrat suspendu ou expiré.'] : [])
    ]
  });
}));

r.get('/admin/clients/:id/quotas', needPrincipal, wrap(async (req, res) => {
  const c = await loadContract(+req.params.id);
  res.json({
    client_id: c.client_id,
    client_name: c.client_name,
    contract_status: c.contract_status,
    can_create_station: c.can_create_station,
    can_manage_users: c.can_manage_users,
    quotas: c.quotas,
    note: 'Réservé Administrateur Principal.'
  });
}));

r.put('/admin/clients/:id/limits', needPrincipal, body(z.object({
  can_create_station: z.boolean().optional(),
  max_stations: z.number().int().positive().nullable().optional(),
  can_manage_users: z.boolean().optional(),
  max_users: z.number().int().positive().nullable().optional()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(
      'SELECT can_create_station, max_stations, can_manage_users, max_users FROM client_contracts WHERE client_id = $1',
      [clientId]
    );
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    const usedS = await countClientStations(clientId);
    const usedU = await countClientUsers(clientId);
    const newMaxS = b.max_stations !== undefined ? b.max_stations : old.max_stations;
    const newMaxU = b.max_users !== undefined ? b.max_users : old.max_users;
    if (newMaxS != null && newMaxS < usedS) {
      throw new HttpError(409, `Impossible : ${usedS} station(s) déjà liées. max_stations doit être ≥ ${usedS} (ou illimité).`);
    }
    if (newMaxU != null && newMaxU < usedU) {
      throw new HttpError(409, `Impossible : ${usedU} utilisateur(s) déjà liés. max_users doit être ≥ ${usedU} (ou illimité).`);
    }
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET
         can_create_station = COALESCE($2, can_create_station),
         max_stations = CASE WHEN $3::text = 'SET_NULL' THEN NULL WHEN $4::int IS NOT NULL THEN $4 ELSE max_stations END,
         can_manage_users = COALESCE($5, can_manage_users),
         max_users = CASE WHEN $6::text = 'SET_NULL' THEN NULL WHEN $7::int IS NOT NULL THEN $7 ELSE max_users END,
         updated_at = now(), updated_by = $8
       WHERE client_id = $1 RETURNING can_create_station, max_stations, can_manage_users, max_users`,
      [
        clientId,
        b.can_create_station ?? null,
        b.max_stations === null ? 'SET_NULL' : null,
        b.max_stations ?? null,
        b.can_manage_users ?? null,
        b.max_users === null ? 'SET_NULL' : null,
        b.max_users ?? null,
        req.user.id
      ]
    );
    await audit(c, req, 'contrats', `Limites client #${clientId}`, 'client_contracts', clientId, old, n);
    return n;
  });
  const full = await loadContract(clientId);
  res.json({ ok: true, limits: out, quotas: full.quotas });
}));
// ---------- Actions licence (Administrateur Principal) ----------


async function maybeInvoiceLicense(c, req, {
  clientId, amount, generate, markPaid, periodStart, periodEnd, kind, label, note, operation
}) {
  const { createLicenseInvoice, resolveDefaultLicenseAmount } = require('./platform');
  let amt = amount != null && amount !== '' ? Number(amount) : null;
  if (!(amt > 0) && generate !== false) {
    amt = await resolveDefaultLicenseAmount();
  }
  if (generate === false || !(amt > 0)) return null;
  const inv = await createLicenseInvoice(c, {
    clientId,
    amount: amt,
    kind: kind || 'licence',
    label: label || ('Licence — client #' + clientId),
    periodStart: periodStart || null,
    periodEnd: periodEnd || null,
    reference: operation ? (operation + '-' + clientId + '-' + Date.now()) : null,
    notes: note || null,
    userId: req.user && req.user.id,
    markPaid: !!markPaid
  });
  if (inv) {
    await audit(c, req, 'platform', 'Facture plateforme auto (' + (operation || 'licence') + ')', 'platform_invoices', inv.id, null, {
      client_id: clientId, amount: amt, mark_paid: !!markPaid
    });
  }
  return inv;
}

const durationBody = z.object({
  duration_value: z.number().int().positive().optional().nullable(),
  duration_unit: z.enum(['day','month','year','indefinite','custom']).optional(),
  is_indefinite: z.boolean().optional(),
  start_from: z.enum(['now','expiry','custom']).optional(), // now | from current expiry | custom date
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(500).optional().nullable(),
  // Facture plateforme auto
  invoice_amount: z.number().min(0).max(1e12).optional().nullable(),
  generate_invoice: z.boolean().optional().default(true),
  mark_invoice_paid: z.boolean().optional().default(false)
});

/** Renouvellement : nouvelle période (depuis maintenant ou depuis l'ancienne échéance) */
r.post('/admin/clients/:id/license/renew', needPrincipal, body(durationBody), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const b = req.body;
  const indefinite = b.is_indefinite || b.duration_unit === 'indefinite';
  const unit = indefinite ? 'indefinite' : (b.duration_unit || 'month');
  const value = indefinite ? null : (b.duration_value || 1);

  const out = await tx(async c => {
    const { rows: [old] } = await c.query(
      `SELECT id, status, starts_at, expires_at, end_date, is_indefinite FROM client_contracts WHERE client_id = $1 FOR UPDATE`,
      [clientId]
    );
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    let startsAt = new Date();
    if (b.start_from === 'expiry' && old.expires_at && new Date(old.expires_at) > startsAt) {
      startsAt = new Date(old.expires_at);
    }
    if (b.start_date) startsAt = new Date(b.start_date + 'T00:00:00.000Z');
    const expiresAt = indefinite ? null : computeExpiry(startsAt, value, unit);
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET
         status = 'actif', is_indefinite = $2,
         duration_value = $3, duration_unit = $4,
         starts_at = $5, expires_at = $6,
         start_date = $7, end_date = $8,
         last_renewed_at = now(), last_renewed_by = $9,
         suspended_at = NULL, suspended_by = NULL, suspend_reason = NULL,
         updated_at = now(), updated_by = $9
       WHERE client_id = $1 RETURNING id, status, starts_at, expires_at, is_indefinite`,
      [
        clientId, indefinite, value, unit,
        startsAt.toISOString(), expiresAt ? expiresAt.toISOString() : null,
        startsAt.toISOString().slice(0, 10), expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
        req.user.id
      ]
    );
    await c.query(`UPDATE clients SET status = 'actif', deactivated_at = NULL WHERE id = $1`, [clientId]);
    await recordLicenseHistory(c, {
      clientId, contractId: old.id, operation: 'renewal',
      oldStatus: old.status, newStatus: indefinite ? 'INDEFINIE' : 'ACTIVE',
      oldStartsAt: old.starts_at, oldExpiresAt: old.expires_at,
      newStartsAt: n.starts_at, newExpiresAt: n.expires_at,
      durationValue: value, durationUnit: unit, isIndefinite: indefinite,
      note: b.note || 'Renouvellement', performedBy: req.user.id
    });
    await audit(c, req, 'licences', `Renouvellement client #${clientId}`, 'client_contracts', clientId, old, n);
    const inv = await maybeInvoiceLicense(c, req, {
      clientId,
      amount: b.invoice_amount,
      generate: b.generate_invoice !== false,
      markPaid: !!b.mark_invoice_paid,
      periodStart: n.starts_at ? String(n.starts_at).slice(0, 10) : null,
      periodEnd: n.expires_at ? String(n.expires_at).slice(0, 10) : null,
      kind: 'licence',
      label: 'Renouvellement licence — client #' + clientId,
      note: b.note || 'Renouvellement automatique',
      operation: 'renewal'
    });
    return { contract: n, invoice: inv };
  });
  res.json({
    ok: true,
    contract: out.contract || out,
    invoice: out.invoice || null,
    license: await loadContract(clientId)
  });
}));

/** Prolongation : ajoute de la durée sans perdre les jours restants */
r.post('/admin/clients/:id/license/extend', needPrincipal, body(durationBody), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const b = req.body;
  if (b.is_indefinite || b.duration_unit === 'indefinite') {
    // Passer en indéfini
    return res.json(await (async () => {
      const out = await tx(async c => {
        const { rows: [old] } = await c.query(`SELECT * FROM client_contracts WHERE client_id = $1 FOR UPDATE`, [clientId]);
        if (!old) throw new HttpError(404, 'Contrat introuvable');
        const { rows: [n] } = await c.query(
          `UPDATE client_contracts SET is_indefinite = TRUE, expires_at = NULL, end_date = NULL,
             duration_unit = 'indefinite', duration_value = NULL, status = 'actif',
             updated_at = now(), updated_by = $2 WHERE client_id = $1 RETURNING *`,
          [clientId, req.user.id]
        );
        await recordLicenseHistory(c, {
          clientId, contractId: old.id, operation: 'extension',
          oldStatus: old.status, newStatus: 'INDEFINIE',
          oldExpiresAt: old.expires_at, newExpiresAt: null, isIndefinite: true,
          note: b.note || 'Passage en licence indéfinie', performedBy: req.user.id
        });
        return n;
      });
      return { ok: true, contract: out, license: await loadContract(clientId) };
    })());
  }
  const unit = b.duration_unit || 'day';
  const value = b.duration_value || 30;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(
      `SELECT id, status, starts_at, expires_at, end_date, is_indefinite FROM client_contracts WHERE client_id = $1 FOR UPDATE`,
      [clientId]
    );
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    const base = old.expires_at && new Date(old.expires_at) > new Date()
      ? new Date(old.expires_at)
      : new Date();
    // computeExpiry adds a full period ending 23:59:59 — for extension we add relative days/months from base
    const expiresAt = computeExpiry(base, value, unit);
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET
         status = 'actif', is_indefinite = FALSE,
         expires_at = $2, end_date = $3,
         duration_value = COALESCE(duration_value, 0) + $4,
         duration_unit = COALESCE(duration_unit, $5),
         updated_at = now(), updated_by = $6
       WHERE client_id = $1 RETURNING id, status, starts_at, expires_at, is_indefinite`,
      [clientId, expiresAt.toISOString(), expiresAt.toISOString().slice(0, 10), value, unit, req.user.id]
    );
    await c.query(`UPDATE clients SET status = 'actif' WHERE id = $1 AND status = 'suspendu'`, [clientId]);
    await recordLicenseHistory(c, {
      clientId, contractId: old.id, operation: 'extension',
      oldStatus: old.status, newStatus: 'ACTIVE',
      oldExpiresAt: old.expires_at, newExpiresAt: n.expires_at,
      durationValue: value, durationUnit: unit, isIndefinite: false,
      note: b.note || `Prolongation +${value} ${unit}`, performedBy: req.user.id
    });
    await audit(c, req, 'licences', `Prolongation client #${clientId}`, 'client_contracts', clientId, old, n);
    const inv = await maybeInvoiceLicense(c, req, {
      clientId,
      amount: b.invoice_amount,
      generate: b.generate_invoice !== false,
      markPaid: !!b.mark_invoice_paid,
      periodStart: null,
      periodEnd: n.expires_at ? String(n.expires_at).slice(0, 10) : null,
      kind: 'abonnement',
      label: 'Prolongation licence — client #' + clientId,
      note: b.note || 'Prolongation automatique',
      operation: 'extension'
    });
    return { contract: n, invoice: inv };
  });
  res.json({
    ok: true,
    contract: out.contract || out,
    invoice: out.invoice || null,
    license: await loadContract(clientId)
  });
}));

/** Correction de l'échéance : le Super Admin fixe une date précise (avant ou après l'actuelle)
 *  ou réduit l'échéance d'une durée. Aucune logique « augmentation seulement ». */
r.post('/admin/clients/:id/license/set-expiry', needPrincipal, body(z.object({
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reduce_unit: z.enum(['day', 'month', 'year']).optional(),
  reduce_value: z.number().int().positive().max(3650).optional(),
  note: z.string().max(500).optional().nullable()
}).refine(b => !!b.expires_at !== !!(b.reduce_unit && b.reduce_value), {
  message: 'Indiquez soit une date de fin précise, soit une durée à retrancher'
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(
      `SELECT id, status, starts_at, start_date, expires_at, end_date, is_indefinite, duration_value, duration_unit
         FROM client_contracts WHERE client_id = $1 FOR UPDATE`, [clientId]);
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    let next;
    if (b.expires_at) {
      next = new Date(b.expires_at + 'T23:59:59.000Z');
      if (Number.isNaN(next.getTime()) || next.toISOString().slice(0, 10) !== b.expires_at) throw new HttpError(400, 'Date de fin invalide');
    } else {
      if (old.is_indefinite || !old.expires_at) throw new HttpError(409, 'La licence est indéfinie : indiquez une date de fin précise.');
      next = new Date(old.expires_at);
      const v = -b.reduce_value;
      if (b.reduce_unit === 'day') next.setUTCDate(next.getUTCDate() + v);
      else {
        // mois / années : on garde le jour, ramené au dernier jour du mois si besoin (31 mars - 1 mois = 28 ou 29 février)
        const day = next.getUTCDate();
        next.setUTCDate(1);
        if (b.reduce_unit === 'month') next.setUTCMonth(next.getUTCMonth() + v);
        else next.setUTCFullYear(next.getUTCFullYear() + v);
        const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
        next.setUTCDate(Math.min(day, last));
      }
    }
    const start = old.starts_at ? new Date(old.starts_at) : (old.start_date ? new Date(old.start_date + 'T00:00:00Z') : null);
    if (start && next.getTime() < start.getTime()) throw new HttpError(400, 'La date de fin ne peut pas précéder le début du contrat');
    const wasIndefinite = !!old.is_indefinite || !old.expires_at;
    const shorter = !wasIndefinite && next.getTime() < new Date(old.expires_at).getTime();
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET is_indefinite = FALSE, expires_at = $2, end_date = $3,
         status = CASE WHEN status = 'expire' AND $2::timestamptz > now()
                        AND suspended_at IS NULL
                        AND COALESCE((SELECT status FROM clients WHERE id = $1), 'actif') <> 'suspendu'
                       THEN 'actif' ELSE status END,
         updated_at = now(), updated_by = $4
       WHERE client_id = $1 RETURNING id, status, starts_at, expires_at, is_indefinite`,
      [clientId, next.toISOString(), next.toISOString().slice(0, 10), req.user.id]);
    await recordLicenseHistory(c, {
      clientId, contractId: old.id, operation: shorter ? 'reduction' : 'modification',
      oldStatus: old.status, newStatus: licenseStatusOf({ ...n, contract_status: n.status, end_date: null }),
      oldStartsAt: old.starts_at, oldExpiresAt: old.expires_at, newStartsAt: n.starts_at, newExpiresAt: n.expires_at,
      durationValue: b.reduce_value || null, durationUnit: b.reduce_unit || null, isIndefinite: false,
      note: b.note || (shorter ? 'Réduction de l’échéance' : 'Modification de l’échéance'), performedBy: req.user.id
    });
    await audit(c, req, 'licences', `Échéance client #${clientId}`, 'client_contracts', clientId, old, n);
    return n;
  });
  res.json({ ok: true, contract: out, license: await loadContract(clientId) });
}));

/** Suspension manuelle */
r.post('/admin/clients/:id/license/suspend', needPrincipal, body(z.object({
  reason: z.string().max(500).optional().nullable()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(`SELECT id, status, expires_at FROM client_contracts WHERE client_id = $1 FOR UPDATE`, [clientId]);
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET status = 'suspendu', suspended_at = now(), suspended_by = $2,
         suspend_reason = $3, updated_at = now(), updated_by = $2
       WHERE client_id = $1 RETURNING *`,
      [clientId, req.user.id, req.body.reason || null]
    );
    await c.query(`UPDATE clients SET status = 'suspendu' WHERE id = $1`, [clientId]);
    await recordLicenseHistory(c, {
      clientId, contractId: old.id, operation: 'suspension',
      oldStatus: old.status, newStatus: 'SUSPENDUE',
      oldExpiresAt: old.expires_at, newExpiresAt: old.expires_at,
      note: req.body.reason || 'Suspension manuelle', performedBy: req.user.id
    });
    await audit(c, req, 'licences', `Suspension client #${clientId}`, 'client_contracts', clientId, old, n);
    return n;
  });
  res.json({ ok: true, contract: out, license: await loadContract(clientId) });
}));

/** Résiliation : le Superadmin met fin au contrat du compte client quand il le décide. Les données sont conservées intégralement. */
r.post('/admin/clients/:id/license/terminate', needPrincipal, body(z.object({
  reason: z.string().max(500).optional().nullable()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(`SELECT * FROM client_contracts WHERE client_id = $1 FOR UPDATE`, [clientId]);
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    const reason = req.body.reason || 'Contrat résilié par le Superadmin';
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET status = 'expire', expires_at = now(), is_indefinite = FALSE,
         suspended_at = now(), suspended_by = $2, suspend_reason = $3, updated_at = now(), updated_by = $2
       WHERE client_id = $1 RETURNING *`, [clientId, req.user.id, reason]);
    await c.query(`UPDATE clients SET status = 'suspendu', deactivated_at = COALESCE(deactivated_at, now()) WHERE id = $1`, [clientId]);
    await c.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id IN (SELECT id FROM users WHERE client_id = $1) AND revoked_at IS NULL', [clientId]);
    await recordLicenseHistory(c, {
      clientId, contractId: old.id, operation: 'expiration',
      oldStatus: old.status, newStatus: 'EXPIREE',
      oldExpiresAt: old.expires_at, newExpiresAt: n.expires_at,
      note: 'Résiliation : ' + reason, performedBy: req.user.id
    });
    await audit(c, req, 'licences', `Résiliation client #${clientId}`, 'client_contracts', clientId, old, n);
    return n;
  });
  res.json({ ok: true, contract: out, license: await loadContract(clientId) });
}));

/** Déblocage / réactivation : le Superadmin peut rouvrir le compte client à tout moment (suspendu, résilié ou expiré).
 *  Si la date de fin est dépassée, il choisit la nouvelle date de fin (ou « durée indéterminée ») au moment du déblocage. */
r.post('/admin/clients/:id/license/reactivate', needPrincipal, body(z.object({
  note: z.string().max(500).optional().nullable(),
  expires_at: z.string().max(40).optional().nullable(),
  indefinite: z.boolean().optional()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(`SELECT * FROM client_contracts WHERE client_id = $1 FOR UPDATE`, [clientId]);
    if (!old) throw new HttpError(404, 'Contrat introuvable');
    const expired = !old.is_indefinite && old.expires_at && new Date(old.expires_at) < new Date();
    let nextExpires = old.expires_at, nextIndefinite = old.is_indefinite;
    if (req.body.indefinite) { nextIndefinite = true; nextExpires = null; }
    else if (req.body.expires_at) {
      const d = new Date(req.body.expires_at);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date de fin invalide');
      if (d <= new Date()) throw new HttpError(400, 'La nouvelle date de fin doit être dans le futur');
      nextExpires = d.toISOString(); nextIndefinite = false;
    } else if (expired) {
      throw new HttpError(409, 'Le contrat est arrivé à échéance ou a été résilié : indiquez une nouvelle date de fin (ou « durée indéterminée ») pour le débloquer.');
    }
    const { rows: [n] } = await c.query(
      `UPDATE client_contracts SET status = 'actif', expires_at = $2, is_indefinite = $3, access_revoked = FALSE,
         suspended_at = NULL, suspended_by = NULL, suspend_reason = NULL, updated_at = now(), updated_by = $4
       WHERE client_id = $1 RETURNING *`, [clientId, nextExpires, !!nextIndefinite, req.user.id]);
    await c.query(`UPDATE clients SET status = 'actif', deactivated_at = NULL WHERE id = $1`, [clientId]);
    await recordLicenseHistory(c, {
      clientId, contractId: old.id, operation: 'reactivation',
      oldStatus: old.status, newStatus: 'ACTIVE',
      oldExpiresAt: old.expires_at, newExpiresAt: n.expires_at,
      note: req.body.note || 'Déblocage par le Superadmin', performedBy: req.user.id
    });
    await audit(c, req, 'licences', `Déblocage client #${clientId}`, 'client_contracts', clientId, old, n);
    return n;
  });
  res.json({ ok: true, contract: out, license: await loadContract(clientId) });
}));

/** Comptes d'un client visibles du Super Admin — informations administratives seulement.
 * Seuls les administrateurs locaux (ADMIN) sont exposés : gérant, comptable, caissier, pompiste… relèvent de l'administrateur local. */
r.get('/admin/clients/:id/users', needPrincipal, wrap(async (req, res) => {
  const clientId = Number(req.params.id);
  if (!Number.isSafeInteger(clientId) || clientId < 1) throw new HttpError(400, 'Identifiant client invalide');
  const { rows: [client] } = await pool.query('SELECT id FROM clients WHERE id = $1', [clientId]);
  if (!client) throw new HttpError(404, 'Client introuvable');
  const { rows } = await pool.query(
    `SELECT u.id, u.login, u.full_name, u.job_title, u.active, u.last_login_at, u.created_at,
            r.code AS role, r.label AS role_label,
            EXISTS (SELECT 1 FROM user_sessions ss WHERE ss.user_id=u.id AND ss.revoked_at IS NULL AND ss.expires_at > now()) AS session_active,
            (SELECT COUNT(*)::int FROM user_stations us WHERE us.user_id=u.id) AS stations_count
     FROM users u
     JOIN roles r ON r.id=u.role_id
     WHERE u.client_id=$1 AND u.deleted_at IS NULL AND r.code = 'ADMIN'
     ORDER BY u.active DESC, u.login`, [clientId]
  );
  res.set('Cache-Control', 'no-store').json(rows);
}));

/** Historique licences d'un client */
r.get('/admin/clients/:id/license/history', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.*, u.login AS admin_login
     FROM license_history h
     LEFT JOIN users u ON u.id = h.performed_by
     WHERE h.client_id = $1
     ORDER BY h.performed_at DESC LIMIT 100`,
    [+req.params.id]
  ).catch(swallow('contracts:1234', { rows: [] }));
  res.json(rows);
}));

/** Réinitialisation du mot de passe de l'administrateur LOCAL d'un client — Super Admin uniquement.
 * Limites volontaires : seul le compte de rôle ADMIN rattaché à ce client est concerné (jamais un autre rôle,
 * jamais un compte global). Le mot de passe temporaire est affiché une seule fois et n'est jamais journalisé ;
 * toutes les sessions du compte sont révoquées et le verrouillage de connexion est levé.
 */
r.post('/admin/clients/:id/users/:userId/reset-password', needPrincipal, body(z.object({
  reason: z.string().trim().min(3).max(500),
  superadmin_password: z.string().min(1)
})), wrap(async (req, res) => {
  const bcrypt = require('bcryptjs'), crypto = require('crypto');
  const clientId = Number(req.params.id), userId = Number(req.params.userId);
  if (!Number.isSafeInteger(clientId) || clientId < 1) throw new HttpError(400, 'Identifiant client invalide');
  if (!Number.isSafeInteger(userId) || userId < 1) throw new HttpError(400, 'Identifiant utilisateur invalide');
  // Confirmation par le mot de passe du Super Admin connecté (protège contre une session laissée ouverte).
  const { rows: [sa] } = await pool.query('SELECT password_hash, is_global, active FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
  if (!sa || !sa.is_global || !sa.active || !(await bcrypt.compare(req.body.superadmin_password, sa.password_hash))) {
    throw new HttpError(403, 'Mot de passe Super Admin incorrect. Réinitialisation refusée.');
  }
  const out = await tx(async c => {
    const { rows: [cl] } = await c.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
    if (!cl) throw new HttpError(404, 'Client introuvable');
    const { rows: [u] } = await c.query(
      `SELECT u.id, u.login, u.is_global, u.active, u.client_id, r.code AS role
         FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND u.deleted_at IS NULL FOR UPDATE OF u`, [userId]);
    if (!u || Number(u.client_id) !== clientId) throw new HttpError(404, 'Compte introuvable pour ce client');
    if (u.is_global || u.role !== 'ADMIN') throw new HttpError(403, 'Seul le mot de passe de l’administrateur local du client peut être réinitialisé ici');
    if (!u.active) throw new HttpError(409, 'Ce compte est désactivé : réactivez-le avant de réinitialiser son mot de passe');
    const temporaryPassword = crypto.randomBytes(12).toString('hex');
    await c.query('UPDATE users SET password_hash = $2, failed_logins = 0, lockout_until = NULL WHERE id = $1',
      [u.id, await bcrypt.hash(temporaryPassword, 12)]);
    await c.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    await audit(c, req, 'utilisateurs', `Réinitialisation du mot de passe de l'administrateur local ${u.login} (client ${cl.name}) : ${req.body.reason}`,
      'users', u.id, { password_reset: false }, { password_reset: true, sessions_revoked: true, client_id: clientId });
    return { user_id: u.id, login: u.login, temporary_password: temporaryPassword, sessions_revoked: true };
  });
  res.set('Cache-Control', 'no-store').json(out);
}));

/** Administrateur local de SECOURS — Super Admin uniquement.
 * Crée un NOUVEAU compte ADMIN pour un client (compte perdu, départ de l'administrateur…). Aucun compte existant n'est promu :
 * gérant, comptable, caissier, pompiste… restent sous la seule autorité de l'administrateur local.
 * Mot de passe temporaire affiché une seule fois (jamais journalisé) ; quota max_users du contrat respecté ; motif + mot de passe Super Admin exigés.
 */
r.post('/admin/clients/:id/rescue-admin', needPrincipal, body(z.object({
  login: z.string().trim().min(3).max(60),
  full_name: z.string().trim().max(120).optional(),
  reason: z.string().trim().min(3).max(500),
  superadmin_password: z.string().min(1)
})), wrap(async (req, res) => {
  const bcrypt = require('bcryptjs'), crypto = require('crypto');
  const clientId = Number(req.params.id);
  if (!Number.isSafeInteger(clientId) || clientId < 1) throw new HttpError(400, 'Identifiant client invalide');
  const { rows: [sa] } = await pool.query('SELECT password_hash, is_global, active FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
  if (!sa || !sa.is_global || !sa.active || !(await bcrypt.compare(req.body.superadmin_password, sa.password_hash))) {
    throw new HttpError(403, 'Mot de passe Super Admin incorrect. Création refusée.');
  }
  const contract = await loadContract(clientId);
  const used = await countClientUsers(clientId);
  if (contract.max_users != null && used >= contract.max_users) {
    throw new HttpError(403, `Limite d'utilisateurs du contrat atteinte (${used}/${contract.max_users}). Augmentez max_users ou désactivez un compte avant de créer l'administrateur de secours.`);
  }
  const out = await tx(async c => {
    const { rows: [cl] } = await c.query('SELECT id, name, owner_user_id FROM clients WHERE id = $1 FOR UPDATE', [clientId]);
    if (!cl) throw new HttpError(404, 'Client introuvable');
    const { rows: [dup] } = await c.query('SELECT 1 FROM users WHERE lower(login) = lower($1) AND deleted_at IS NULL', [req.body.login]);
    if (dup) throw new HttpError(409, 'Cet identifiant existe déjà : choisissez-en un autre');
    const { rows: [role] } = await c.query("SELECT id FROM roles WHERE code = 'ADMIN'");
    if (!role) throw new HttpError(500, 'Rôle ADMIN (administrateur local) introuvable');
    const temporaryPassword = crypto.randomBytes(12).toString('hex');
    const { rows: [nu] } = await c.query(
      `INSERT INTO users(login, password_hash, role_id, is_global, client_id, full_name, job_title)
       VALUES ($1,$2,$3,FALSE,$4,$5,'Administrateur local') RETURNING id, login`,
      [req.body.login, await bcrypt.hash(temporaryPassword, 12), role.id, clientId, req.body.full_name || null]);
    await c.query(
      `INSERT INTO user_stations(user_id, station_id) SELECT $1, id FROM stations WHERE client_id = $2 AND active ON CONFLICT DO NOTHING`, [nu.id, clientId]);
    // Propriétaire du compte client : repris par le nouvel administrateur seulement si l'ancien n'est plus un compte actif.
    await c.query(
      `UPDATE clients SET owner_user_id = $2 WHERE id = $1 AND NOT EXISTS (
         SELECT 1 FROM users o WHERE o.id = clients.owner_user_id AND o.deleted_at IS NULL AND o.active)`, [clientId, nu.id]);
    await audit(c, req, 'utilisateurs', `Administrateur local de secours créé : ${nu.login} (client ${cl.name}) : ${req.body.reason}`,
      'users', nu.id, null, { login: nu.login, role: 'ADMIN', client_id: clientId, rescue: true });
    return { user_id: nu.id, login: nu.login, temporary_password: temporaryPassword };
  });
  res.status(201).set('Cache-Control', 'no-store').json(out);
}));

/** Mise à jour identité client (nom, contacts) — Super Admin uniquement */
r.patch('/admin/clients/:id', needPrincipal, body(z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().max(40).optional().nullable(),
  contact_email: z.string().max(200).optional().nullable(),
  contact_phone: z.string().max(60).optional().nullable(),
  manager_name: z.string().max(120).optional().nullable(),
  notes: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const b = req.body;
  const { rows: [old] } = await pool.query(
    'SELECT id, name, code, contact_email, contact_phone, manager_name, notes FROM clients WHERE id = $1',
    [clientId]
  );
  if (!old) throw new HttpError(404, 'Client introuvable');
  const name = b.name != null ? String(b.name).trim() : old.name;
  if (!name) throw new HttpError(400, 'Le nom du compte client est obligatoire');
  const { rows: [n] } = await pool.query(
    `UPDATE clients SET
       name = $2,
       code = COALESCE($3, code),
       contact_email = COALESCE($4, contact_email),
       contact_phone = COALESCE($5, contact_phone),
       manager_name = COALESCE($6, manager_name),
       notes = COALESCE($7, notes)
     WHERE id = $1
     RETURNING id, name, code, contact_email, contact_phone, manager_name, notes, status`,
    [
      clientId,
      name,
      b.code !== undefined ? b.code : null,
      b.contact_email !== undefined ? b.contact_email : null,
      b.contact_phone !== undefined ? b.contact_phone : null,
      b.manager_name !== undefined ? b.manager_name : null,
      b.notes !== undefined ? b.notes : null
    ]
  );
  await audit(pool, req, 'contrats', `Identité client #${clientId} modifiée`, 'clients', clientId, old, n);
  res.json({ ok: true, client: n, license: await loadContract(clientId) });
}));

/** Désactiver / réactiver le compte client (organisation) */
r.patch('/admin/clients/:id/status', needPrincipal, body(z.object({
  status: z.enum(['actif', 'suspendu', 'archive']),
  reason: z.string().max(500).optional().nullable()
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const { status, reason } = req.body;
  const { rows: [old] } = await pool.query('SELECT id, status FROM clients WHERE id = $1', [clientId]);
  if (!old) throw new HttpError(404, 'Client introuvable');
  await pool.query(
    `UPDATE clients SET status = $2, deactivated_at = CASE WHEN $2 = 'actif' THEN NULL ELSE COALESCE(deactivated_at, now()) END
     WHERE id = $1`, [clientId, status]
  );
  if (status === 'suspendu') {
    await pool.query(
      `UPDATE client_contracts SET status = 'suspendu', suspended_at = now(), suspended_by = $2, suspend_reason = $3
       WHERE client_id = $1 AND status = 'actif'`, [clientId, req.user.id, reason || null]
    );
  }
  await audit(pool, req, 'contrats', `Statut client #${clientId} → ${status}`, 'clients', clientId, old, { status, reason });
  res.json({ ok: true, license: await loadContract(clientId) });
}));

// Contrat du client courant (Gérant / utilisateur)
r.get('/me/contract', wrap(async (req, res) => {
  const c = await loadContractForUser(req.user.id, req.user.is_global);
  res.json(c);
}));
/* ================================================================== */
/*  Évolution admin comptes / licences (cahier des charges)            */
/*  — non destructif : routes additionnelles uniquement                */
/* ================================================================== */

/** Presets de durée proposés à l'UI (1j, 2j, 3j, 10j, 1m, 6m, 1an, indéfinie) */
r.get('/admin/licenses/duration-presets', needPrincipal, wrap(async (req, res) => {
  res.json([
    { label: '1 jour', duration_value: 1, duration_unit: 'day' },
    { label: '2 jours', duration_value: 2, duration_unit: 'day' },
    { label: '3 jours', duration_value: 3, duration_unit: 'day' },
    { label: '10 jours', duration_value: 10, duration_unit: 'day' },
    { label: '1 mois', duration_value: 1, duration_unit: 'month' },
    { label: '3 mois', duration_value: 3, duration_unit: 'month' },
    { label: '6 mois', duration_value: 6, duration_unit: 'month' },
    { label: '1 an', duration_value: 1, duration_unit: 'year' },
    { label: '2 ans', duration_value: 2, duration_unit: 'year' },
    { label: 'Indéfinie (sans expiration)', duration_value: null, duration_unit: 'indefinite', is_indefinite: true },
  ]);
}));

/** Seuils d'avertissement configurables (admin principal) */
r.get('/admin/licenses/warning-thresholds', needPrincipal, wrap(async (req, res) => {
  res.json({ thresholds: await getWarningThresholds() });
}));

r.put('/admin/licenses/warning-thresholds', needPrincipal, body(z.object({
  thresholds: z.array(z.number().int().positive()).min(1).max(10)
})), wrap(async (req, res) => {
  const sorted = [...new Set(req.body.thresholds)].sort((a, b) => b - a);
  const value = sorted.join(',');
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('license_warning_thresholds', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [value]
  );
  await audit(pool, req, 'licences', `Seuils d'avertissement → ${value}`, 'settings', null, null, { thresholds: sorted });
  res.json({ ok: true, thresholds: sorted });
}));

/**
 * Demande de renouvellement — côté CLIENT (pas is_global)
 * Accessible même si licence expirée (middleware doit laisser passer /me/*)
 */
r.post('/me/license/renewal-request', body(z.object({
  message: z.string().max(1000).optional().nullable(),
  preferred_duration_unit: z.enum(['day', 'month', 'year', 'indefinite', 'custom']).optional().nullable(),
  preferred_duration_value: z.number().int().positive().optional().nullable()
})), wrap(async (req, res) => {
  if (req.user.is_global) {
    throw new HttpError(400, "L'administrateur principal n'a pas besoin de demander un renouvellement");
  }
  const contract = await loadContractForUser(req.user.id, false);
  if (!contract || !contract.client_id) {
    throw new HttpError(400, 'Aucun client lié à votre compte');
  }
  // Une seule demande pending à la fois
  const { rows: existing } = await pool.query(
    `SELECT id FROM license_renewal_requests
     WHERE client_id = $1 AND status = 'pending' LIMIT 1`,
    [contract.client_id]
  );
  if (existing.length) {
    return res.status(409).json({
      error: 'Une demande de renouvellement est déjà en cours',
      request_id: existing[0].id
    });
  }
  const { rows: [row] } = await pool.query(
    `INSERT INTO license_renewal_requests
       (client_id, requested_by, message, preferred_duration_unit, preferred_duration_value)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      contract.client_id,
      req.user.id,
      req.body.message || null,
      req.body.preferred_duration_unit || null,
      req.body.preferred_duration_value || null
    ]
  );
  await audit(pool, req, 'licences', `Demande renouvellement client #${contract.client_id}`,
    'license_renewal_requests', row.id, null, row);
  res.status(201).json({ ok: true, request: row });
}));

/** Liste des demandes de renouvellement (admin principal) */
r.get('/admin/license-renewal-requests', needPrincipal, wrap(async (req, res) => {
  const status = req.query.status || 'pending';
  const { rows } = await pool.query(
    `SELECT rr.*, c.name AS client_name, c.contact_email, u.login AS requester_login
     FROM license_renewal_requests rr
     JOIN clients c ON c.id = rr.client_id
     LEFT JOIN users u ON u.id = rr.requested_by
     WHERE ($1 = 'all' OR rr.status = $1)
     ORDER BY rr.requested_at DESC
     LIMIT 100`,
    [status]
  );
  res.json(rows);
}));

/** Traiter une demande (approve → oriente vers renew ; reject) */
r.post('/admin/license-renewal-requests/:id/process', needPrincipal, body(z.object({
  action: z.enum(['approve', 'reject']),
  process_note: z.string().max(500).optional().nullable(),
  // Durée optionnelle : sinon preferred_duration_* de la demande
  duration_unit: z.enum(['day', 'month', 'year', 'indefinite', 'custom']).optional(),
  duration_value: z.number().int().positive().optional().nullable(),
  is_indefinite: z.boolean().optional(),
  invoice_amount: z.number().min(0).max(1e12).optional().nullable(),
  mark_invoice_paid: z.boolean().optional()
})), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant de demande invalide');

  // La décision, le changement de statut et le renouvellement sont atomiques.
  // Le verrou empêche deux traitements concurrents de la même demande.
  const result = await tx(async c => {
    const { rows: [rr] } = await c.query(
      `SELECT * FROM license_renewal_requests WHERE id = $1 FOR UPDATE`, [id]
    );
    if (!rr) throw new HttpError(404, 'Demande introuvable');
    if (rr.status !== 'pending') throw new HttpError(409, 'Demande déjà traitée');

    const newStatus = req.body.action === 'approve' ? 'accepted' : 'rejected';
    let renewed = null;
    if (req.body.action === 'approve') {
      // Durée : corps de requête > durée demandée par le client > 1 an par défaut
      const unitIn = req.body.duration_unit || rr.preferred_duration_unit || 'year';
      const valueIn = req.body.duration_value != null ? req.body.duration_value : rr.preferred_duration_value;
      const indefinite = req.body.is_indefinite === true || unitIn === 'indefinite';
      const unit = indefinite ? 'indefinite' : unitIn;
      const value = indefinite ? null : (Number(valueIn) > 0 ? Number(valueIn) : 1);
      const startsAt = new Date();
      const expiresAt = indefinite ? null : computeExpiry(startsAt, value, unit);
      const { rows: [old] } = await c.query(
        `SELECT * FROM client_contracts WHERE client_id = $1 FOR UPDATE`, [rr.client_id]
      );
      if (!old) throw new HttpError(404, 'Contrat introuvable');
      const { rows: [n] } = await c.query(
        `UPDATE client_contracts SET
           status = 'actif',
           starts_at = $2::timestamptz, expires_at = $3::timestamptz,
           start_date = ($2::timestamptz)::date,
           end_date = CASE WHEN $3::timestamptz IS NULL THEN NULL ELSE ($3::timestamptz)::date END,
           is_indefinite = $4::boolean,
           duration_value = $5::int, duration_unit = $6::text,
           last_renewed_at = now(), last_renewed_by = $7::bigint,
           suspended_at = NULL, suspended_by = NULL, suspend_reason = NULL, access_revoked = FALSE,
           updated_by = $7::bigint, updated_at = now()
         WHERE client_id = $1::bigint RETURNING *`,
        [rr.client_id, startsAt.toISOString(), expiresAt ? expiresAt.toISOString() : null, indefinite, value, unit, req.user.id]
      );
      await c.query(`UPDATE clients SET status = 'actif', deactivated_at = NULL WHERE id = $1`, [rr.client_id]);
      await recordLicenseHistory(c, {
        clientId: rr.client_id, contractId: n.id, operation: 'renewal',
        oldStatus: old.status, newStatus: indefinite ? 'INDEFINIE' : 'ACTIVE',
        oldStartsAt: old.starts_at, oldExpiresAt: old.expires_at,
        newStartsAt: startsAt, newExpiresAt: expiresAt,
        durationValue: value, durationUnit: unit, isIndefinite: indefinite,
        note: req.body.process_note || (`Renouvellement via demande #${id} — ${indefinite ? 'indéfinie' : (value + ' ' + unit)}`),
        performedBy: req.user.id
      });
      // Facture plateforme optionnelle (montant fourni à l'approbation)
      if (req.body.invoice_amount != null && Number(req.body.invoice_amount) > 0) {
        await maybeInvoiceLicense(c, req, {
          clientId: rr.client_id,
          amount: Number(req.body.invoice_amount),
          generate: true,
          markPaid: !!req.body.mark_invoice_paid,
          periodStart: startsAt.toISOString().slice(0, 10),
          periodEnd: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
          kind: 'licence',
          label: 'Renouvellement (demande #' + id + ') — client #' + rr.client_id,
          note: req.body.process_note || null,
          operation: 'renewal_request'
        });
      }
      renewed = n;
    }

    const { rows: [updatedRequest] } = await c.query(
      `UPDATE license_renewal_requests
       SET status = $2, processed_by = $3, processed_at = now(), process_note = $4
       WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, newStatus, req.user.id, req.body.process_note || null]
    );
    if (!updatedRequest) throw new HttpError(409, 'Demande déjà traitée');
    await audit(c, req, 'licences',
      `Demande renouvellement #${id} → ${newStatus}`,
      'license_renewal_requests', id, updatedRequest, { action: req.body.action, renewed: !!renewed });
    return { request: updatedRequest, newStatus, renewed };
  });

  res.json({ ok: true, status: result.newStatus, renewed: !!result.renewed, contract: result.renewed });
}));

/**
 * Suppression / archivage définitif côté organisation
 * (les données métier restent en base — status archive uniquement)
 */
r.delete('/admin/clients/:id', needPrincipal, wrap(async (req, res) => {
  const clientId = +req.params.id;
  const reason = (req.body && req.body.reason) || 'Archivage compte client';
  const { rows: [cl] } = await pool.query(`SELECT id, name, status FROM clients WHERE id = $1`, [clientId]);
  if (!cl) throw new HttpError(404, 'Client introuvable');
  // Soft-delete : archive — AUCUNE suppression de données métier
  await pool.query(
    `UPDATE clients SET status = 'archive', deactivated_at = COALESCE(deactivated_at, now()) WHERE id = $1`,
    [clientId]
  );
  await pool.query(
    `UPDATE client_contracts SET status = 'suspendu', suspended_at = now(),
       suspended_by = $2, suspend_reason = $3
     WHERE client_id = $1 AND status = 'actif'`,
    [clientId, req.user.id, reason]
  );
  await recordLicenseHistory(pool, {
    clientId, operation: 'suspend',
    oldStatus: cl.status, newStatus: 'archive',
    note: reason || 'Archivage par administrateur principal',
    performedBy: req.user.id
  });
  await audit(pool, req, 'contrats', `Archivage client #${clientId} (${cl.name})`,
    'clients', clientId, cl, { status: 'archive' });
  res.json({
    ok: true,
    message: 'Compte client archivé. Les données métier sont conservées intégralement.'
  });
}));

/** Configuration globale des moyens de paiement de l'abonnement (Superadmin). */
async function readSubscriptionPaymentInfo() {
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'subscription_payment_info' LIMIT 1").catch(swallow('contracts:1542', { rows: [] }));
  let data = rows[0]?.value || {};
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { data = {}; } }
  return { orange_qr: String(data.orange_qr || ''), malitel_qr: String(data.malitel_qr || ''), details: String(data.details || '') };
}
r.get('/admin/subscription-payment-info', needPrincipal, wrap(async (req, res) => {
  res.json(await readSubscriptionPaymentInfo());
}));
r.put('/admin/subscription-payment-info', needPrincipal, body(z.object({
  orange_qr: z.string().max(1500000).optional().default(''),
  malitel_qr: z.string().max(1500000).optional().default(''),
  details: z.string().max(5000).optional().default('')
})), wrap(async (req, res) => {
  const data = { orange_qr: req.body.orange_qr || '', malitel_qr: req.body.malitel_qr || '', details: req.body.details || '' };
  for (const key of ['orange_qr', 'malitel_qr']) {
    const v = data[key];
    if (v && !/^https:\/\//i.test(v) && !/^data:image\/(png|jpeg|webp);base64,/i.test(v)) throw new HttpError(400, 'Chaque QR doit être une URL HTTPS ou une image PNG/JPEG/WebP.');
  }
  await pool.query("INSERT INTO app_settings (key, value, updated_by) VALUES ('subscription_payment_info', $1::jsonb, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by", [JSON.stringify(data), req.user.id]);
  await audit(pool, req, 'abonnements', 'Configuration des QR et détails de paiement mise à jour', 'app_settings', null, null, { orange_qr: !!data.orange_qr, malitel_qr: !!data.malitel_qr });
  res.json({ ok: true });
}));
r.get('/me/subscription-payment-info', wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(403, 'Réservé aux comptes clients.');
  res.json(await readSubscriptionPaymentInfo());
}));

/** Historique des abonnements du client courant (lecture seule) : opérations de licence + demandes de renouvellement.
 *  Aucune donnée interne exposée (ni auteur, ni notes d'administration). */
r.get('/me/license/history', wrap(async (req, res) => {
  if (req.user.is_global) return res.json({ history: [], requests: [] });
  const { rows: [u] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
  if (!u || !u.client_id) return res.json({ history: [], requests: [] });
  const [h, q] = await Promise.all([
    pool.query(
      `SELECT id, operation, old_status, new_status, old_expires_at, new_starts_at, new_expires_at,
              duration_value, duration_unit, is_indefinite, performed_at
         FROM license_history WHERE client_id = $1 ORDER BY performed_at DESC, id DESC LIMIT 50`, [u.client_id]
    ).catch(swallow('contracts:me-license-history', { rows: [] })),
    pool.query(
      `SELECT id, status, preferred_duration_unit, preferred_duration_value, requested_at, COALESCE(processed_at, handled_at) AS processed_at
         FROM license_renewal_requests WHERE client_id = $1 ORDER BY requested_at DESC, id DESC LIMIT 20`, [u.client_id]
    ).catch(swallow('contracts:me-renewal-requests', { rows: [] }))
  ]);
  res.set('Cache-Control', 'no-store').json({ history: h.rows, requests: q.rows });
}));

/** Message d'expiration / avertissement pour le client courant */
r.get('/me/license/status-message', wrap(async (req, res) => {
  if (req.user.is_global) return res.json({ status: 'UNRESTRICTED' });
  const contract = await loadContractForUser(req.user.id, false);
  if (!contract || contract.unrestricted) return res.json({ status: 'UNRESTRICTED' });
  const thresholds = await getWarningThresholds();
  const status = contract.license_status || licenseStatusOf(contract, new Date(), thresholds[0] || 30);
  let message = null;
  if (status === 'EXPIREE' || status === 'SUSPENDUE') {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key = 'license_expired_message' LIMIT 1`
    ).catch(swallow('contracts:1580', { rows: [] }));
    message = rows[0]?.value ||
      'La licence attribuée à votre compte est arrivée à expiration. L\'accès est suspendu. Contactez l\'administrateur principal.';
  } else if (status === 'EXPIRANT_BIENTOT') {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE key = 'license_expiring_message' LIMIT 1`
    ).catch(swallow('contracts:1586', { rows: [] }));
    message = rows[0]?.value ||
      `Votre licence expire dans ${contract.days_remaining} jour(s). Contactez l'administrateur pour renouveler.`;
  }
  const { rows: phoneRows } = await pool.query(
    `SELECT value FROM settings WHERE station_id IS NULL AND key = 'superadmin_phone' LIMIT 1`
  ).catch(swallow('contracts:1592', { rows: [] }));
  const paymentInfo = await readSubscriptionPaymentInfo();
  res.json({
    status,
    days_remaining: contract.days_remaining,
    expires_at: contract.expires_at,
    is_indefinite: contract.is_indefinite,
    message,
    superadmin_phone: String(phoneRows[0]?.value || process.env.SUPERADMIN_PHONE || '').trim(),
    can_request_renewal: status === 'EXPIREE' || status === 'EXPIRANT_BIENTOT' || status === 'SUSPENDUE',
    payment_info: { orange_qr: String(paymentInfo.orange_qr || ''), malitel_qr: String(paymentInfo.malitel_qr || ''), details: String(paymentInfo.details || '') }
  });
}));


/** Rapport PDF d'analyse de situation d'un compte client (Super Admin). */
r.get('/admin/clients/:id/situation.pdf', needPrincipal, wrap(async (req, res) => {
  const clientId = +req.params.id;
  const PDFDocument = require('pdfkit');
  const contract = await loadContract(clientId);
  if (!contract || !contract.client_id) throw new HttpError(404, 'Client introuvable');

  const { rows: stations } = await pool.query(
    `SELECT id, name, address, phone, email, currency, active, created_at
       FROM stations WHERE client_id = $1 ORDER BY name, id`, [clientId]
  ).catch(swallow('contracts:1617', { rows: [] }));
  const { rows: users } = await pool.query(
    `SELECT u.id, u.login, u.full_name, u.active, r.code AS role, r.label AS role_label,
            u.last_login_at
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.client_id = $1 AND u.deleted_at IS NULL
      ORDER BY u.login`, [clientId]
  ).catch(swallow('contracts:1624', { rows: [] }));
  const { rows: [backupInfo] } = await pool.query(
    `SELECT COUNT(*)::int AS n, MAX(created_at) AS last_at
       FROM backup_logs WHERE client_id = $1`, [clientId]
  ).catch(swallow('contracts:1628', { rows: [{ n: 0, last_at: null }] }));
  const { rows: renewals } = await pool.query(
    `SELECT status, requested_at, processed_at FROM license_renewal_requests
      WHERE client_id = $1 ORDER BY requested_at DESC LIMIT 10`, [clientId]
  ).catch(swallow('contracts:1632', { rows: [] }));

  const features = contract.features || {};
  const modules = features.modules || {};
  const reportId = 'SMP-SIT-' + clientId + '-' + Date.now().toString(36).toUpperCase();
  const generatedAt = new Date();

  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: {
    Title: 'Situation client #' + clientId,
    Author: 'Manager PRO',
    Creator: 'Manager PRO'
  }});
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(resolve => doc.on('end', resolve));

  const line = (label, value) => {
    doc.font('Helvetica-Bold').fontSize(10).text(label + ' : ', { continued: true });
    doc.font('Helvetica').text(String(value == null || value === '' ? '—' : value));
  };
  const section = (title) => {
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#0a6b5c').text(title);
    doc.fillColor('#000').moveDown(0.3);
    doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor('#ccc').stroke();
    doc.moveDown(0.4);
  };

  doc.font('Helvetica-Bold').fontSize(18).fillColor('#0a6b5c').text('Manager PRO');
  doc.font('Helvetica').fontSize(11).fillColor('#333').text("Rapport d'analyse de situation — compte client");
  doc.moveDown();
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#000').text(contract.client_name || ('Client #' + clientId));
  doc.font('Helvetica').fontSize(10).fillColor('#555');
  doc.text('Identifiant rapport : ' + reportId);
  doc.text('Genere le : ' + generatedAt.toLocaleString('fr-FR'));
  doc.text('Genere par : Super Admin (id ' + req.user.id + ')');
  doc.moveDown();
  doc.fillColor('#000');

  section('1. Identite du compte');
  line('Nom', contract.client_name);
  line('Code', contract.client_code || contract.code);
  line('Statut organisation', contract.client_status);
  line('Responsable', contract.manager_name);
  line('E-mail', contract.contact_email);
  line('Telephone', contract.contact_phone);

  section('2. Contrat et abonnement');
  line('Type', contract.contract_type);
  line('Statut contrat', contract.contract_status || contract.status);
  line('Statut licence', contract.license_status);
  line('Debut', contract.start_date || contract.starts_at);
  line('Fin / expiration', contract.is_indefinite ? 'Sans expiration' : (contract.end_date || contract.expires_at || '—'));
  line('Jours restants', contract.days_remaining != null ? contract.days_remaining : '—');
  line('Max stations', contract.max_stations == null ? 'Illimite' : contract.max_stations);
  line('Max utilisateurs', contract.max_users == null ? 'Illimite' : contract.max_users);
  line('Creation stations', contract.can_create_station ? 'Autorisee' : 'Interdite');
  line('Gestion utilisateurs', contract.can_manage_users ? 'Autorisee' : 'Interdite');

  section('3. Stations');
  line('Nombre', stations.length);
  for (const s of stations) {
    doc.font('Helvetica').fontSize(9)
      .text('- #' + s.id + ' ' + s.name + ' — ' + (s.active ? 'active' : 'inactive') + ' — ' + (s.currency || '') + ' — ' + (s.address || 'sans adresse'));
  }
  if (!stations.length) doc.font('Helvetica').fontSize(9).text('Aucune station enregistree.');

  section('4. Utilisateurs');
  line('Nombre', users.length);
  for (const u of users.slice(0, 40)) {
    doc.font('Helvetica').fontSize(9)
      .text('- ' + u.login + (u.full_name ? ' (' + u.full_name + ')' : '') + ' — ' + (u.role_label || u.role || '—') + ' — ' + (u.active ? 'actif' : 'inactif'));
  }
  if (users.length > 40) doc.font('Helvetica').fontSize(9).text('... et ' + (users.length - 40) + ' autre(s)');
  if (!users.length) doc.font('Helvetica').fontSize(9).text('Aucun utilisateur rattache.');

  section('5. Modules et autorisations');
  for (const k of Object.keys(features).filter(k => k !== 'modules')) {
    const v = features[k];
    if (typeof v === 'boolean') line(k, v ? 'Active' : 'Desactive');
  }
  doc.moveDown(0.2);
  doc.font('Helvetica-Bold').fontSize(10).text('Modules :');
  for (const [k, v] of Object.entries(modules)) {
    doc.font('Helvetica').fontSize(9).text('  - ' + k + ' : ' + (v ? 'active' : 'desactive'));
  }

  section('6. Sauvegardes (preuves disponibles)');
  if (backupInfo && backupInfo.n > 0) {
    line("Nombre d'entrees journalisees", backupInfo.n);
    line('Derniere entree', backupInfo.last_at ? new Date(backupInfo.last_at).toLocaleString('fr-FR') : '—');
    doc.font('Helvetica').fontSize(8).fillColor('#555')
      .text("Note : presence d'entrees de journal ne constitue pas une preuve de restauration testee.");
    doc.fillColor('#000');
  } else {
    doc.font('Helvetica').fontSize(9).text('Aucune preuve de sauvegarde journalisee pour ce client.');
  }

  section('7. Demandes de renouvellement recentes');
  if (renewals.length) {
    for (const rr of renewals) {
      doc.font('Helvetica').fontSize(9)
        .text('- ' + rr.status + ' — demande ' + (rr.requested_at ? new Date(rr.requested_at).toLocaleString('fr-FR') : '—'));
    }
  } else {
    doc.font('Helvetica').fontSize(9).text('Aucune demande enregistree.');
  }

  section('8. Synthese');
  const alerts = [];
  if (contract.suspended || /SUSPEND/i.test(String(contract.license_status || ''))) alerts.push('Compte ou licence suspendu(e).');
  if (/EXPIR/i.test(String(contract.license_status || ''))) alerts.push('Licence expiree ou en cours d\'expiration.');
  if (contract.max_stations != null && stations.length >= contract.max_stations) alerts.push('Quota de stations atteint.');
  if (contract.max_users != null && users.length >= contract.max_users) alerts.push('Quota d\'utilisateurs atteint.');
  if (!alerts.length) doc.font('Helvetica').fontSize(10).text('Aucun point critique detecte a partir des donnees disponibles.');
  else {
    for (const a of alerts) doc.font('Helvetica').fontSize(10).fillColor('#a00').text('- ' + a);
  }
  doc.fillColor('#000');

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.fontSize(8).fillColor('#888')
      .text('Page ' + (i + 1) + ' / ' + pages.count + ' — ' + reportId,
        48, doc.page.height - 36, { align: 'center', width: doc.page.width - 96 });
  }
  doc.end();
  await done;
  const buf = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="situation-client-' + clientId + '.pdf"');
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
}));



/** Historique des modifications de contrat (audit_logs). */
r.get('/admin/clients/:id/contract-history', needPrincipal, wrap(async (req, res) => {
  const clientId = +req.params.id;
  const { rows: [cl] } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
  if (!cl) throw new HttpError(404, 'Client introuvable');
  const { rows } = await pool.query(
    `SELECT a.id, a.module, a.action, a.table_name, a.record_id,
            a.old_value, a.new_value, a.created_at, u.login AS admin_login
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.module IN ('contrats', 'clients', 'licences')
         OR a.table_name IN ('client_contracts', 'clients')
         OR (a.table_name = 'client_contracts' AND a.record_id = $1)
         OR a.action ILIKE '%' || $2 || '%'
      ORDER BY a.id DESC
      LIMIT 80`,
    [clientId, cl.name]
  ).catch(swallow('contracts:1787', { rows: [] }));
  res.json({ client_id: clientId, client_name: cl.name, history: rows });
}));


module.exports = {
  r,
  loadContract,
  loadContractForUser,
  featureOn,
  requireFeature,
  needPrincipal,
  attachContract,
  countClientStations,
  countClientUsers,
  DEFAULT_FEATURES,
  mergeFeatures,
  licenseStatusOf,
  computeExpiry,
  daysRemaining,
  recordLicenseHistory,
  getWarningThresholds
};