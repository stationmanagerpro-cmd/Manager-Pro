// Produits, pompes/compteurs, employés, clients.
const express = require('express');
const { swallow } = require('./safe');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit, stockMove, ledger, recordFinancialEvent, canCost, maskCost } = require('./core');
const { applySupplierCredits, applyCustomerCredits } = require('./credits');
const { recordPriceChange } = require('./product_profile');
const r = express.Router();
// Masquage des montants selon les permissions : créances (dus par les clients) et dettes (dues aux fournisseurs)
const maskRecv = (req, x) => req.user.perms.has('receivable.view') ? x : (Array.isArray(x) ? x.map(i => maskRecv(req, i)) : { ...x, balance: null });
const maskDebt = (req, x) => req.user.perms.has('debt.view') ? x : (Array.isArray(x) ? x.map(i => maskDebt(req, i)) : { ...x, balance_due: null });


// ---------- Catégories de produits personnalisables ----------
r.get('/categories', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT id, code, label, has_meter FROM categories ORDER BY label');
  res.json(rows);
}));
r.post('/categories', need('settings.edit'), body(z.object({
  label: z.string().trim().min(1).max(60), has_meter: z.boolean().default(false),
})), wrap(async (req, res) => {
  const label = req.body.label.trim();
  const base = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'CATEGORIE';
  const out = await tx(async c => {
    let code = base, n = 2;
    while ((await c.query('SELECT 1 FROM categories WHERE code=$1', [code])).rowCount) code = `${base.slice(0, 36)}_${n++}`;
    const { rows: [row] } = await c.query('INSERT INTO categories(code,label,has_meter) VALUES($1,$2,$3) RETURNING id,code,label,has_meter', [code,label,req.body.has_meter]);
    await audit(c, req, 'produits', `Création catégorie ${label}`, 'categories', row.id, null, row);
    return row;
  });
  res.status(201).json(out);
}));
r.patch('/categories/:id', need('settings.edit'), body(z.object({ label: z.string().trim().min(1).max(60), has_meter: z.boolean().optional() }).strict()), wrap(async (req,res) => {
  const { rows: [old] } = await pool.query('SELECT * FROM categories WHERE id=$1', [req.params.id]);
  if (!old) throw new HttpError(404, 'Catégorie introuvable');
  const { rows: [row] } = await pool.query('UPDATE categories SET label=$2, has_meter=COALESCE($3,has_meter) WHERE id=$1 RETURNING id,code,label,has_meter', [old.id,req.body.label.trim(),req.body.has_meter ?? null]);
  await audit(pool, req, 'produits', `Modification catégorie ${old.label}`, 'categories', old.id, old, row);
  res.json(row);
}));
r.delete('/categories/:id', need('settings.edit'), wrap(async (req,res) => {
  const { rows: [cat] } = await pool.query('SELECT * FROM categories WHERE id=$1', [req.params.id]);
  if (!cat) throw new HttpError(404, 'Catégorie introuvable');
  const { rows: [used] } = await pool.query('SELECT count(*)::int AS n FROM products WHERE category_id=$1', [cat.id]);
  if (used.n) throw new HttpError(409, `Catégorie utilisée par ${used.n} produit(s) : réaffectez-les avant suppression`);
  if (cat.code === 'CARBURANT') throw new HttpError(409, 'La catégorie Carburant système ne peut pas être supprimée');
  await pool.query('DELETE FROM categories WHERE id=$1', [cat.id]);
  await audit(pool, req, 'produits', `Suppression catégorie ${cat.label}`, 'categories', cat.id, cat, null);
  res.status(204).end();
}));

// ---------- Produits ----------
// Par défaut : produits actifs ; ?inactive=1 : produits inactifs (archivés), comme pour les clients et fournisseurs.
r.get('/products', wrap(async (req, res) => {
  const inactive = req.query.inactive === '1' || req.query.inactive === 'true';
  const { rows } = await pool.query(
    `SELECT p.*, cat.code AS category, cat.label AS category_label, cat.has_meter AS category_has_meter, COALESCE(st.quantity, 0) AS stock FROM products p JOIN categories cat ON cat.id = p.category_id
      LEFT JOIN stock st ON st.product_id = p.id WHERE p.station_id = $1 AND p.deleted_at IS NULL AND p.active = $2 ORDER BY p.name`, [req.sid, !inactive]);
  res.json(maskCost(req, rows));   // RG-03 : sans « cost.view », aucun prix d'achat dans la réponse
}));
// Archiver (inactif) / réactiver un produit — aucune donnée supprimée : ventes, achats, stocks et prix restent consultables
r.patch('/products/:id/status', need('price.edit'), body(z.object({ active: z.boolean(), reason: z.string().trim().max(300).optional() })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [p] } = await c.query('SELECT id, name, active FROM products WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!p) throw new HttpError(404, 'Produit introuvable');
    if (!req.body.active) {
      // Un produit relié à un compteur de pompe est utilisé à chaque quart : on refuse de l'archiver
      const { rows: [pc] } = await c.query('SELECT pu.name AS pump, k.counter_number FROM pump_counters k JOIN pumps pu ON pu.id = k.pump_id WHERE k.product_id = $1 AND pu.station_id = $2 LIMIT 1', [p.id, req.sid]);
      if (pc) throw new HttpError(409, `Ce produit est relié à un compteur de pompe (${pc.pump}, compteur ${pc.counter_number}) : changez d'abord le produit du compteur.`);
    }
    const { rows: [u] } = await c.query(
      `UPDATE products SET active = $3, deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END WHERE id = $1 AND station_id = $2 RETURNING id, name, active`,
      [p.id, req.sid, req.body.active]);
    await audit(c, req, 'produits', (u.active ? 'Réactivation' : 'Mise en inactif') + ' du produit ' + u.name + (req.body.reason ? ' — ' + req.body.reason : ''), 'products', u.id, { active: p.active }, { active: u.active });
    return u;
  });
  res.json(out);
}));
r.post('/products', need('price.edit'), body(z.object({
  category: z.string(), name: z.string().min(1), unit: z.string().default('L'), buy_price: z.number().min(0).optional(), sell_price: z.number().min(0),
  tax_rate: z.number().min(0).default(0), min_stock: z.number().min(0).default(0), initial_stock: z.number().min(0).default(0),
  barcode: z.string().max(64).optional().nullable(), sku: z.string().max(64).optional().nullable(),
})), wrap(async (req, res) => {
  if (req.body.buy_price !== undefined && !canCost(req)) throw new HttpError(403, "Permission refusée : cost.view (le prix d'achat est réservé aux rôles de gestion)");
  const b = { ...req.body, buy_price: req.body.buy_price ?? 0 };
  const p = await tx(async c => {
    const { rows: [cat] } = await c.query('SELECT id FROM categories WHERE code = $1', [b.category]);
    if (!cat) throw new HttpError(400, 'Catégorie inconnue');
    const { rows: [p] } = await c.query(
      'INSERT INTO products(station_id, category_id, name, unit, buy_price, sell_price, tax_rate, min_stock, barcode, sku) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.sid, cat.id, b.name, b.unit, b.buy_price, b.sell_price, b.tax_rate, b.min_stock, b.barcode || null, b.sku || null]);
    await c.query('INSERT INTO stock(product_id, station_id, quantity) VALUES ($1,$2,0)', [p.id, req.sid]);
    for (const [type, price] of [['sell', b.sell_price], ['buy', b.buy_price]]) await recordPriceChange(c, { station: req.sid, product: p.id, type, oldPrice: null, newPrice: price, by: req.user.id, note: 'Prix à la création du produit' });
    if (b.initial_stock > 0) await stockMove(c, { station: req.sid, product: p.id, kind: 'entree', qty: b.initial_stock, comment: 'Stock initial', by: req.user.id });
    await audit(c, req, 'produits', 'Création de ' + b.name, 'products', p.id, null, b);
    return p;
  });
  res.status(201).json(maskCost(req, p));
}));
// Modification (prix inclus) : l'ancienne et la nouvelle valeur sont tracées
r.patch('/products/:id', need('price.edit'), body(z.object({
  name: z.string().min(1),
  unit: z.string(),
  buy_price: z.number().min(0),
  sell_price: z.number().min(0),
  tax_rate: z.number().min(0),
  min_stock: z.number().min(0),
  active: z.boolean(),
  category: z.string().min(1), // code catégorie → résolu en category_id
  barcode: z.string().max(64).nullable(),
  sku: z.string().max(64).nullable(),
}).partial().strict()), wrap(async (req, res) => {
  if (req.body.buy_price !== undefined && !canCost(req)) throw new HttpError(403, "Permission refusée : cost.view (le prix d'achat est réservé aux rôles de gestion)");
  const body = { ...req.body };
  if (body.category !== undefined) {
    const { rows: [cat] } = await pool.query('SELECT id, code FROM categories WHERE code = $1', [body.category]);
    if (!cat) throw new HttpError(400, 'Catégorie inconnue : ' + body.category);
    body.category_id = cat.id;
    delete body.category;
  }
  const keys = Object.keys(body);
  if (!keys.length) throw new HttpError(400, 'Aucun champ à modifier');
  const out = await tx(async c => {
    const { rows: [old] } = await c.query('SELECT * FROM products WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
    if (!old) throw new HttpError(404, 'Produit introuvable');
    const { rows: [n] } = await c.query(
      `UPDATE products SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE id = $1 AND station_id = $2 RETURNING *`,
      [old.id, req.sid, ...keys.map(k => body[k])]
    );
    await audit(c, req, 'produits', 'Modification de ' + old.name, 'products', old.id,
      Object.fromEntries(keys.map(k => [k, old[k]])), body);
    // Historique des prix : toute variation du prix de vente ou d'achat est datée et attribuée
    for (const [field, type] of [['sell_price', 'sell'], ['buy_price', 'buy']]) {
      if (body[field] !== undefined) await recordPriceChange(c, { station: req.sid, product: old.id, type, oldPrice: old[field], newPrice: n[field], by: req.user.id, note: 'Modification de la fiche produit' });
    }
    return n;
  });
  res.json(maskCost(req, out));
}));

// ---------- Pompes et compteurs (compteur → produit paramétrable) ----------
r.get('/pumps', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pu.*, COALESCE(json_agg(json_build_object('id', pc.id, 'counter_number', pc.counter_number, 'product_id', pc.product_id, 'product', pr.name, 'current_index', pc.current_index)
            ORDER BY pc.counter_number) FILTER (WHERE pc.id IS NOT NULL), '[]') AS counters
       FROM pumps pu LEFT JOIN pump_counters pc ON pc.pump_id = pu.id LEFT JOIN products pr ON pr.id = pc.product_id
      WHERE pu.station_id = $1 AND pu.deleted_at IS NULL GROUP BY pu.id ORDER BY pu.number`, [req.sid]);
  res.json(rows);
}));
r.post('/pumps', need('settings.edit'), body(z.object({
  number: z.number().int().positive(), name: z.string().min(1), location: z.string().optional(),
  counters: z.array(z.object({ counter_number: z.number().int().positive(), product_id: z.number().int(), current_index: z.number().min(0).default(0) })).min(1),
})), wrap(async (req, res) => {
  const b = req.body;
  const p = await tx(async c => {
    const { rows: [p] } = await c.query('INSERT INTO pumps(station_id, number, name, location) VALUES ($1,$2,$3,$4) RETURNING *', [req.sid, b.number, b.name, b.location || null]);
    for (const k of b.counters) {
      const { rowCount } = await c.query('INSERT INTO pump_counters(pump_id, counter_number, product_id, current_index) SELECT $1,$2,id,$4 FROM products WHERE id = $3 AND station_id = $5', [p.id, k.counter_number, k.product_id, k.current_index, req.sid]);
      if (!rowCount) throw new HttpError(400, 'Produit inconnu pour le compteur ' + k.counter_number);
    }
    await audit(c, req, 'pompes', 'Création de ' + b.name, 'pumps', p.id, null, b);
    return p;
  });
  res.status(201).json(p);
}));
// Modifier une pompe comme à sa création (numéro, nom, emplacement, statut, produit des compteurs) — chaque changement est historisé
r.patch('/pumps/:pumpId', need('settings.edit'), body(z.object({
  number: z.number().int().positive().optional(),
  name: z.string().trim().min(1).optional(),
  location: z.string().trim().optional(),
  status: z.enum(['active', 'inactive', 'maintenance']).optional(),
  counters: z.array(z.object({ counter_number: z.number().int().positive(), product_id: z.number().int() })).optional(),
  reason: z.string().trim().max(500).optional(),
})), wrap(async (req, res) => {
  const b = req.body;
  const out = await tx(async c => {
    const { rows: [old] } = await c.query('SELECT * FROM pumps WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE', [req.params.pumpId, req.sid]);
    if (!old) throw new HttpError(404, 'Pompe introuvable');
    const before = {}, after = {};
    for (const k of ['number', 'name', 'location', 'status']) {
      if (b[k] === undefined) continue;
      const nv = k === 'location' ? (b[k] || null) : b[k];
      if (String(nv ?? '') !== String(old[k] ?? '')) { before[k] = old[k]; after[k] = nv; }
    }
    if (after.number !== undefined) {
      const { rowCount } = await c.query('SELECT 1 FROM pumps WHERE station_id = $1 AND number = $2 AND id <> $3 AND deleted_at IS NULL', [req.sid, after.number, old.id]);
      if (rowCount) throw new HttpError(409, 'Une autre pompe porte déjà le numéro ' + after.number);
    }
    if (Object.keys(after).length) {
      await c.query('UPDATE pumps SET number = $2, name = $3, location = $4, status = $5 WHERE id = $1 AND station_id = $6',
        [old.id, after.number ?? old.number, after.name ?? old.name, 'location' in after ? after.location : old.location, after.status ?? old.status, req.sid]);
    }
    const cb = {}, ca = {};
    for (const k of (b.counters || [])) {
      const { rows: [cur] } = await c.query('SELECT pc.*, pr.name AS product FROM pump_counters pc JOIN products pr ON pr.id = pc.product_id WHERE pc.pump_id = $1 AND pc.counter_number = $2 FOR UPDATE OF pc', [old.id, k.counter_number]);
      const { rows: [np] } = await c.query('SELECT id, name FROM products WHERE id = $1 AND station_id = $2', [k.product_id, req.sid]);
      if (!np) throw new HttpError(400, 'Produit inconnu pour le compteur ' + k.counter_number);
      if (!cur) {   // ajout d'un compteur (ex. 2e compteur), index de départ 0
        const { rows: [nc] } = await c.query('INSERT INTO pump_counters(pump_id, counter_number, product_id, current_index) VALUES ($1,$2,$3,0) RETURNING id', [old.id, k.counter_number, np.id]);
        await c.query('INSERT INTO pump_counter_history(counter_id, product_id, changed_by) VALUES ($1,$2,$3)', [nc.id, np.id, req.user.id]);
        ca['compteur_' + k.counter_number] = np.name; cb['compteur_' + k.counter_number] = null;
      } else if (Number(cur.product_id) !== Number(np.id)) {
        const { rows: [open] } = await c.query("SELECT 1 FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
        if (open) throw new HttpError(409, 'Clôturez le quart avant de changer le produit d\'un compteur');
        await c.query('UPDATE pump_counters SET product_id = $2 WHERE id = $1', [cur.id, np.id]);
        await c.query('INSERT INTO pump_counter_history(counter_id, product_id, changed_by) VALUES ($1,$2,$3)', [cur.id, np.id, req.user.id]);
        cb['compteur_' + k.counter_number] = cur.product; ca['compteur_' + k.counter_number] = np.name;
      }
    }
    const nb = { ...before, ...cb }, na = { ...after, ...ca };
    if (!Object.keys(na).length) throw new HttpError(400, 'Aucune modification à enregistrer');
    if (b.reason) na.reason = b.reason;
    await audit(c, req, 'pompes', 'Modification de la pompe ' + (after.name || old.name), 'pumps', old.id, nb, na);
    return { ok: true, changes: Object.keys(na).filter(k => k !== 'reason') };
  });
  res.json(out);
}));
// Historique des modifications des pompes (création, modification, correction d'index, changement de produit)
r.get('/pumps/history', need('settings.edit', 'shift.open', 'report.view'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.created_at, a.action, a.table_name, a.record_id, a.old_value, a.new_value, u.login
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.station_id = $1 AND a.module = 'pompes'
      ORDER BY a.id DESC LIMIT $2`, [req.sid, Math.min(+req.query.limit || 100, 300)]);
  res.json(rows);
}));
// Changer le produit d'un compteur : impossible pendant un quart ouvert, historisé
r.put('/pumps/:pumpId/counters/:n', need('settings.edit'), body(z.object({ product_id: z.number().int() })), wrap(async (req, res) => {
  await tx(async c => {
    const { rows: [open] } = await c.query("SELECT 1 FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    if (open) throw new HttpError(409, 'Clôturez le quart avant de modifier la configuration des compteurs');
    const { rows: [k] } = await c.query(
      `SELECT pc.* FROM pump_counters pc JOIN pumps pu ON pu.id = pc.pump_id WHERE pu.id = $1 AND pu.station_id = $2 AND pc.counter_number = $3 FOR UPDATE OF pc`, [req.params.pumpId, req.sid, req.params.n]);
    if (!k) throw new HttpError(404, 'Compteur introuvable');
    const { rowCount } = await c.query('SELECT 1 FROM products WHERE id = $1 AND station_id = $2', [req.body.product_id, req.sid]);
    if (!rowCount) throw new HttpError(400, 'Produit inconnu');
    await c.query('UPDATE pump_counters SET product_id = $2 WHERE id = $1', [k.id, req.body.product_id]);
    await c.query('INSERT INTO pump_counter_history(counter_id, product_id, changed_by) VALUES ($1,$2,$3)', [k.id, req.body.product_id, req.user.id]);
    await audit(c, req, 'pompes', `Compteur ${k.counter_number} de la pompe ${req.params.pumpId} : nouveau produit`, 'pump_counters', k.id, { product_id: k.product_id }, { product_id: req.body.product_id });
  });
  res.json({ ok: true });
}));

// Correction manuelle de l'index d'un compteur (erreurs de saisie) — toujours auditée
r.patch('/pumps/:pumpId/counters/:n/index', need('settings.edit'), body(z.object({
  current_index: z.number().min(0),
  reason: z.string().trim().min(3).max(500),
})), wrap(async (req, res) => {
  const pumpId = +req.params.pumpId;
  const n = +req.params.n;
  const { current_index, reason } = req.body;
  const result = await tx(async c => {
    const { rows: [k] } = await c.query(
      `SELECT pc.*, pu.name AS pump_name
         FROM pump_counters pc
         JOIN pumps pu ON pu.id = pc.pump_id
        WHERE pu.id = $1 AND pu.station_id = $2 AND pc.counter_number = $3
        FOR UPDATE OF pc`,
      [pumpId, req.sid, n]
    );
    if (!k) throw new HttpError(404, 'Compteur introuvable');
    const oldIndex = Number(k.current_index);
    if (oldIndex === current_index) throw new HttpError(400, 'Le nouvel index est identique à l\'index actuel');
    const { rows: [open] } = await c.query(
      "SELECT number FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]
    );
    await c.query('UPDATE pump_counters SET current_index = $2 WHERE id = $1', [k.id, current_index]);
    await audit(c, req, 'pompes',
      `Correction index compteur ${k.counter_number} (${k.pump_name}) : ${oldIndex} → ${current_index}` +
      (open ? ` [quart ouvert N° ${open.number}]` : ''),
      'pump_counters', k.id,
      { current_index: oldIndex },
      { current_index, reason, open_shift: open ? open.number : null }
    );
    return {
      ok: true,
      counter_id: k.id,
      pump_id: pumpId,
      counter_number: k.counter_number,
      pump_name: k.pump_name,
      old_index: oldIndex,
      new_index: current_index,
      reason,
      warning: open
        ? `Attention : un quart est ouvert (N° ${open.number}). L'index a été corrigé ; vérifiez les lectures du quart en cours.`
        : null,
    };
  });
  res.json(result);
}));

// ---------- Employés ----------
r.get('/employees', need('settings.edit', 'shift.open', 'report.view'), wrap(async (req, res) => {
  const hr = req.user.perms.has('hr.manage') || req.user.perms.has('hr.payroll');
  const { rows } = await pool.query(
    `SELECT e.id, e.station_id, e.user_id, e.matricule, e.last_name, e.first_name, e.phone, e.email, e.address,
            e.position, e.hired_on, e.status, e.photo_path, e.notes,
            ${hr ? 'e.base_salary, e.contract_type, e.contract_start, e.contract_end,' : ''}
            u.login AS user_login, u.active AS user_active
     FROM employees e
     LEFT JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL
     WHERE e.station_id = $1 AND e.deleted_at IS NULL
       AND ($2::text = 'all' OR ($2::text = 'inactif' AND e.status = 'inactif') OR ($2::text = 'actif' AND e.status <> 'inactif'))
     ORDER BY e.last_name, e.first_name`, [req.sid, ['actif', 'inactif', 'all'].includes(req.query.status) ? req.query.status : 'actif']);
  res.json(rows);
}));
// IMPORTANT : cette route doit rester AVANT '/employees/:id' — sinon Express interprète « unlinked » comme un id
// (400 « Identifiant employé invalide ») et la liste des employés sans compte arrive toujours vide.
r.get('/employees/unlinked', need('user.manage', 'settings.edit'), wrap(async (req, res) => {
  // Par défaut : station active. ?scope=client = toutes les stations du même client (isolation préservée).
  const scopeClient = String(req.query.scope || '') === 'client';
  let rows;
  if (scopeClient && !req.user.is_global) {
    const { rows: st } = await pool.query(
      `SELECT client_id FROM stations WHERE id = $1`, [req.sid]
    );
    const clientId = st[0]?.client_id;
    if (!clientId) {
      const r = await pool.query(
        `SELECT id, matricule, first_name, last_name, position, status, phone, station_id
         FROM employees
         WHERE station_id = $1 AND deleted_at IS NULL AND user_id IS NULL AND status = 'actif'
         ORDER BY last_name, first_name`, [req.sid]);
      rows = r.rows;
    } else {
      // Uniquement les stations déjà accessibles à l'utilisateur (user_stations) — pas d'élargissement de périmètre.
      const r = await pool.query(
        `SELECT e.id, e.matricule, e.first_name, e.last_name, e.position, e.status, e.phone, e.station_id, s.name AS station_name
           FROM employees e
           JOIN stations s ON s.id = e.station_id
           JOIN user_stations us ON us.station_id = e.station_id AND us.user_id = $2
          WHERE s.client_id = $1 AND e.deleted_at IS NULL AND e.user_id IS NULL AND e.status = 'actif'
          ORDER BY s.name, e.last_name, e.first_name`, [clientId, req.user.id]);
      rows = r.rows;
    }
  } else {
    const r = await pool.query(
      `SELECT id, matricule, first_name, last_name, position, status, phone, station_id
       FROM employees
       WHERE station_id = $1 AND deleted_at IS NULL AND user_id IS NULL AND status = 'actif'
       ORDER BY last_name, first_name`, [req.sid]);
    rows = r.rows;
  }
  res.json(rows);
}));

r.get('/employees/:id(\\d+)', need('settings.edit', 'shift.open', 'report.view', 'hr.manage'), wrap(async (req, res) => {
  const id = +req.params.id;
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant employé invalide');
  const hr = req.user.perms.has('hr.manage') || req.user.perms.has('hr.payroll');
  const { rows: [e] } = await pool.query(
    `SELECT e.id, e.station_id, e.user_id, e.matricule, e.last_name, e.first_name, e.phone, e.email, e.address,
            e.position, e.hired_on, e.status, e.photo_path, e.notes,
            ${hr ? 'e.base_salary, e.contract_type, e.contract_start, e.contract_end,' : ''}
            u.login AS user_login, u.active AS user_active
     FROM employees e
     LEFT JOIN users u ON u.id = e.user_id AND u.deleted_at IS NULL
     WHERE e.id = $1 AND e.station_id = $2 AND e.deleted_at IS NULL`, [id, req.sid]);
  if (!e) throw new HttpError(404, 'Employé introuvable');
  res.json(e);
}));

r.patch('/employees/:id', need('settings.edit', 'hr.manage'), body(z.object({
  matricule: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  first_name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  position: z.string().min(1).optional(),
  status: z.enum(['actif', 'inactif']).optional(),
  notes: z.string().optional().nullable(),
  hired_on: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const id = +req.params.id;
  const { rows: [old] } = await pool.query(
    `SELECT * FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL`, [id, req.sid]);
  if (!old) throw new HttpError(404, 'Employé introuvable');
  const b = req.body;
  const fields = [];
  const vals = [id, req.sid];
  const map = {
    matricule: 'matricule', last_name: 'last_name', first_name: 'first_name',
    phone: 'phone', email: 'email', address: 'address', position: 'position',
    status: 'status', notes: 'notes', hired_on: 'hired_on'
  };
  for (const [k, col] of Object.entries(map)) {
    if (b[k] !== undefined) {
      vals.push(b[k] === '' ? null : b[k]);
      fields.push(`${col}=$${vals.length}`);
    }
  }
  if (!fields.length) return res.json(old);
  const { rows: [n] } = await pool.query(
    `UPDATE employees SET ${fields.join(', ')}, updated_at=now() WHERE id=$1 AND station_id=$2 RETURNING *`, vals);
  if (b.position !== undefined && String(b.position || '') !== String(old.position || '')) await require('./role_sync').syncFromEmployee(pool, req, n.id, n.position);
  if (b.first_name !== undefined || b.last_name !== undefined) await require('./role_sync').syncNameFromEmployee(pool, n.id);
  await audit(pool, req, 'employés', `Modification employé ${n.first_name} ${n.last_name}`, 'employees', n.id, old, b);
  res.json(n);
}));

r.post('/employees', need('settings.edit'), body(z.object({
  matricule: z.string().min(1), last_name: z.string().min(1), first_name: z.string().min(1), phone: z.string().optional(),
  position: z.string().min(1), hired_on: z.string().optional(),
  // user_id n'est plus accepté à la création : le compte s'octroie ensuite via /users
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [e] } = await pool.query(
    'INSERT INTO employees(station_id, matricule, last_name, first_name, phone, position, hired_on) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [req.sid, b.matricule, b.last_name, b.first_name, b.phone || null, b.position, b.hired_on || null]);
  await audit(pool, req, 'employés', `Création de ${b.first_name} ${b.last_name} (sans compte utilisateur)`, 'employees', e.id, null, b);
  res.status(201).json(e);
}));

// Activer / désactiver un employé (seule action qui suspend tout, y compris le compte lié)
r.patch('/employees/:id/status', need('settings.edit', 'hr.manage'), body(z.object({
  status: z.enum(['actif', 'inactif']),
  reason: z.string().min(3).optional()
})), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [old] } = await c.query(
      `SELECT * FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id, req.sid]);
    if (!old) throw new HttpError(404, 'Employé introuvable');
    const { rows: [n] } = await c.query(
      `UPDATE employees SET status = $3 WHERE id = $1 AND station_id = $2 RETURNING *`,
      [old.id, req.sid, req.body.status]);
    // Si inactif + compte lié → désactiver le compte et révoquer sessions
    if (req.body.status === 'inactif' && old.user_id) {
      await c.query('UPDATE users SET active = false WHERE id = $1', [old.user_id]);
      await c.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [old.user_id]);
    }
    // Réactivation employé : ne réactive PAS automatiquement le compte (choix explicite du gérant)
    await audit(c, req, 'employés',
      `${req.body.status === 'actif' ? 'Réactivation' : 'Mise en inactif'} de ${old.first_name} ${old.last_name}` +
      (req.body.reason ? ' — ' + req.body.reason : ''),
      'employees', old.id, { status: old.status }, { status: req.body.status });
    return n;
  });
  res.json(out);
}));

/** Révoquer l'accès compte (suspendre login) sans rendre l'employé inactif — il peut continuer à être affecté aux quarts. */
r.post('/employees/:id/revoke-access', need('user.manage'), body(z.object({
  reason: z.string().min(3)
})), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [e] } = await c.query(
      `SELECT * FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id, req.sid]);
    if (!e) throw new HttpError(404, 'Employé introuvable');
    if (!e.user_id) throw new HttpError(409, 'Cet employé n\'a pas de compte utilisateur');
    await c.query('UPDATE users SET active = false WHERE id = $1', [e.user_id]);
    await c.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [e.user_id]);
    await audit(c, req, 'utilisateurs', `Révocation accès compte employé ${e.first_name} ${e.last_name} : ${req.body.reason}`, 'users', e.user_id, null, { employee_id: e.id });
    return { employee_id: e.id, user_id: e.user_id, access: false };
  });
  res.json(out);
}));

/** Réactiver l'accès compte d'un employé actif déjà lié. */
r.post('/employees/:id/grant-access', need('user.manage'), body(z.object({
  reason: z.string().min(3).optional()
})), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [e] } = await c.query(
      `SELECT * FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [req.params.id, req.sid]);
    if (!e) throw new HttpError(404, 'Employé introuvable');
    if (e.status === 'inactif') throw new HttpError(409, 'Réactivez d\'abord la fiche employé (statut actif)');
    if (!e.user_id) throw new HttpError(409, 'Aucun compte lié — créez un utilisateur en sélectionnant cet employé');
    await c.query('UPDATE users SET active = true, failed_logins = 0 WHERE id = $1', [e.user_id]);
    await audit(c, req, 'utilisateurs', `Rétablissement accès compte employé ${e.first_name} ${e.last_name}`, 'users', e.user_id, null, { employee_id: e.id });
    return { employee_id: e.id, user_id: e.user_id, access: true };
  });
  res.json(out);
}));

/** Réinitialisation du mot de passe depuis la fiche employé.
 * Le mot de passe temporaire est affiché une seule fois, jamais journalisé;
 * le compte et la fiche doivent déjà être actifs. Toutes les sessions sont révoquées.
 */
r.post('/employees/:id/reset-password', need('user.manage'), body(z.object({
  reason: z.string().min(3).max(500)
})), wrap(async (req, res) => {
  const targetId = Number(req.params.id);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) throw new HttpError(400, 'Identifiant employé invalide');
  const out = await tx(async c => {
    const { rows: [e] } = await c.query(
      `SELECT id, station_id, user_id, first_name, last_name, status
         FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [targetId, req.sid]);
    if (!e) throw new HttpError(404, 'Employé introuvable sur cette station');
    if (e.status === 'inactif') throw new HttpError(409, 'Réactivez d’abord la fiche employé avant de réinitialiser son mot de passe');
    if (!e.user_id) throw new HttpError(409, 'Cet employé ne possède aucun compte utilisateur lié');
    const { rows: [u] } = await c.query(
      `SELECT id, is_global, active FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [e.user_id]);
    if (!u || u.is_global) throw new HttpError(403, 'Ce compte ne peut pas être réinitialisé depuis une fiche employé');
    if (!u.active) throw new HttpError(409, 'Le compte est désactivé. Utilisez d’abord « Rétablir l’accès » si la réactivation est autorisée.');
    const temporaryPassword = crypto.randomBytes(12).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await c.query(
      `UPDATE users SET password_hash = $2, failed_logins = 0, lockout_until = NULL WHERE id = $1`,
      [u.id, passwordHash]);
    await c.query('UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    await audit(c, req, 'utilisateurs', `Réinitialisation du mot de passe de ${e.first_name} ${e.last_name} : ${req.body.reason}`, 'users', u.id,
      { employee_id: e.id, password_reset: false }, { employee_id: e.id, password_reset: true, sessions_revoked: true });
    return { employee_id: e.id, user_id: u.id, temporary_password: temporaryPassword, sessions_revoked: true };
  });
  res.json(out);
}));

// ---------- Clients ----------
r.get('/customers', need('customer.view', 'sale.create'), wrap(async (req, res) => {
  const inactive = req.query.inactive === '1' || req.query.inactive === 'true';
  const { rows } = await pool.query('SELECT * FROM customers WHERE station_id = $1 AND deleted_at IS NULL AND active = $2 ORDER BY name', [req.sid, !inactive]);
  res.json(maskRecv(req, rows));
}));
// Archiver (inactif) / réactiver un client — aucune donnée supprimée, l'historique et le solde sont conservés
r.patch('/customers/:id/status', need('customer.edit'), body(z.object({ active: z.boolean(), reason: z.string().trim().max(300).optional() })), wrap(async (req, res) => {
  const { rows: [c] } = await pool.query(
    `UPDATE customers SET active = $3, deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END
      WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL RETURNING id, name, active`,
    [req.params.id, req.sid, req.body.active]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  await audit(pool, req, 'clients', (c.active ? 'Réactivation' : 'Mise en inactif') + ' du client ' + c.name + (req.body.reason ? ' — ' + req.body.reason : ''), 'customers', c.id, null, { active: c.active });
  res.json(c);
}));
r.post('/customers', need('customer.edit'), body(z.object({
  kind: z.enum(['particulier', 'entreprise', 'professionnel', 'credit']),
  name: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  credit_limit: z.number().min(0).default(0),
  notes: z.string().optional().nullable(),
  loyalty_tier: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [cu] } = await pool.query(
    `INSERT INTO customers(station_id, kind, name, phone, email, address, company, tax_id, credit_limit, notes, loyalty_tier)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.sid, b.kind, b.name, b.phone || null, b.email || null, b.address || null, b.company || null, b.tax_id || null,
     b.credit_limit, b.notes || null, b.loyalty_tier || 'standard']);
  await audit(pool, req, 'clients', 'Création de ' + b.name, 'customers', cu.id, null, b);
  res.status(201).json(cu);
}));

r.delete('/customers/:id', need('customer.delete'), wrap(async (req, res) => {
  const { rows: [c] } = await pool.query(
    `UPDATE customers SET deleted_at = now() WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL RETURNING id, name`,
    [req.params.id, req.sid]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  await audit(pool, req, 'clients', 'Suppression client ' + c.name, 'customers', c.id);
  res.json({ ok: true, id: c.id });
}));


// ---------- Profil client enrichi (P3) ----------
r.get('/customers/:id', need('customer.view', 'sale.create'), wrap(async (req, res) => {
  const { rows: [c] } = await pool.query(
    'SELECT * FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  res.json(maskRecv(req, c));
}));

r.patch('/customers/:id', need('customer.edit'), body(z.object({
  kind: z.enum(['particulier', 'entreprise', 'professionnel', 'credit']).optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  credit_limit: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  loyalty_tier: z.string().optional().nullable(),
  credit_blocked: z.boolean().optional()
})), wrap(async (req, res) => {
  const keys = Object.keys(req.body);
  if (!keys.length) throw new HttpError(400, 'Aucun champ');
  const { rows: [old] } = await pool.query('SELECT * FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!old) throw new HttpError(404, 'Client introuvable');
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const { rows: [n] } = await pool.query(
    `UPDATE customers SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND station_id=$2 RETURNING *`,
    [req.params.id, req.sid, ...keys.map(k => req.body[k])]
  );
  await audit(pool, req, 'clients', 'Modification client ' + n.name, 'customers', n.id, old, req.body);
  res.json(n);
}));

r.get('/customers/:id/history', need('customer.view', 'sale.create'), wrap(async (req, res) => {
  const id = +req.params.id;
  const { rows: [c] } = await pool.query('SELECT id, name, balance, credit_limit FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [id, req.sid]);
  if (!c) throw new HttpError(404, 'Client introuvable');
  const canR = req.user.perms.has('receivable.view');
  const [sales, pays, credits, invs, invPays, cnt] = await Promise.all([
    pool.query(
      `SELECT s.id, s.invoice_no, s.sold_at, s.total, s.status, NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') AS employee,
              (SELECT COALESCE(SUM(l.amount), 0) FROM customer_ledger l WHERE l.ref_table = 'sales' AND l.ref_id = s.id AND l.kind = 'credit') AS credit_amount
         FROM sales s LEFT JOIN employees e ON e.id = s.employee_id
       WHERE s.station_id=$1 AND s.customer_id=$2 ORDER BY s.id DESC LIMIT 200`, [req.sid, id]),
    pool.query(
      `SELECT p.id, p.method, p.amount, p.paid_at, p.reference, p.sale_id FROM payments p
       JOIN sales s ON s.id = p.sale_id WHERE p.station_id=$1 AND s.customer_id=$2
       ORDER BY p.id DESC LIMIT 50`, [req.sid, id]).catch(swallow('catalog:607', { rows: [] })),
    canR ? pool.query(
      `SELECT id, amount, remaining, reason, status, created_at FROM customer_credits
       WHERE station_id=$1 AND customer_id=$2 ORDER BY id DESC LIMIT 20`, [req.sid, id]).catch(swallow('catalog:610', { rows: [] })) : Promise.resolve({ rows: [] }),
    // Factures du module Facturation rattachées à CE client (customer_id) : toujours visibles dans son profil, avec leur état.
    pool.query(
      `SELECT i.id, i.invoice_no, i.status, i.issued_on, i.due_date, i.total_ttc, i.amount_paid,
              GREATEST(i.total_ttc - i.amount_paid, 0) AS balance, i.created_at, i.sale_id
         FROM invoices i WHERE i.station_id=$1 AND i.customer_id=$2 ORDER BY i.id DESC LIMIT 300`, [req.sid, id]).catch(swallow('catalog:615', { rows: [] })),
    pool.query(
      `SELECT ip.id, ip.invoice_id, i.invoice_no, ip.method, ip.amount, ip.paid_at, ip.reference
         FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
        WHERE i.station_id=$1 AND i.customer_id=$2 ORDER BY ip.id DESC LIMIT 300`, [req.sid, id]).catch(swallow('catalog:619', { rows: [] })),
    pool.query(
      `SELECT (SELECT COUNT(*)::int FROM sales WHERE station_id=$1 AND customer_id=$2) AS sales,
              (SELECT COUNT(*)::int FROM invoices WHERE station_id=$1 AND customer_id=$2) AS invoices`, [req.sid, id]).catch(swallow('catalog:622', { rows: [{ sales: null, invoices: null }] }))
  ]);
  // Sans droit « créances », les montants dus restent masqués (comme le solde du client).
  const invoices = invs.rows.map(x => (canR ? x : { ...x, amount_paid: null, balance: null }));
  const live = invs.rows.filter(x => x.status !== 'annulee');
  res.json({
    customer: maskRecv(req, c),
    sales: sales.rows.map(x => (canR ? x : { ...x, credit_amount: null })),   // montants à crédit masqués sans le droit « créances »
    payments: pays.rows,
    credits: credits.rows,
    invoices,
    invoice_payments: canR ? invPays.rows : [],
    summary: {
      invoices_count: invs.rows.length, invoices_total_count: cnt.rows[0].invoices, sales_total_count: cnt.rows[0].sales,
      invoiced_total: live.reduce((a, x) => a + Number(x.total_ttc || 0), 0),
      invoiced_balance: canR ? live.reduce((a, x) => a + Number(x.balance || 0), 0) : null,
      balance_due: canR ? c.balance : null,
      credit_limit: canR ? c.credit_limit : null,
      sales_count: sales.rows.length,
      note: 'Historique station courante uniquement (isolation multi-client).'
    }
  });
}));

r.post('/customers/:id/credits', need('customer.edit'), body(z.object({
  amount: z.number().positive(),
  reason: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const out = await tx(async db => {
    const { rows: [c] } = await db.query('SELECT id FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!c) throw new HttpError(404, 'Client introuvable');
    const { rows: [cr] } = await db.query(
      `INSERT INTO customer_credits(station_id, customer_id, amount, remaining, reason, created_by)
       VALUES ($1,$2,$3,$3,$4,$5) RETURNING *`,
      [req.sid, c.id, req.body.amount, req.body.reason || null, req.user.id]
    );
    const { applied } = await applyCustomerCredits(db, { station: req.sid, customerId: c.id, by: req.user.id });
    await audit(db, req, 'clients', `Avoir client ${c.id} +${req.body.amount} (imputé ${applied})`, 'customer_credits', cr.id, null, req.body);
    const { rows: [fresh] } = await db.query('SELECT * FROM customer_credits WHERE id=$1', [cr.id]);
    return { ...fresh, applied, note: applied > 0 ? `Avoir imputé sur la créance : ${applied}.` : 'Avoir enregistré (aucune créance à réduire pour l’instant).' };
  });
  res.status(201).json(out);
}));

// Impute les avoirs encore ouverts du client sur sa créance actuelle.
r.post('/customers/:id/credits/apply', need('customer.edit'), wrap(async (req, res) => {
  const out = await tx(async db => {
    const r1 = await applyCustomerCredits(db, { station: req.sid, customerId: Number(req.params.id), by: req.user.id });
    await audit(db, req, 'clients', `Imputation des avoirs client ${req.params.id} : ${r1.applied}`, 'customers', Number(req.params.id), null, r1);
    return r1;
  });
  res.json(out);
}));

// ---------- Imputation manuelle des avoirs client (choix de la dette, du montant, de la date et du motif) ----------
const fl2 = n => Math.round(Number(n) * 100) / 100;
// Dettes actives d'un client : factures émises / partiellement payées + éventuelle créance globale (solde client non couvert par une facture).
async function customerActiveDebts(db, station, customerId) {
  const { rows: [cu] } = await db.query('SELECT id, balance FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [customerId, station]);
  if (!cu) throw new HttpError(404, 'Client introuvable');
  const { rows: invs } = await db.query(
    `SELECT id, invoice_no, status, issued_on, due_date, total_ttc, amount_paid, sale_id, source,
            (total_ttc - amount_paid) AS remaining
       FROM invoices WHERE station_id=$1 AND customer_id=$2 AND status IN ('emise','partielle') AND total_ttc - amount_paid > 0.004
      ORDER BY COALESCE(issued_on, created_at::date), id`, [station, customerId]);
  const coveredByInvoices = invs.filter(i => i.sale_id || i.source === 'fleet').reduce((a, i) => a + Number(i.remaining), 0);
  const globalRemaining = Math.max(0, fl2(Number(cu.balance) - coveredByInvoices));
  return { customer: cu, invoices: invs, globalRemaining };
}

r.get('/customers/:id/credit-imputations', need('customer.edit', 'receivable.view'), wrap(async (req, res) => {
  const id = +req.params.id;
  const d = await customerActiveDebts(pool, req.sid, id);
  const [{ rows: [av] }, { rows: hist }] = await Promise.all([
    pool.query(`SELECT COALESCE(SUM(remaining),0) AS v FROM customer_credits WHERE station_id=$1 AND customer_id=$2 AND status='ouvert' AND remaining>0`, [req.sid, id]),
    pool.query(
      `SELECT a.id, a.applied_on, a.amount, a.reason, a.created_at, a.credit_id, a.invoice_id, i.invoice_no,
              cr.reason AS credit_reason, u.login AS by_login
         FROM customer_credit_applications a
         LEFT JOIN invoices i ON i.id = a.invoice_id
         LEFT JOIN customer_credits cr ON cr.id = a.credit_id
         LEFT JOIN users u ON u.id = a.created_by
        WHERE a.station_id=$1 AND a.customer_id=$2 ORDER BY a.applied_on DESC, a.id DESC LIMIT 200`, [req.sid, id])
  ]);
  res.json({
    credits_available: fl2(av.v),
    debts: [
      ...d.invoices.map(i => ({ kind: 'invoice', invoice_id: Number(i.id), label: `Facture ${i.invoice_no || '#' + i.id}${i.due_date ? ' · éch. ' + String(i.due_date).slice(0, 10) : ''}`, remaining: fl2(i.remaining) })),
      ...(d.globalRemaining > 0.004 ? [{ kind: 'global', invoice_id: null, label: 'Créance globale du client (hors facture)', remaining: d.globalRemaining }] : [])
    ],
    history: hist
  });
}));

r.post('/customers/:id/credits/impute', need('customer.edit'), body(z.object({
  applied_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invoice_id: z.number().int().positive().nullable().optional(),
  amount: z.number().positive(),
  reason: z.string().trim().min(3, 'Motif obligatoire (3 caractères minimum)').max(300)
})), wrap(async (req, res) => {
  const b = req.body, custId = +req.params.id;
  const today = new Date().toISOString().slice(0, 10);
  const appliedOn = b.applied_on || today;
  if (Number.isNaN(new Date(appliedOn + 'T00:00:00Z').getTime()) || new Date(appliedOn + 'T00:00:00Z').toISOString().slice(0, 10) !== appliedOn) throw new HttpError(400, 'Date invalide');
  if (appliedOn > today) throw new HttpError(400, 'La date d’imputation ne peut pas être dans le futur.');
  const amount = fl2(b.amount);
  const out = await tx(async db => {
    const { rows: [cu] } = await db.query('SELECT id, name, balance FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [custId, req.sid]);
    if (!cu) throw new HttpError(404, 'Client introuvable');
    const { rows: credits } = await db.query(
      `SELECT * FROM customer_credits WHERE station_id=$1 AND customer_id=$2 AND status='ouvert' AND remaining>0 ORDER BY id FOR UPDATE`, [req.sid, custId]);
    const available = fl2(credits.reduce((a, c) => a + Number(c.remaining), 0));
    if (amount > available + 0.004) throw new HttpError(409, `Montant supérieur aux avoirs disponibles (${available}).`);

    // Dette visée
    let inv = null, touchesBalance = true;
    if (b.invoice_id) {
      const { rows: [i] } = await db.query(
        `SELECT * FROM invoices WHERE id=$1 AND station_id=$2 AND customer_id=$3 FOR UPDATE`, [b.invoice_id, req.sid, custId]);
      if (!i) throw new HttpError(404, 'Facture introuvable pour ce client');
      if (!['emise', 'partielle'].includes(i.status)) throw new HttpError(409, 'Cette facture n’est plus une dette active.');
      const rest = fl2(Number(i.total_ttc) - Number(i.amount_paid));
      if (amount > rest + 0.009) throw new HttpError(400, `Montant supérieur au reste dû sur la facture (${rest}).`);
      inv = i; touchesBalance = !!i.sale_id;      // facture issue d'une vente à crédit : la créance du client baisse aussi
    } else {
      const d = await customerActiveDebts(db, req.sid, custId);
      if (amount > d.globalRemaining + 0.009) throw new HttpError(400, `Montant supérieur à la créance globale hors facture (${d.globalRemaining}).`);
    }
    if (touchesBalance && amount > Number(cu.balance) + 0.009) throw new HttpError(409, `Montant supérieur à la dette actuelle du client (${cu.balance}).`);

    // Consommation des avoirs, du plus ancien au plus récent
    let left = amount;
    for (const cr of credits) {
      if (left <= 0.004) break;
      const y = fl2(Math.min(Number(cr.remaining), left));
      const rem = fl2(Number(cr.remaining) - y);
      await db.query('UPDATE customer_credits SET remaining=$2, status=$3 WHERE id=$1 AND station_id=$4', [cr.id, rem, rem <= 0.004 ? 'utilise' : 'ouvert', req.sid]);
      await db.query(
        `INSERT INTO customer_credit_applications(station_id, customer_id, credit_id, invoice_id, amount, applied_on, reason, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8)`, [req.sid, custId, cr.id, inv ? inv.id : null, y, appliedOn, b.reason, req.user.id]);
      if (touchesBalance) await ledger(db, { customer: custId, station: req.sid, kind: 'avoir', amount: -y, ref: ['customer_credits', cr.id], by: req.user.id });
      try {
        await recordFinancialEvent(db, { station: req.sid, event_type: 'AUTRE', direction: 'neutral', amount: y, label: 'Avoir client imputé' + (inv ? ' sur facture ' + inv.invoice_no : ' sur la créance'),
          method: 'avoir', customer_id: custId, ref: ['customer_credits', cr.id], by: req.user.id, description: 'Imputation manuelle : ' + b.reason, event_at: appliedOn + 'T12:00:00Z' });
      } catch (e) { if (e.code !== '42P01') throw e; }
      left = fl2(left - y);
    }
    if (touchesBalance) await db.query('UPDATE customers SET balance = balance - $2 WHERE id=$1 AND station_id=$3', [custId, amount, req.sid]);
    if (inv) {
      await db.query(
        `INSERT INTO invoice_payments(invoice_id, station_id, amount, method, reference, created_by, paid_at)
         VALUES ($1,$2,$3,'avoir',$4,$5,($6::date + LOCALTIME)::timestamptz)`, [inv.id, req.sid, amount, 'Imputation d’avoir', req.user.id, appliedOn]);
      const paid = fl2(Number(inv.amount_paid) + amount);
      await db.query('UPDATE invoices SET amount_paid=$2, status=$3, updated_at=now() WHERE id=$1 AND station_id=$4',
        [inv.id, paid, paid >= Number(inv.total_ttc) - 0.009 ? 'payee' : 'partielle', req.sid]);
    }
    await audit(db, req, 'clients', `Imputation manuelle d’avoir client ${cu.name} : ${amount}${inv ? ' sur ' + inv.invoice_no : ''}`, 'customers', custId, null, { ...b, applied_on: appliedOn });
    return { applied: amount, credits_left: fl2(available - amount) };
  });
  res.status(201).json(out);
}));

// ---------- Fournisseurs profil + historique ----------

r.get('/suppliers/:id', need('supplier.view', 'purchase.manage', 'purchase.pay', 'stock.adjust'), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    'SELECT * FROM suppliers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!s) throw new HttpError(404, 'Fournisseur introuvable');
  res.json(maskDebt(req, s));
}));

r.patch('/suppliers/:id', need('supplier.edit'), body(z.object({
  name: z.string().min(1).optional(),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  contact: z.string().optional().nullable(),
  tax_id: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payment_terms_days: z.number().int().min(0).optional(),
  bank_info: z.string().optional().nullable(),
  active: z.boolean().optional()
})), wrap(async (req, res) => {
  const keys = Object.keys(req.body);
  if (!keys.length) throw new HttpError(400, 'Aucun champ');
  const { rows: [old] } = await pool.query('SELECT * FROM suppliers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [req.params.id, req.sid]);
  if (!old) throw new HttpError(404, 'Fournisseur introuvable');
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const { rows: [n] } = await pool.query(
    `UPDATE suppliers SET ${sets.join(', ')}, updated_at=now() WHERE id=$1 AND station_id=$2 RETURNING *`,
    [req.params.id, req.sid, ...keys.map(k => req.body[k])]
  );
  await audit(pool, req, 'fournisseurs', 'Modification fournisseur ' + n.name, 'suppliers', n.id, old, req.body);
  res.json(n);
}));

r.get('/suppliers/:id/history', need('supplier.view', 'purchase.manage', 'purchase.pay', 'stock.adjust'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'Identifiant fournisseur invalide');
  const { rows: [s] } = await pool.query('SELECT id, name, balance_due FROM suppliers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL', [id, req.sid]);
  if (!s) throw new HttpError(404, 'Fournisseur introuvable');
  // Utiliser la table métier réelle `purchases` (et non l'ancienne table inexistante `purchase_orders`).
  const { rows: purchases } = await pool.query(
    `SELECT pu.id, pu.order_no, pu.status, pu.total, pu.ordered_at, pu.ordered_at AS created_at, pu.invoice_no,
            pu.invoice_total, pu.paid, pu.due_date, pu.invoice_date
     FROM purchases pu
     WHERE pu.station_id=$1 AND pu.supplier_id=$2
     ORDER BY pu.id DESC LIMIT 300`, [req.sid, id]);
  const { rows: [pc] } = await pool.query('SELECT COUNT(*)::int AS n FROM purchases WHERE station_id=$1 AND supplier_id=$2', [req.sid, id]);
  const canFinancial = req.user.perms.has('debt.view') || req.user.perms.has('purchase.pay') || req.user.perms.has('finance.view');
  const [payments, credits] = await Promise.all([
    canFinancial ? pool.query(
      `SELECT sp.id, sp.purchase_id, sp.amount, sp.method, sp.paid_at, pu.order_no
       FROM supplier_payments sp JOIN purchases pu ON pu.id=sp.purchase_id
       WHERE sp.supplier_id=$1 AND pu.station_id=$2 AND pu.supplier_id=$1
       ORDER BY sp.id DESC LIMIT 100`, [id, req.sid]).catch(swallow('catalog:838', { rows: [] })) : Promise.resolve({ rows: [] }),
    req.user.perms.has('debt.view') ? pool.query(
      `SELECT id, amount, remaining, reason, status, created_at FROM supplier_credits
       WHERE station_id=$1 AND supplier_id=$2 ORDER BY id DESC LIMIT 20`, [req.sid, id]).catch(swallow('catalog:841', { rows: [] })) : Promise.resolve({ rows: [] })
  ]);
  res.json({
    supplier: maskDebt(req, s),
    purchases,
    payments: payments.rows || [],
    credits: credits.rows || [],
    summary: { balance_due: req.user.perms.has('debt.view') ? s.balance_due : null, purchases_total_count: pc.n, note: 'Historique isolé par station.' }
  });
}));



r.post('/suppliers/:id/credits', need('supplier.edit'), body(z.object({
  amount: z.number().positive(),
  reason: z.string().optional().nullable()
})), wrap(async (req, res) => {
  const out = await tx(async db => {
    const { rows: [sp] } = await db.query('SELECT id FROM suppliers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [req.params.id, req.sid]);
    if (!sp) throw new HttpError(404, 'Fournisseur introuvable');
    const { rows: [cr] } = await db.query(
      `INSERT INTO supplier_credits(station_id, supplier_id, amount, remaining, reason, created_by)
       VALUES ($1,$2,$3,$3,$4,$5) RETURNING *`,
      [req.sid, sp.id, req.body.amount, req.body.reason || null, req.user.id]);
    const { applied } = await applySupplierCredits(db, { station: req.sid, supplierId: sp.id, by: req.user.id });
    await audit(db, req, 'fournisseurs', `Avoir fournisseur ${sp.id} +${req.body.amount} (imputé ${applied})`, 'supplier_credits', cr.id, null, req.body);
    const { rows: [fresh] } = await db.query('SELECT * FROM supplier_credits WHERE id=$1', [cr.id]);
    return { ...fresh, applied, note: applied > 0 ? `Avoir imputé sur les factures ouvertes : ${applied}.` : 'Avoir enregistré : il sera imputé automatiquement sur la prochaine facture.' };
  });
  res.status(201).json(out);
}));

// Impute les avoirs encore ouverts du fournisseur sur ses factures impayées.
r.post('/suppliers/:id/credits/apply', need('supplier.edit'), wrap(async (req, res) => {
  const out = await tx(async db => {
    const r1 = await applySupplierCredits(db, { station: req.sid, supplierId: Number(req.params.id), by: req.user.id });
    await audit(db, req, 'fournisseurs', `Imputation des avoirs fournisseur ${req.params.id} : ${r1.applied}`, 'suppliers', Number(req.params.id), null, r1);
    return r1;
  });
  res.json(out);
}));

r.patch('/suppliers/:id/status', need('supplier.edit'), body(z.object({ active: z.boolean(), reason: z.string().trim().max(300).optional() })), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    `UPDATE suppliers SET active = $3, deactivated_at = CASE WHEN $3 THEN NULL ELSE now() END
      WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL RETURNING id, name, active`,
    [req.params.id, req.sid, req.body.active]);
  if (!s) throw new HttpError(404, 'Fournisseur introuvable');
  await audit(pool, req, 'fournisseurs', (s.active ? 'Réactivation' : 'Mise en inactif') + ' du fournisseur ' + s.name + (req.body.reason ? ' — ' + req.body.reason : ''), 'suppliers', s.id, null, { active: s.active });
  res.json(s);
}));
r.delete('/suppliers/:id', need('supplier.delete'), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query(
    `UPDATE suppliers SET deleted_at = now(), active = false WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL RETURNING id, name`,
    [req.params.id, req.sid]);
  if (!s) throw new HttpError(404, 'Fournisseur introuvable');
  await audit(pool, req, 'fournisseurs', 'Suppression fournisseur ' + s.name, 'suppliers', s.id);
  res.json({ ok: true, id: s.id });
}));

module.exports = r;
