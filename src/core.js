// Noyau : base de données, transactions, erreurs, authentification, permissions, audit, caisse, stock.
require('dotenv').config();
const { swallow } = require('./safe');
const { Pool, types } = require('pg');
const jwt = require('jsonwebtoken');
types.setTypeParser(1700, parseFloat); // NUMERIC → nombre
types.setTypeParser(20, v => parseInt(v, 10)); // BIGINT → nombre

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const fl = n => Math.round((+n || 0) * 100) / 100;
const f3 = n => Math.round((+n || 0) * 1000) / 1000;

class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
class Preview extends Error { constructor(data) { super('preview'); this.data = data; } } // annule la transaction et renvoie l'aperçu

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

// Validation du corps de requête avec un schéma zod
const body = schema => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) return next(new HttpError(400, 'Données invalides', r.error.issues.map(i => i.path.join('.') + ' : ' + i.message)));
  req.body = r.data; next();
};

// Authentification : jeton JWT + session non révoquée en base
const auth = wrap(async (req, res, next) => {
  let p;
  try { p = jwt.verify((req.headers.authorization || '').replace(/^Bearer /, ''), process.env.JWT_SECRET); }
  catch { throw new HttpError(401, 'Non authentifié'); }
  const { rows: [u] } = await pool.query(
    `SELECT u.id, u.login, u.is_global, u.client_id, u.active, r.code AS role, s.revoked_at, s.expires_at
       FROM users u JOIN roles r ON r.id = u.role_id JOIN user_sessions s ON s.id = $2 AND s.user_id = u.id
      WHERE u.id = $1 AND u.deleted_at IS NULL`, [p.uid, p.sid]);
  if (!u || !u.active || u.revoked_at || u.expires_at < new Date()) throw new HttpError(401, 'Session invalide ou expirée');
  // L'identité de plateforme et le rôle doivent rester cohérents : pas de Superadmin local,
  // ni de compte global connecté sous le rôle ADMIN. La migration 063 normalise les comptes existants.
  if ((u.is_global && u.role !== 'SUPERADMIN') || (!u.is_global && u.role === 'SUPERADMIN')) {
    throw new HttpError(403, 'Configuration du rôle incohérente. Faites corriger le compte par le Superadmin.');
  }
  const { rows } = await pool.query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN roles r ON r.id = rp.role_id
      WHERE r.code = $1 OR ($2::boolean AND r.code = 'ADMIN')`, [u.role, !!u.is_global]);   // le Super Admin garde au minimum les droits ADMIN
  const perms = new Set(rows.map(x => x.code));
  // L'administrateur local d'un compte client détient toujours le droit opérationnel Fiscalité, même si la base n'a pas
  // (ou plus) cette ligne dans role_permissions : le verrou réel reste l'autorisation du contrat posée par le Superadmin.
  if (!u.is_global && u.role === 'ADMIN') perms.add('fiscal.access');
  req.user = { ...u, perms };
  req.sessionId = p.sid;
  next();
});

// Permission requise (au moins une des permissions listées)
const need = (...codes) => (req, res, next) =>
  codes.some(c => req.user.perms.has(c)) ? next() : next(new HttpError(403, 'Permission refusée : ' + codes.join(' ou ')));

// Confidentialité commerciale (RG-03, ANO-01) : prix d'achat, marges et valeur du stock à l'achat
// ne sont visibles que des détenteurs de « cost.view » (administrateur local, gérant, comptable).
const canCost = req => !!(req.user && req.user.perms && req.user.perms.has('cost.view'));
const COST_FIELDS = ['buy_price', 'unit_cost', 'val_buy', 'stock_value_buy', 'margin_unit', 'margin_pct'];
/** Retire les champs de coût d'une ligne (ou d'une liste de lignes) pour un utilisateur sans « cost.view ». */
const maskCost = (req, x, fields = COST_FIELDS) => {
  if (canCost(req) || x == null) return x;
  if (Array.isArray(x)) return x.map(i => maskCost(req, i, fields));
  const o = { ...x }; for (const f of fields) delete o[f]; return o;
};

// Station courante (en-tête X-Station-Id) : l'utilisateur doit y avoir accès
const station = wrap(async (req, res, next) => {
  // L'Administrateur Principal est un compte de plateforme : aucune station ne lui est attribuée.
  // Les routes métier sont donc bloquées plus loin ; les routes d'administration peuvent fonctionner avec sid=null.
  if (req.user.is_global) { req.sid = null; return next(); }
  const sid = parseInt(req.headers['x-station-id'], 10);
  if (!sid) throw new HttpError(400, 'En-tête X-Station-Id requis');
  // Vérifie l'affectation, l'état actif et l'appartenance au même client.
  // Un compte historique sans client_id reste limité aux stations explicitement affectées.
  const { rowCount } = await pool.query(
    `SELECT 1
       FROM user_stations us
       JOIN stations st ON st.id = us.station_id
       JOIN users u ON u.id = us.user_id
      WHERE us.user_id = $1 AND us.station_id = $2
        AND st.active = true
        AND (u.client_id IS NULL OR st.client_id = u.client_id)`,
    [req.user.id, sid]
  );
  if (!rowCount) throw new HttpError(403, 'Accès à cette station refusé');
  req.sid = sid;
  // Plafond de permissions par station : il réduit les droits effectifs, sans modifier le rôle global.
  const { rows: caps } = await pool.query(
    'SELECT permission_code FROM station_permission_caps WHERE station_id=$1 AND allowed=false', [sid]
  ).catch(swallow('core:86', { rows: [] }));
  if (caps.length) for (const c of caps) req.user.perms.delete(c.permission_code);
  next();
});

// Journal d'audit (ancienne et nouvelle valeur, IP)
const audit = (c, req, module, action, table, recId, oldV, newV) => c.query(
  `INSERT INTO audit_logs(station_id, user_id, module, action, table_name, record_id, old_value, new_value, ip_address)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [req.sid || null, req.user?.id || null, module, action, table || null, recId || null,
   oldV ? JSON.stringify(oldV) : null, newV ? JSON.stringify(newV) : null, req.ip]);

// Mouvement de caisse : met à jour le solde et refuse un solde négatif
async function cashMove(c, { reg, shift = null, kind, amount, label, ref = [null, null], by }) {
  const { rows: [r] } = await c.query('UPDATE cash_registers SET balance = balance + $2 WHERE id = $1 RETURNING balance', [reg, amount]);
  if (r.balance < 0) throw new HttpError(409, 'Solde de caisse insuffisant');
  await c.query(
    `INSERT INTO cash_movements(cash_register_id, shift_id, kind, amount, label, ref_table, ref_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [reg, shift, kind, amount, label, ref[0], ref[1], by]);
  return r.balance;
}

// Mouvement de stock (le trigger SQL met à jour la table stock)
async function stockMove(c, { station, product, kind, qty, shift = null, ref = [null, null], comment = null, by, allowNegative = false }) {
  await c.query(
    `INSERT INTO stock_movements(station_id, product_id, kind, quantity, shift_id, ref_table, ref_id, comment, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [station, product, kind, qty, shift, ref[0], ref[1], comment, by]);
  if (!allowNegative && qty < 0) {
    const { rows: [s] } = await c.query('SELECT quantity FROM stock WHERE product_id = $1', [product]);
    if (s.quantity < 0) throw new HttpError(409, 'Stock insuffisant');
  }
}

// ---------- Moyens de paiement configurables, comptes bancaires / mobile money, grand livre clients ----------
async function payMethod(c, station, code) {
  const { rows: [m] } = await c.query('SELECT * FROM payment_methods WHERE station_id = $1 AND code = $2 AND active', [station, code]);
  if (!m) throw new HttpError(400, 'Moyen de paiement inconnu ou inactif : ' + code);
  return m;
}
// Garantit la liaison règlement ↔ compte : un moyen de paiement hors espèces/crédit doit être rattaché à un compte ACTIF.
async function assertLinkedMethod(c, station, code) {
  const m = await payMethod(c, station, code);
  if (m.kind === 'especes' || m.kind === 'credit') return m;
  if (!m.account_id) throw new HttpError(409, 'Le moyen de paiement « ' + m.label + ' » n’est lié à aucun compte. Rattachez-le à un compte actif (Finance > Moyens de paiement) avant de l’utiliser.');
  const { rows: [a] } = await c.query('SELECT active FROM money_accounts WHERE id = $1 AND station_id = $2', [m.account_id, station]);
  if (!a || !a.active) throw new HttpError(409, 'Le compte lié au moyen de paiement « ' + m.label + ' » est inactif ou introuvable : choisissez un autre compte.');
  return m;
}
// Écrit un mouvement sur le compte bancaire / mobile money rattaché au moyen de paiement (s'il existe)
async function accountMove(c, { station, method, amount, label, ref = [null, null], shift = null, by, kind }) {
  const { rows: [m] } = await c.query('SELECT account_id FROM payment_methods WHERE station_id = $1 AND code = $2', [station, method]);
  if (!m || !m.account_id) return null;
  await c.query('INSERT INTO money_movements(account_id, station_id, kind, amount, label, ref_table, ref_id, shift_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [m.account_id, station, kind || (amount >= 0 ? 'encaissement' : 'virement_emis'), amount, label, ref[0], ref[1], shift, by]);
  return m.account_id;
}
// Règlement d'un montant signé (+ encaissement, − décaissement) selon le moyen de paiement : caisse, compte ou rien (crédit)
async function settle(c, { station, method, amount, label, ref, shift = null, by, event_type = null, customer_id = null, supplier_id = null, employee_id = null, description = null }) {
  // P5 : un moyen hors espèces/crédit doit être lié à un compte actif (même règle que les règlements clients).
  const m = await assertLinkedMethod(c, station, method);
  let cash_register_id = null, account_id = null;
  if (m.kind === 'especes') {
    cash_register_id = await defaultReg(c, station);
    await cashMove(c, { reg: cash_register_id, shift, kind: amount >= 0 ? 'encaissement' : 'decaissement', amount, label, ref, by });
  } else if (m.kind !== 'credit') {
    account_id = await accountMove(c, { station, method, amount, label, ref, shift, by });
    if (account_id == null) throw new HttpError(409, 'Le moyen de paiement « ' + m.label + ' » n’a produit aucun mouvement de compte.');
  }
  // Journal métier (non bloquant si table absente)
  if (event_type) {
    try {
      await recordFinancialEvent(c, {
        station, event_type,
        direction: amount >= 0 ? 'in' : 'out',
        amount: Math.abs(amount),
        label, method, account_id, cash_register_id, shift,
        customer_id, supplier_id, employee_id, ref, description, by
      });
    } catch (e) {
      if (e.code !== '42P01') throw e; // table missing
    }
  }
  return m;
}
// Grand livre clients : + = le client doit davantage
const ledger = (c, { customer, station, kind, amount, ref = [null, null], by }) =>
  c.query('INSERT INTO customer_ledger(customer_id, station_id, kind, amount, ref_table, ref_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [customer, station, kind, amount, ref[0], ref[1], by]);

async function setting(c, station, key, def) {
  const { rows: [r] } = await c.query('SELECT value FROM settings WHERE station_id = $1 AND key = $2', [station, key]);
  return r ? r.value : def;
}
async function defaultReg(c, station) {
  const { rows: [r] } = await c.query('SELECT id FROM cash_registers WHERE station_id = $1 AND active ORDER BY id LIMIT 1', [station]);
  if (!r) throw new HttpError(409, 'Aucune caisse configurée pour cette station');
  return r.id;
}

function errorHandler(e, req, res, next) {
  if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, details: e.details });
  if (e.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  const schemaMismatch = 'Schéma de base de données incompatible (table ou colonne manquante). Consultez les journaux du serveur pour identifier la requête. Avant toute migration, faites une sauvegarde indépendante et vérifiez schema_migrations ; ne réinitialisez pas la base. Si l’historique est vide alors que des données existent, arrêtez-vous et faites auditer le schéma.';
  const map = { '42P01': [503, schemaMismatch], '42703': [503, schemaMismatch], '22P02': [400, 'Paramètre invalide (format incorrect)'], 22003: [400, 'Valeur numérique hors limites'], 22007: [400, 'Date ou heure invalide'], 22008: [400, 'Date ou heure invalide'], 22001: [400, 'Texte trop long'], 23505: [409, 'Doublon'], 23503: [409, 'Référence invalide'], 23514: [400, 'Valeur non autorisée'], P0001: [409, e.message] };
  const m = map[e.code];
  if (m) return res.status(m[0]).json({ error: m[1] });
  console.error('[500] ' + (req && req.method) + ' ' + (req && req.originalUrl) + ' —', e && e.code ? '[' + e.code + ']' : '', e);
  res.status(500).json({ error: 'Erreur interne' });
}


/** Journal métier normalisé (P4) — n'altère pas les soldes, complète cash/money movements */
async function recordFinancialEvent(c, {
  station, event_type, direction, amount, label, method = null,
  account_id = null, cash_register_id = null, shift = null,
  customer_id = null, supplier_id = null, employee_id = null,
  ref = [null, null], description = null, by = null, meta = null, event_at = null
}) {
  if (!(amount >= 0)) throw new HttpError(400, 'Montant financial_event invalide');
  const { rows: [row] } = await c.query(
    `INSERT INTO financial_events(
       station_id, event_type, direction, amount, method, account_id, cash_register_id,
       shift_id, customer_id, supplier_id, employee_id, ref_table, ref_id, label, description,
       event_at, created_by, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16, now()),$17,$18::jsonb)
     RETURNING id`,
    [station, event_type, direction, amount, method, account_id, cash_register_id,
     shift, customer_id, supplier_id, employee_id, ref[0], ref[1], label, description,
     event_at, by, meta ? JSON.stringify(meta) : null]
  );
  return row.id;
}

module.exports = { canCost, maskCost, assertLinkedMethod, payMethod, accountMove, settle, ledger, recordFinancialEvent, pool, tx, fl, f3, HttpError, Preview, wrap, body, auth, need, station, audit, cashMove, stockMove, setting, defaultReg, errorHandler };
