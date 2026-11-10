'use strict';
/**
 * Accès base des paramètres fiscaux confirmés par client (assistant d'activation).
 * Source unique des taux/barèmes : alimente les estimations Fiscalité et la paie (ITS, INPS, AMO, CFE, TFP).
 */
const { pool, HttpError } = require('./core');

const today = () => new Date().toISOString().slice(0, 10);

async function getActivation(clientId, code, db = pool) {
  const { rows: [a] } = await db.query(
    'SELECT * FROM fiscal_module_activations WHERE client_id = $1 AND module_code = $2', [clientId, code]
  );
  return a || null;
}

async function listActivations(clientId, db = pool) {
  const { rows } = await db.query('SELECT * FROM fiscal_module_activations WHERE client_id = $1', [clientId]);
  return Object.fromEntries(rows.map(a => [a.module_code, a]));
}

/** Version de paramètres en vigueur à une date (la plus récente dont la date d'effet est atteinte). */
async function getSettings(clientId, code, asOf, db = pool) {
  const d = asOf || today();
  const { rows } = await db.query(
    `SELECT * FROM fiscal_module_settings
     WHERE client_id = $1 AND module_code = $2 AND effective_from <= $3::date
     ORDER BY effective_from DESC, version DESC LIMIT 1`, [clientId, code, d]
  );
  if (rows[0]) return { ...rows[0], before_effective: false };
  // Période antérieure à la première date d'effet : on utilise la plus ancienne version, avec avertissement.
  const { rows: first } = await db.query(
    `SELECT * FROM fiscal_module_settings WHERE client_id = $1 AND module_code = $2 ORDER BY version ASC LIMIT 1`, [clientId, code]
  );
  return first[0] ? { ...first[0], before_effective: true } : null;
}

async function listVersions(clientId, code, db = pool) {
  const { rows } = await db.query(
    `SELECT s.id, s.version, s.params, s.customized, s.zero_confirmed, s.dataset_version, s.effective_from, s.reason, s.created_at, COALESCE(u.full_name, u.login) AS created_by_login
     FROM fiscal_module_settings s LEFT JOIN users u ON u.id = s.created_by
     WHERE s.client_id = $1 AND s.module_code = $2 ORDER BY s.version DESC`, [clientId, code]
  );
  return rows;
}

/**
 * Garde commune : aucun calcul ni montant tant que le module n'est pas activé via l'assistant ET paramétré.
 * @returns {{activation:object, settings:object, params:object, warnings:string[]}}
 */
async function requireActive(clientId, code, asOf, db = pool) {
  const act = await getActivation(clientId, code, db);
  if (!act || !act.activated) {
    throw new HttpError(409, 'Module non activé. Activez-le avec l\'assistant d\'activation (paramètres, test, confirmation).', { code: 'FISCAL_MODULE_NOT_ACTIVATED', module: code });
  }
  const s = await getSettings(clientId, code, asOf, db);
  if (!s) {
    throw new HttpError(409, 'Paramètres non confirmés pour ce module : ouvrez l\'assistant d\'activation pour les renseigner et les confirmer.', { code: 'FISCAL_SETTINGS_REQUIRED', module: code });
  }
  const warnings = [];
  if (s.before_effective) warnings.push(`Les paramètres (version ${s.version}) entrent en vigueur le ${String(s.effective_from).slice(0, 10)}, après la période estimée.`);
  if (Array.isArray(s.customized) && s.customized.length) warnings.push(`Paramètres personnalisés par rapport au jeu de référence : ${s.customized.join(', ')}.`);
  return { activation: act, settings: s, params: s.params || {}, warnings };
}

/** Enregistre une NOUVELLE version de paramètres (jamais de réécriture de l'historique). */
async function saveVersion(db, { clientId, code, params, customized, zeroConfirmed, datasetVersion, effectiveFrom, reason, userId }) {
  const { rows: [m] } = await db.query(
    'SELECT COALESCE(MAX(version), 0) AS v FROM fiscal_module_settings WHERE client_id = $1 AND module_code = $2', [clientId, code]
  );
  const version = (m.v || 0) + 1;
  const { rows: [row] } = await db.query(
    `INSERT INTO fiscal_module_settings (client_id, module_code, version, params, customized, zero_confirmed, dataset_version, effective_from, reason, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::date,$9,$10) RETURNING *`,
    [clientId, code, version, JSON.stringify(params), JSON.stringify(customized || []), JSON.stringify(zeroConfirmed || []),
      datasetVersion, effectiveFrom, reason, userId]
  );
  return row;
}

module.exports = { getActivation, listActivations, getSettings, listVersions, requireActive, saveVersion, today };
