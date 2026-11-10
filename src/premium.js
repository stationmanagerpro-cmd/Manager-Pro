// Modules abonnement activables : réconciliation, clôture période, historique prix,
// reçus, demandes de renouvellement, packs. Tout désactivable via features.modules.
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { featureOn, loadContractForUser, needPrincipal } = require('./contracts');

const r = express.Router();

function requireModule(code) {
  return wrap(async (req, res, next) => {
    if (req.user.is_global) return next();
    if (!req.contract) {
      try {
        req.contract = await loadContractForUser(req.user.id, req.user.is_global);
      } catch (_) { req.contract = { unrestricted: true }; }
    }
    if (req.contract.unrestricted) return next();
    if (req.contract.suspended) throw new HttpError(403, 'Licence suspendue ou expirée.');
    if (!featureOn(req.contract, 'module:' + code)) {
      throw new HttpError(403, `Module « ${code} » non inclus dans votre abonnement. Contactez l'administrateur.`);
    }
    next();
  });
}

// ---------- Packs (catalogue) ----------
r.get('/admin/packs', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM subscription_packs WHERE active ORDER BY sort_order, id`
  ).catch(swallow('premium:31', { rows: [] }));
  res.json(rows);
}));

const packSchema = z.object({
  code: z.string().min(2).max(60).regex(/^[a-zA-Z0-9_-]+$/),
  label: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  duration_unit: z.enum(['day','month','year','indefinite']),
  duration_value: z.number().int().positive().nullable().optional(),
  max_users: z.number().int().positive().nullable().optional(),
  max_stations: z.number().int().positive().nullable().optional(),
  price_label: z.string().max(120).optional().nullable(),
  modules: z.array(z.string().min(1).max(80)).max(100),
  active: z.boolean().optional(),
  sort_order: z.number().int().optional()
});
function packFeatures(modules) {
  const known = ['sales','stock','finance','reports','receipts','hr','reconcile','period_lock','price_history','personalization'];
  return { modules: { ...Object.fromEntries(known.map(m => [m, false])), ...Object.fromEntries(modules.map(m => [m, true])) } };
}
r.put('/admin/packs/:code', needPrincipal, body(packSchema), wrap(async (req, res) => {
  const d = req.body;
  if (d.code !== req.params.code) throw new HttpError(400, 'Le code ne peut pas être changé ici.');
  const { rows: [row] } = await pool.query(
    `UPDATE subscription_packs SET label=$2, description=$3, duration_unit=$4, duration_value=$5,
     max_users=$6, max_stations=$7, price_label=$8, features=$9::jsonb, active=COALESCE($10,active),
     sort_order=COALESCE($11,sort_order) WHERE code=$1 RETURNING *`,
    [d.code,d.label,d.description||null,d.duration_unit,d.duration_unit==='indefinite'?null:(d.duration_value||1),d.max_users??null,d.max_stations??null,d.price_label||null,JSON.stringify(packFeatures(d.modules)),d.active,d.sort_order]
  );
  if (!row) throw new HttpError(404, 'Pack introuvable');
  await audit(pool, req, 'abonnements', `Offre ${d.code} modifiée`, 'subscription_packs', row.id);
  res.json(row);
}));
r.post('/admin/packs', needPrincipal, body(packSchema), wrap(async (req, res) => {
  const d = req.body;
  const { rows: [row] } = await pool.query(
    `INSERT INTO subscription_packs(code,label,description,duration_unit,duration_value,max_users,max_stations,price_label,features,active,sort_order)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,COALESCE($10,true),COALESCE($11,100)) RETURNING *`,
    [d.code,d.label,d.description||null,d.duration_unit,d.duration_unit==='indefinite'?null:(d.duration_value||1),d.max_users??null,d.max_stations??null,d.price_label||null,JSON.stringify(packFeatures(d.modules)),d.active,d.sort_order]
  );
  await audit(pool, req, 'abonnements', `Offre ${d.code} créée`, 'subscription_packs', row.id);
  res.status(201).json(row);
}));

r.get('/packs', wrap(async (req, res) => {
  // Visible aux clients pour comparer (lecture seule)
  const { rows } = await pool.query(
    `SELECT code, label, description, duration_unit, duration_value, max_users, max_stations, price_label, features
     FROM subscription_packs WHERE active ORDER BY sort_order`
  ).catch(swallow('premium:81', { rows: [] }));
  res.json(rows);
}));

r.post('/admin/clients/:id/apply-pack', needPrincipal, body(z.object({
  pack_code: z.string().min(1)
})), wrap(async (req, res) => {
  const clientId = +req.params.id;
  const { rows: [pack] } = await pool.query(
    `SELECT * FROM subscription_packs WHERE code = $1 AND active`, [req.body.pack_code]
  );
  if (!pack) throw new HttpError(404, 'Pack introuvable');
  const features = pack.features || {};
  const { rows: [existing] } = await pool.query('SELECT features FROM client_contracts WHERE client_id = $1', [clientId]);
  const oldFeatures = existing?.features || {};
  const oldModules = oldFeatures.modules || {};
  const packModules = features.modules || {};
  // Le pack définit ses modules ; les modules spéciaux propres au client sont conservés.
  features.modules = { ...oldModules, ...packModules };
  await pool.query(
    `UPDATE client_contracts SET
       pack_code = $2,
       features = $3::jsonb,
       max_users = COALESCE($4, max_users),
       max_stations = COALESCE($5, max_stations),
       updated_at = now(), updated_by = $6
     WHERE client_id = $1`,
    [clientId, pack.code, JSON.stringify(features), pack.max_users, pack.max_stations, req.user.id]
  );
  await audit(pool, req, 'abonnements', `Pack ${pack.code} appliqué client #${clientId}`, 'client_contracts', clientId, null, { pack: pack.code });
  const { loadContract } = require('./contracts');
  res.json({ ok: true, pack: pack.code, license: await loadContract(clientId) });
}));

// ---------- Clôture de période ----------
r.get('/period-locks', need('report.view', 'shift.close', 'settings.edit'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM period_locks WHERE station_id = $1 AND unlocked_at IS NULL ORDER BY period_key DESC LIMIT 60`,
    [req.sid]
  ).catch(swallow('premium:120', { rows: [] }));
  res.json(rows);
}));

r.post('/period-locks', need('shift.close', 'settings.edit'), requireModule('period_lock'), body(z.object({
  period_type: z.enum(['day', 'month']),
  period_key: z.string().min(7).max(10),
  note: z.string().max(500).optional().nullable()
})), wrap(async (req, res) => {
  const { period_type, period_key, note } = req.body;
  if (period_type === 'day' && !/^\d{4}-\d{2}-\d{2}$/.test(period_key)) throw new HttpError(400, 'period_key jour = YYYY-MM-DD');
  if (period_type === 'month' && !/^\d{4}-\d{2}$/.test(period_key)) throw new HttpError(400, 'period_key mois = YYYY-MM');
  const { rows: [row] } = await pool.query(
    `INSERT INTO period_locks(station_id, period_type, period_key, locked_by, note)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (station_id, period_type, period_key)
     DO UPDATE SET unlocked_at = NULL, unlocked_by = NULL, unlock_reason = NULL,
                   locked_at = now(), locked_by = $4, note = $5
     RETURNING *`,
    [req.sid, period_type, period_key, req.user.id, note || null]
  );
  await audit(pool, req, 'cloture', `Clôture ${period_type} ${period_key}`, 'period_locks', row.id);
  res.status(201).json(row);
}));

r.post('/period-locks/:id/unlock', need('settings.edit'), requireModule('period_lock'), body(z.object({
  reason: z.string().min(3).max(500)
})), wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE period_locks SET unlocked_at = now(), unlocked_by = $2, unlock_reason = $3
     WHERE id = $1 AND station_id = $4 AND unlocked_at IS NULL RETURNING *`,
    [+req.params.id, req.user.id, req.body.reason, req.sid]
  );
  if (!row) throw new HttpError(404, 'Clôture introuvable ou déjà ouverte');
  await audit(pool, req, 'cloture', `Déverrouillage période #${row.id}`, 'period_locks', row.id, null, { reason: req.body.reason });
  res.json(row);
}));

/** Vérifie si une date tombe dans une période verrouillée */
async function assertNotLocked(stationId, at = new Date()) {
  const day = at.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const { rows } = await pool.query(
    `SELECT period_type, period_key FROM period_locks
     WHERE station_id = $1 AND unlocked_at IS NULL
       AND ((period_type = 'day' AND period_key = $2) OR (period_type = 'month' AND period_key = $3))
     LIMIT 1`,
    [stationId, day, month]
  ).catch(swallow('premium:168', { rows: [] }));
  if (rows[0]) {
    throw new HttpError(423, `Période clôturée (${rows[0].period_type} ${rows[0].period_key}). Impossible de modifier.`);
  }
}

// ---------- Historique des prix ----------
r.get('/products/:id/price-history', need('report.view', 'price.edit'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.*, u.login FROM price_history h
     LEFT JOIN users u ON u.id = h.created_by
     WHERE h.station_id = $1 AND h.product_id = $2
     ORDER BY h.effective_from DESC LIMIT 50`,
    [req.sid, +req.params.id]
  ).catch(swallow('premium:182', { rows: [] }));
  res.json(rows);
}));

r.post('/products/:id/price', need('price.edit'), requireModule('price_history'), body(z.object({
  price: z.number().nonnegative(),
  effective_from: z.string().optional(),
  note: z.string().max(300).optional().nullable()
})), wrap(async (req, res) => {
  const productId = +req.params.id;
  const from = req.body.effective_from ? new Date(req.body.effective_from) : new Date();
  const out = await tx(async c => {
    await c.query(
      `UPDATE price_history SET effective_to = $1
       WHERE station_id = $2 AND product_id = $3 AND effective_to IS NULL`,
      [from.toISOString(), req.sid, productId]
    );
    const { rows: [h] } = await c.query(
      `INSERT INTO price_history(station_id, product_id, price, effective_from, created_by, note)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.sid, productId, req.body.price, from.toISOString(), req.user.id, req.body.note || null]
    );
    // B2 (audit 2026-11-03) : la colonne réelle est products.sell_price (sale_price/price n'existent pas).
    // Si le produit n'appartient pas à la station, tout est annulé (historique inclus).
    const upd = await c.query(
      `UPDATE products SET sell_price = $1 WHERE id = $2 AND station_id = $3`,
      [req.body.price, productId, req.sid]
    );
    if (!upd.rowCount) throw new HttpError(404, 'Produit introuvable');
    return h;
  });
  await audit(pool, req, 'prix', `Prix produit #${productId} → ${req.body.price}`, 'products', productId);
  res.status(201).json(out);
}));

// ---------- Réconciliation pompes / ventes / stock ----------
r.post('/reconcile/run', need('report.view', 'shift.close'), requireModule('reconcile'), body(z.object({
  shift_id: z.number().int().optional().nullable(),
  from: z.string().optional(),
  to: z.string().optional()
}).optional()), wrap(async (req, res) => {
  const s = req.sid;
  const shiftId = req.body?.shift_id || null;
  const gaps = [];
  let status = 'ok';

  // B2 (audit 2026-11-03, CORR-037) : requêtes alignées sur le schéma réel et erreurs NON avalées
  // (un résultat « ok » ne doit jamais cacher une requête en échec).
  // Tolérance pompé / vendu : RECONCILE_TOLERANCE_PCT % des litres pompés (défaut 0,5), jamais sous 0,5 L ;
  // écart critique au-delà de 5 fois cette tolérance.
  const tolPct = Math.max(0, Number(process.env.RECONCILE_TOLERANCE_PCT ?? 0.5)) || 0.5;
  const from = req.body?.from || new Date(Date.now() - 864e5).toISOString();
  const to = req.body?.to || new Date().toISOString();
  // Périmètre : un quart précis, ou les quarts fermés de la période.
  const scope = shiftId
    ? { sh: 'sh.id = $2', sa: 'sa.shift_id = $2', args: [s, shiftId] }
    : { sh: "sh.status = 'ferme' AND sh.closed_at >= $2 AND sh.closed_at <= $3", sa: 'sa.shift_id IN (SELECT sh.id FROM shifts sh WHERE sh.station_id = $1 AND sh.status = \'ferme\' AND sh.closed_at >= $2 AND sh.closed_at <= $3)', args: [s, from, to] };

  // Pompes actives (information du résumé)
  const { rows: pumps } = await pool.query(
    `SELECT p.id, p.name, c.id AS counter_id, c.current_index, c.product_id, pr.name AS product_name
     FROM pumps p
     JOIN pump_counters c ON c.pump_id = p.id
     LEFT JOIN products pr ON pr.id = c.product_id
     WHERE p.station_id = $1 AND p.status = 'active' AND p.deleted_at IS NULL`, [s]);

  // Litres pompés (compteurs des quarts, index final renseigné)
  const { rows: pumpedRows } = await pool.query(
    `SELECT mr.product_id, pr.name AS product_name, COALESCE(SUM(mr.liters), 0) AS liters
       FROM meter_readings mr
       JOIN shifts sh ON sh.id = mr.shift_id AND sh.station_id = $1
       JOIN products pr ON pr.id = mr.product_id
      WHERE ${scope.sh} AND mr.index_end IS NOT NULL
      GROUP BY mr.product_id, pr.name`, scope.args);

  // Litres vendus (ventes carburant valides ; les ventes annulées sont exclues)
  const { rows: salesFuel } = await pool.query(
    `SELECT d.product_id, COALESCE(SUM(d.quantity), 0) AS qty
       FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
      WHERE sa.station_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' AND ${scope.sa}
      GROUP BY d.product_id`, scope.args);
  const salesMap = Object.fromEntries(salesFuel.map(x => [x.product_id, +x.qty]));

  // Stock bas (la quantité est dans la table stock)
  const { rows: low } = await pool.query(
    `SELECT p.id, p.name, st.quantity, p.min_stock FROM products p
       JOIN stock st ON st.product_id = p.id AND st.station_id = p.station_id
      WHERE p.station_id = $1 AND p.deleted_at IS NULL AND p.min_stock > 0 AND st.quantity < p.min_stock
      LIMIT 30`, [s]);

  for (const p of low) {
    gaps.push({ type: 'STOCK', level: 'warning', message: `Stock bas : ${p.name} (${p.quantity}/${p.min_stock})`, product_id: p.id });
    status = status === 'ok' ? 'warning' : status;
  }

  // Pompé (compteurs) vs vendu (ventes carburant), par produit
  for (const row of pumpedRows) {
    const pumped = Math.round(Number(row.liters) * 1000) / 1000;
    const sold = Math.round((salesMap[row.product_id] || 0) * 1000) / 1000;
    const diff = Math.round((pumped - sold) * 1000) / 1000;
    const tol = Math.max(0.5, Math.abs(pumped) * tolPct / 100);
    if (Math.abs(diff) > tol) {
      const critical = Math.abs(diff) > 5 * tol;
      gaps.push({
        type: 'POMPE_VENTE', level: critical ? 'critical' : 'warning',
        message: `${row.product_name || 'Produit'} : pompé ${pumped} L, vendu ${sold} L, écart ${diff} L (tolérance ${Math.round(tol * 1000) / 1000} L)`,
        product_id: row.product_id, pumped, sold, diff, tolerance: tol
      });
      status = critical ? 'critical' : (status === 'critical' ? 'critical' : 'warning');
    }
  }

  const summary = {
    pumps: pumps.length,
    products_sold: salesFuel.length,
    products_pumped: pumpedRows.length,
    tolerance_pct: tolPct,
    low_stock: low.length,
    gaps: gaps.length,
    shift_id: shiftId
  };

  const { rows: [run] } = await pool.query(
    `INSERT INTO reconciliation_runs(station_id, shift_id, status, summary, gaps, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING *`,
    [s, shiftId, status, JSON.stringify(summary), JSON.stringify(gaps), req.user.id]
  ).catch(swallow('premium:317', { rows: [{ status, summary, gaps, id: null }] }));

  // Pousser alertes dans notifications si écarts
  for (const g of gaps.filter(x => x.level === 'critical').slice(0, 5)) {
    await pool.query(
      `INSERT INTO notifications(station_id, kind, level, message) VALUES ($1,'anomalie','critical',$2)`,
      [s, g.message]
    ).catch(() => {});
  }

  res.status(201).json(run.id ? run : { status, summary, gaps });
}));

r.get('/reconcile/runs', need('report.view'), requireModule('reconcile'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, shift_id, status, summary, created_at FROM reconciliation_runs
     WHERE station_id = $1 ORDER BY created_at DESC LIMIT 30`, [req.sid]
  ).catch(swallow('premium:334', { rows: [] }));
  res.json(rows);
}));

r.get('/reconcile/runs/:id', need('report.view'), requireModule('reconcile'), wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT * FROM reconciliation_runs WHERE id = $1 AND station_id = $2`,
    [+req.params.id, req.sid]
  );
  if (!row) throw new HttpError(404, 'Réconciliation introuvable');
  res.json(row);
}));

// ---------- Reçu / ticket de vente (texte simple imprimable) ----------
r.get('/sales/:id/receipt', need('sale.create', 'report.view'), requireModule('receipts'), wrap(async (req, res) => {
  const { rows: [sale] } = await pool.query(
    `SELECT sa.*, e.first_name || ' ' || e.last_name AS employee_name, st.name AS station_name
     FROM sales sa
     LEFT JOIN employees e ON e.id = sa.employee_id
     LEFT JOIN stations st ON st.id = sa.station_id
     WHERE sa.id = $1 AND sa.station_id = $2 AND sa.status = 'valide'`,   // sales n'a pas de deleted_at : l'annulation passe par status
    [+req.params.id, req.sid]
  );
  if (!sale) throw new HttpError(404, 'Vente introuvable');
  const { rows: items } = await pool.query(
    `SELECT si.*, p.name AS product_name FROM sale_details si
     LEFT JOIN products p ON p.id = si.product_id WHERE si.sale_id = $1 ORDER BY si.id`, [sale.id]
  );
  const { rows: pays } = await pool.query(
    `SELECT * FROM payments WHERE sale_id = $1 AND station_id = $2 ORDER BY id`, [sale.id, req.sid]
  );

  const lines = [];
  lines.push(sale.station_name || 'Station');
  lines.push('--------------------------------');
  lines.push(`Ticket #${sale.id}  ${sale.sold_at ? new Date(sale.sold_at).toLocaleString('fr-FR') : ''}`);
  if (sale.employee_name) lines.push(`Agent : ${sale.employee_name}`);
  lines.push('--------------------------------');
  for (const it of items) {
    lines.push(`${it.product_name || 'Article'}  x${it.quantity}  ${Number(it.amount ?? it.line_total ?? it.total ?? 0).toLocaleString('fr-FR')}`);
  }
  lines.push('--------------------------------');
  lines.push(`TOTAL  ${Number(sale.total || 0).toLocaleString('fr-FR')} FCFA`);
  for (const p of pays) {
    lines.push(`  ${p.method || p.payment_method || 'paiement'} : ${Number(p.amount).toLocaleString('fr-FR')}`);
  }
  lines.push('--------------------------------');
  lines.push('Merci de votre visite');

  res.json({
    sale_id: sale.id,
    text: lines.join('\n'),
    html: `<pre style="font-family:monospace;font-size:13px;width:280px">${lines.map(l => String(l).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')).join('\n')}</pre>`,
    total: sale.total,
    items,
    payments: pays
  });
}));

// ---------- Demandes de renouvellement ----------
r.post('/license/renewal-request', body(z.object({
  message: z.string().max(1000).optional().nullable(),
  preferred_duration_unit: z.enum(['day','month','year','indefinite']).optional(),
  preferred_duration_value: z.number().int().positive().optional()
})), wrap(async (req, res) => {
  if (req.user.is_global) throw new HttpError(400, 'Réservé aux comptes clients');
  const contract = await loadContractForUser(req.user.id, false);
  if (!contract.client_id) throw new HttpError(400, 'Aucun client lié à ce compte');
  const { rows: [row] } = await pool.query(
    `INSERT INTO license_renewal_requests(client_id, requested_by, message, preferred_duration_unit, preferred_duration_value)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [contract.client_id, req.user.id, req.body.message || null,
     req.body.preferred_duration_unit || null, req.body.preferred_duration_value || null]
  );
  await audit(pool, req, 'licences', `Demande renouvellement client #${contract.client_id}`, 'license_renewal_requests', row.id);
  res.status(201).json(row);
}));

r.get('/admin/renewal-requests', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.*, c.name AS client_name, u.login AS requester_login
     FROM license_renewal_requests r
     JOIN clients c ON c.id = r.client_id
     LEFT JOIN users u ON u.id = r.requested_by
     ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
     LIMIT 100`
  ).catch(swallow('premium:420', { rows: [] }));
  res.json(rows);
}));

r.post('/admin/renewal-requests/:id/handle', needPrincipal, body(z.object({
  status: z.enum(['accepted', 'rejected']),
  admin_note: z.string().max(500).optional().nullable()
})), wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE license_renewal_requests SET status = $2, handled_by = $3, handled_at = now(), admin_note = $4
     WHERE id = $1 AND status = 'pending' RETURNING *`,
    [+req.params.id, req.body.status, req.user.id, req.body.admin_note || null]
  );
  if (!row) throw new HttpError(404, 'Demande introuvable ou déjà traitée');
  await audit(pool, req, 'licences', `Demande #${row.id} → ${req.body.status}`, 'license_renewal_requests', row.id);
  res.json(row);
}));

// ---------- Modules disponibles (pour UI cases à cocher) ----------
r.get('/modules/catalog', wrap(async (req, res) => {
  res.json([
    { code: 'sales', label: 'Ventes', description: 'Point de vente, carburant, produits' },
    { code: 'stock', label: 'Stocks / Achats', description: 'Produits, fournisseurs, mouvements, seuils' },
    { code: 'finance', label: 'Finance / Caisse', description: 'Caisse, dépenses, liquidités' },
    { code: 'reports', label: 'Rapports', description: 'Exports PDF / Excel, pilotage' },
    { code: 'hr', label: 'RH / Paie', description: 'Employés, bulletins, ITS/INPS/AMO' },
    { code: 'reconcile', label: 'Réconciliation pompes', description: 'Écarts pompes ↔ ventes ↔ stock', premium: true },
    { code: 'period_lock', label: 'Clôture de période', description: 'Verrouillage jour / mois', premium: true },
    { code: 'receipts', label: 'Tickets / reçus', description: 'Impression ticket 80 mm', premium: true },
    { code: 'price_history', label: 'Historique des prix', description: 'Tarifs carburant datés', premium: true },
    { code: 'personalization', label: 'Personnalisation', description: 'Logo, signature, apparence' },
    { code: 'payroll_amo', label: 'Paie — AMO', description: 'Cotisations maladie', premium: true },
    { code: 'payroll_inps', label: 'Paie — INPS', description: 'Sécurité sociale', premium: true },
    { code: 'payroll_its', label: 'Paie — ITS', description: 'Impôt sur les traitements et salaires', premium: true },
    { code: 'payroll_charges', label: 'Paie — charges patronales', description: 'Calcul des charges patronales', premium: true },
    { code: 'messaging', label: 'Messagerie', description: 'Échanges entre utilisateurs et support' },
    { code: 'auto_alerts', label: 'Alertes automatiques', description: 'Notifications + rapports programmés', premium: true },
    { code: 'billing', label: 'Facturation clients', description: 'Factures multi-lignes, PDF, paiements' },
    { code: 'report_colors', label: 'Couleurs rapports', description: 'Personnalisation visuelle des exports' },
    { code: 'fiscal', label: 'Fiscalité', description: 'Module fiscalité (parcours client)', premium: true },
    { code: 'fiscal_tva', label: 'Fiscalité — TVA', description: 'Sous-module TVA', premium: true },
    { code: 'fiscal_synthetique', label: 'Fiscalité — Impôt synthétique', description: 'Sous-module', premium: true },
    { code: 'fiscal_ibic', label: 'Fiscalité — IBIC', description: 'Sous-module', premium: true },
    { code: 'fiscal_is', label: 'Fiscalité — IS', description: 'Sous-module sociétés', premium: true },
    { code: 'fiscal_its', label: 'Fiscalité — ITS déclaratif', description: 'Sous-module', premium: true },
    { code: 'fiscal_cfe', label: 'Fiscalité — CFE / patente', description: 'Sous-module', premium: true },
    { code: 'fiscal_tfp', label: 'Fiscalité — TFP', description: 'Sous-module', premium: true },
    { code: 'fiscal_logement', label: 'Fiscalité — Taxe logement', description: 'Sous-module', premium: true },
    { code: 'fiscal_retenues', label: 'Fiscalité — Retenues', description: 'Sous-module', premium: true },
    { code: 'fiscal_autres', label: 'Fiscalité — Autres', description: 'Autres impôts / taxes', premium: true },
    { code: 'accounting', label: 'Comptabilité OHADA', description: 'Journaux, grand livre, balance, résultat, bilan', premium: true },
    { code: 'accounting_entries', label: 'Comptabilité — Saisie d’écritures', description: 'Écritures manuelles et à-nouveaux', premium: true },
    { code: 'accounting_assets', label: 'Comptabilité — Immobilisations', description: 'Immobilisations et amortissements', premium: true },
    { code: 'accounting_vat', label: 'Comptabilité — TVA', description: 'État de TVA collectée / déductible', premium: true },
    { code: 'accounting_closing', label: 'Comptabilité — Exercices et clôture', description: 'Exercices comptables et clôture', premium: true },
    { code: 'accounting_export', label: 'Comptabilité — Export', description: 'Export CSV des journaux et de la balance', premium: true }
  ]);
}));

module.exports = { r, requireModule, assertNotLocked };
