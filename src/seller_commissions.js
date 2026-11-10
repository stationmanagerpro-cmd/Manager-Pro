/**
 * Commissions vendeurs / pompistes
 * - Objectifs + taux (défaut station / personnalisés employé)
 * - Modes : always | if_target_met | on_surplus
 * - Calcul sur ventes validées (sales.employee_id)
 * - Figage période (kind=commission), primes, règlements partiels
 * - Permissions : commission.own (lecture perso), commission.manage (gestion)
 * - Contrat : modules.seller_commissions, employee_portal_commissions
 */
const express = require('express');
const { z } = require('zod');
const { pool, tx, fl, HttpError, wrap, body, need, audit } = require('./core');

const r = express.Router();

const DEFAULTS = {
  default_rate: 3,
  default_target: 400000,
  commission_mode: 'always' // always | if_target_met | on_surplus
};

function canViewCommissions(req) {
  const p = req.user && req.user.perms;
  if (!p) return false;
  return p.has('commission.own') || p.has('commission.manage')
    || p.has('report.view') || p.has('hr.view') || p.has('settings.edit')
    || p.has('hr.manage') || p.has('hr.payroll');
}

function canViewTeam(req) {
  const p = req.user && req.user.perms;
  if (!p) return false;
  return p.has('commission.manage') || p.has('report.view') || p.has('hr.view')
    || p.has('settings.edit') || p.has('hr.manage') || p.has('hr.payroll');
}

function canManageCommissions(req) {
  const p = req.user && req.user.perms;
  if (!p) return false;
  return p.has('commission.manage') || p.has('settings.edit') || p.has('hr.manage') || p.has('hr.payroll');
}

function assertContractAllows(req, { team = false } = {}) {
  const c = req.contract;
  if (!c || c.unrestricted) return;
  const f = c.features || {};
  const mods = f.modules || {};
  if (mods.seller_commissions === false || mods.seller_commissions === 'false' || mods.seller_commissions === 0) {
    throw new HttpError(403, 'Module commissions vendeurs non inclus dans votre contrat.', { code: 'FEATURE_DISABLED', feature: 'seller_commissions' });
  }
  if (!team) {
    const portal = f.employee_portal_commissions;
    if (portal === false || portal === 'false' || portal === 0) {
      throw new HttpError(403, 'Portail commissions employés non inclus dans votre contrat.', { code: 'FEATURE_DISABLED', feature: 'employee_portal_commissions' });
    }
  }
}

async function resolveOwnEmployeeId(req) {
  const { rows } = await pool.query(
    `SELECT id FROM employees
      WHERE station_id = $1 AND user_id = $2 AND deleted_at IS NULL
      ORDER BY id LIMIT 1`,
    [req.sid, req.user.id]
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * Activation du module : DÉSACTIVÉ par défaut (aucune ligne = désactivé), état durable dans settings
 * (key = 'seller_module_enabled'), propre à chaque station. Tant qu'il est désactivé, aucune route opérationnelle
 * du module n'est exécutée et la paie ne reprend plus de commissions.
 */
async function isModuleActive(db, stationId) {
  const { rows } = await (db || pool).query("SELECT value FROM settings WHERE station_id = $1 AND key = 'seller_module_enabled'", [stationId]);
  if (!rows.length) return false;
  const v = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : (rows[0].value || {});
  return v.enabled === true;
}
async function assertModuleActive(req) {
  if (!(await isModuleActive(pool, req.sid))) {
    throw new HttpError(403, 'Le module Vendeurs & commissions est désactivé. Activez-le depuis son interface pour l’utiliser.', { code: 'MODULE_DISABLED', feature: 'seller_commissions_module' });
  }
}

const requireView = wrap(async (req, res, next) => {
  if (!canViewCommissions(req)) throw new HttpError(403, 'Permission refusée : commission.own ou commission.manage');
  assertContractAllows(req, { team: canViewTeam(req) });
  await assertModuleActive(req);
  next();
});

const requireManage = wrap(async (req, res, next) => {
  if (!canManageCommissions(req)) throw new HttpError(403, 'Permission refusée : commission.manage');
  assertContractAllows(req, { team: true });
  await assertModuleActive(req);
  next();
});

// État du module (lisible par tout profil qui voit le module) et bascule explicite (gestionnaires uniquement)
r.get('/seller-commissions/module', wrap(async (req, res) => {
  if (!canViewCommissions(req)) throw new HttpError(403, 'Permission refusée : commission.own ou commission.manage');
  assertContractAllows(req, { team: canViewTeam(req) });
  const { rows } = await pool.query("SELECT value FROM settings WHERE station_id = $1 AND key = 'seller_module_enabled'", [req.sid]);
  const v = rows.length ? (typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : (rows[0].value || {})) : {};
  res.json({ enabled: v.enabled === true, changed_at: v.changed_at || null, changed_by: v.changed_by_name || null, can_toggle: canManageCommissions(req) });
}));

r.put('/seller-commissions/module', wrap(async (req, res, next) => {
  if (!canManageCommissions(req)) throw new HttpError(403, 'Permission refusée : commission.manage');
  assertContractAllows(req, { team: true });
  next();
}), body(z.object({ enabled: z.boolean() })), wrap(async (req, res) => {
  const prev = await isModuleActive(pool, req.sid);
  const { rows: [u] } = await pool.query('SELECT login AS n FROM users WHERE id = $1', [req.user.id]);
  const value = { enabled: req.body.enabled, changed_at: new Date().toISOString(), changed_by: req.user.id, changed_by_name: (u && u.n) || null };
  await pool.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1, 'seller_module_enabled', $2::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`, [req.sid, JSON.stringify(value)]);
  await audit(pool, req, 'commissions', req.body.enabled ? 'Activation du module Vendeurs & commissions' : 'Désactivation du module Vendeurs & commissions', 'settings', null, { enabled: prev }, { enabled: req.body.enabled });
  res.json({ enabled: req.body.enabled, changed_at: value.changed_at, changed_by: value.changed_by_name, can_toggle: true });
}));

async function loadDefaults(stationId) {
  const { rows } = await pool.query(
    `SELECT value FROM settings WHERE station_id = $1 AND key = 'seller_commission_defaults'`,
    [stationId]
  );
  if (!rows.length) return { ...DEFAULTS };
  const v = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : (rows[0].value || {});
  const mode = ['always', 'if_target_met', 'on_surplus'].includes(v.commission_mode) ? v.commission_mode : DEFAULTS.commission_mode;
  return {
    default_rate: Number(v.default_rate) >= 0 ? Number(v.default_rate) : DEFAULTS.default_rate,
    default_target: Number(v.default_target) >= 0 ? Number(v.default_target) : DEFAULTS.default_target,
    commission_mode: mode
  };
}

function parsePeriod(query) {
  const today = new Date();
  const iso = (d) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  };
  let from = query.from || null;
  let to = query.to || null;
  const period = query.period || 'month';
  if (!from || !to) {
    const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
    if (period === 'today') { from = iso(today); to = iso(today); }
    else if (period === '7d') { const f = new Date(today); f.setDate(d - 6); from = iso(f); to = iso(today); }
    else if (period === 'lastmonth') {
      from = iso(new Date(y, m - 1, 1));
      to = iso(new Date(y, m, 0));
    }
    else if (period === 'quarter') {
      const q = Math.floor(m / 3) * 3;
      from = iso(new Date(y, q, 1));
      to = iso(today);
    }
    else if (period === 'year') { from = iso(new Date(y, 0, 1)); to = iso(today); }
    else if (period === 'all') { from = null; to = null; }
    else { from = iso(new Date(y, m, 1)); to = iso(today); }
  }
  return { from, to, period };
}

/** Base imposable selon le mode */
function computeCommission(caHt, objectif, taux, mode) {
  const rate = (Number(taux) || 0) / 100;
  const ca = Number(caHt) || 0;
  const obj = Number(objectif) || 0;
  if (mode === 'if_target_met') {
    if (obj > 0 && ca < obj) return 0;
    return fl(ca * rate);
  }
  if (mode === 'on_surplus') {
    if (obj <= 0) return fl(ca * rate);
    const surplus = Math.max(0, ca - obj);
    return fl(surplus * rate);
  }
  // always
  return fl(ca * rate);
}

/**
 * GET /seller-commissions/summary
 */
r.get('/seller-commissions/summary', requireView, wrap(async (req, res) => {
  const { from, to, period } = parsePeriod(req.query);
  const defaults = await loadDefaults(req.sid);
  const teamView = canViewTeam(req);
  let ownEmployeeId = null;
  if (!teamView) {
    ownEmployeeId = await resolveOwnEmployeeId(req);
    if (!ownEmployeeId) {
      throw new HttpError(404, 'Aucun profil employé lié à votre compte sur cette station. Demandez à l’administrateur de rattacher votre utilisateur à une fiche employé.');
    }
  }

  const { rows: employees } = await pool.query(
    `SELECT id, first_name, last_name, position, matricule, user_id,
            sales_target, commission_rate, status
       FROM employees
      WHERE station_id = $1 AND deleted_at IS NULL AND status = 'actif'
        AND ($2::bigint IS NULL OR id = $2)
      ORDER BY last_name, first_name`,
    [req.sid, teamView ? null : ownEmployeeId]
  );

  // Agrégat ventes (JOIN sale_details — plus performant que sous-requête corrélée)
  const saleParams = [req.sid];
  let saleFilter = `s.station_id = $1 AND s.status = 'valide'`;
  if (from) { saleParams.push(from); saleFilter += ` AND s.sold_at::date >= $${saleParams.length}`; }
  if (to) { saleParams.push(to); saleFilter += ` AND s.sold_at::date <= $${saleParams.length}`; }
  if (!teamView && ownEmployeeId) {
    saleParams.push(ownEmployeeId);
    saleFilter += ` AND s.employee_id = $${saleParams.length}`;
  }

  const { rows: saleAgg } = await pool.query(
    `SELECT s.employee_id,
            COUNT(DISTINCT s.id)::int AS ventes,
            COALESCE(SUM(s.total), 0)::float AS ca_ttc,
            COALESCE(SUM(COALESCE(ht.line_ht, 0)), 0)::float AS ca_ht
       FROM sales s
       LEFT JOIN LATERAL (
         SELECT SUM(sd.amount / (1 + COALESCE(sd.tax_rate, 0) / 100.0)) AS line_ht
           FROM sale_details sd WHERE sd.sale_id = s.id
       ) ht ON true
      WHERE ${saleFilter}
      GROUP BY s.employee_id`,
    saleParams
  );
  const byEmp = {};
  saleAgg.forEach(row => { byEmp[row.employee_id] = row; });

  // Entrées : primes, commissions figées, règlements
  const { rows: entries } = await pool.query(
    `SELECT employee_id, kind, status,
            COALESCE(SUM(amount), 0)::float AS total,
            COALESCE(SUM(COALESCE(amount_remaining, CASE WHEN status = 'du' THEN amount ELSE 0 END)), 0)::float AS remaining
       FROM seller_commission_entries
      WHERE station_id = $1 AND status <> 'annule'
        AND (
          (period_from IS NOT NULL AND period_to IS NOT NULL
            AND ($2::date IS NULL OR period_to >= $2)
            AND ($3::date IS NULL OR period_from <= $3))
          OR
          (period_from IS NULL AND period_to IS NULL
            AND ($2::date IS NULL OR created_at::date >= $2)
            AND ($3::date IS NULL OR created_at::date <= $3))
        )
      GROUP BY employee_id, kind, status`,
    [req.sid, from, to]
  );

  const primes = {};
  const frozenCommission = {}; // commissions déjà figées (du + regle)
  const frozenDu = {}; // solde restant dû (primes + commissions figées)
  const regle = {};

  entries.forEach(row => {
    const id = row.employee_id;
    if (row.kind === 'prime' || row.kind === 'ajustement') {
      primes[id] = (primes[id] || 0) + Number(row.total);
      if (row.status === 'du') frozenDu[id] = (frozenDu[id] || 0) + Number(row.remaining);
    }
    if (row.kind === 'commission') {
      frozenCommission[id] = (frozenCommission[id] || 0) + Number(row.total);
      if (row.status === 'du') frozenDu[id] = (frozenDu[id] || 0) + Number(row.remaining);
    }
    if (row.kind === 'reglement' && row.status === 'regle') {
      regle[id] = (regle[id] || 0) + Number(row.total);
    }
  });

  const mode = defaults.commission_mode;
  const vendeurs = employees.map(e => {
    const agg = byEmp[e.id] || { ventes: 0, ca_ttc: 0, ca_ht: 0 };
    const taux = e.commission_rate != null ? Number(e.commission_rate) : defaults.default_rate;
    const objectif = e.sales_target != null ? Number(e.sales_target) : defaults.default_target;
    const caHt = Number(agg.ca_ht) || 0;
    const calculated = computeCommission(caHt, objectif, taux, mode);
    // Si une commission a déjà été figée sur la période, on l'affiche en priorité pour le « dû »
    const hasFrozen = (frozenCommission[e.id] || 0) > 0;
    const commissionDisplay = hasFrozen ? fl(frozenCommission[e.id]) : calculated;
    const primesEmp = fl(primes[e.id] || 0);
    const dejaRegle = fl(regle[e.id] || 0);
    const duesEntries = fl(frozenDu[e.id] || 0);
    // Reste : soldes d'écritures « du » ; si rien de figé, proposer la commission calculée + primes du
    const totalDu = hasFrozen || duesEntries > 0
      ? Math.max(0, duesEntries)
      : Math.max(0, fl(calculated + primesEmp - dejaRegle));

    return {
      id: e.id,
      name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.matricule,
      position: e.position,
      matricule: e.matricule,
      ventes: agg.ventes || 0,
      ca_ttc: fl(agg.ca_ttc),
      ca_ht: fl(caHt),
      objectif: fl(objectif),
      objectif_personnalise: e.sales_target != null,
      taux,
      taux_personnalise: e.commission_rate != null,
      commission_mode: mode,
      commission: commissionDisplay,
      commission_calculee: calculated,
      commission_figee: hasFrozen,
      primes: primesEmp,
      primes_du: duesEntries,
      deja_regle: dejaRegle,
      total_du: totalDu,
      objectif_atteint: objectif > 0 && caHt >= objectif
    };
  });

  // Employés inactifs avec ventes (vue équipe uniquement)
  if (teamView) {
    const knownIds = new Set(employees.map(e => e.id));
    for (const [eid, agg] of Object.entries(byEmp)) {
      const id = Number(eid);
      if (knownIds.has(id)) continue;
      const { rows: [e] } = await pool.query(
        `SELECT id, first_name, last_name, position, matricule, sales_target, commission_rate
           FROM employees WHERE id = $1 AND station_id = $2`, [id, req.sid]
      );
      if (!e) continue;
      const taux = e.commission_rate != null ? Number(e.commission_rate) : defaults.default_rate;
      const objectif = e.sales_target != null ? Number(e.sales_target) : defaults.default_target;
      const caHt = Number(agg.ca_ht) || 0;
      const calculated = computeCommission(caHt, objectif, taux, mode);
      vendeurs.push({
        id: e.id,
        name: `${e.first_name || ''} ${e.last_name || ''}`.trim() || e.matricule,
        position: e.position,
        matricule: e.matricule,
        ventes: agg.ventes || 0,
        ca_ttc: fl(agg.ca_ttc),
        ca_ht: fl(caHt),
        objectif: fl(objectif),
        objectif_personnalise: e.sales_target != null,
        taux,
        taux_personnalise: e.commission_rate != null,
        commission_mode: mode,
        commission: calculated,
        commission_calculee: calculated,
        commission_figee: false,
        primes: fl(primes[e.id] || 0),
        primes_du: fl(frozenDu[e.id] || 0),
        deja_regle: fl(regle[e.id] || 0),
        total_du: Math.max(0, fl(calculated + (primes[e.id] || 0) - (regle[e.id] || 0))),
        objectif_atteint: objectif > 0 && caHt >= objectif
      });
    }
  }

  vendeurs.sort((a, b) => b.ca_ht - a.ca_ht);

  res.json({
    period,
    from,
    to,
    scope: teamView ? 'team' : 'own',
    defaults,
    totals: {
      ventes: vendeurs.reduce((a, v) => a + v.ventes, 0),
      ca_ht: fl(vendeurs.reduce((a, v) => a + v.ca_ht, 0)),
      ca_ttc: fl(vendeurs.reduce((a, v) => a + v.ca_ttc, 0)),
      commissions: fl(vendeurs.reduce((a, v) => a + v.commission, 0)),
      primes: fl(vendeurs.reduce((a, v) => a + v.primes, 0)),
      reste_a_regler: fl(vendeurs.reduce((a, v) => a + v.total_du, 0))
    },
    vendeurs
  });
}));

r.get('/seller-commissions/config', requireView, wrap(async (req, res) => {
  res.json(await loadDefaults(req.sid));
}));

r.put('/seller-commissions/config', requireManage, body(z.object({
  default_rate: z.number().min(0).max(100),
  default_target: z.number().min(0),
  commission_mode: z.enum(['always', 'if_target_met', 'on_surplus']).optional()
})), wrap(async (req, res) => {
  const prev = await loadDefaults(req.sid);
  const value = {
    default_rate: fl(req.body.default_rate),
    default_target: fl(req.body.default_target),
    commission_mode: req.body.commission_mode || prev.commission_mode || DEFAULTS.commission_mode
  };
  await pool.query(
    `INSERT INTO settings(station_id, key, value) VALUES ($1, 'seller_commission_defaults', $2::jsonb)
     ON CONFLICT (station_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [req.sid, JSON.stringify(value)]
  );
  await audit(pool, req, 'commissions', 'Paramètres commissions vendeurs mis à jour', 'settings', null, prev, value);
  res.json(value);
}));

r.put('/seller-commissions/employees/:id', requireManage, body(z.object({
  sales_target: z.number().min(0).nullable().optional(),
  commission_rate: z.number().min(0).max(100).nullable().optional()
}).refine(d => d.sales_target !== undefined || d.commission_rate !== undefined, {
  message: 'Indiquez sales_target et/ou commission_rate'
})), wrap(async (req, res) => {
  const empId = Number(req.params.id);
  const { rows: [e] } = await pool.query(
    `SELECT id, first_name, last_name, sales_target, commission_rate
       FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL`,
    [empId, req.sid]
  );
  if (!e) throw new HttpError(404, 'Employé introuvable sur cette station');

  const sets = [];
  const params = [];
  if (req.body.sales_target !== undefined) {
    params.push(req.body.sales_target);
    sets.push(`sales_target = $${params.length}`);
  }
  if (req.body.commission_rate !== undefined) {
    params.push(req.body.commission_rate);
    sets.push(`commission_rate = $${params.length}`);
  }
  params.push(empId, req.sid);
  const { rows: [updated] } = await pool.query(
    `UPDATE employees SET ${sets.join(', ')}
      WHERE id = $${params.length - 1} AND station_id = $${params.length}
      RETURNING id, first_name, last_name, sales_target, commission_rate`,
    params
  );
  await audit(pool, req, 'commissions',
    `Objectif/taux commission mis à jour pour ${e.first_name} ${e.last_name}`,
    'employees', empId,
    { sales_target: e.sales_target, commission_rate: e.commission_rate },
    { sales_target: updated.sales_target, commission_rate: updated.commission_rate }
  );
  res.json(updated);
}));

/** Figer les commissions calculées pour une période (écritures kind=commission) */
r.post('/seller-commissions/freeze', requireManage, body(z.object({
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  employee_ids: z.array(z.number().int()).optional()
})), wrap(async (req, res) => {
  const { period_from, period_to, employee_ids } = req.body;
  if (period_from > period_to) throw new HttpError(400, 'Période invalide');

  const result = await tx(async (c) => {
    // Reprendre le résumé calculé
    const defaults = await loadDefaults(req.sid);
    const empFilter = employee_ids && employee_ids.length
      ? employee_ids
      : null;

    const { rows: employees } = await c.query(
      `SELECT id, first_name, last_name, sales_target, commission_rate
         FROM employees
        WHERE station_id = $1 AND deleted_at IS NULL AND status = 'actif'
          AND ($2::bigint[] IS NULL OR id = ANY($2::bigint[]))`,
      [req.sid, empFilter]
    );

    const { rows: saleAgg } = await c.query(
      `SELECT s.employee_id,
              COALESCE(SUM(COALESCE(ht.line_ht, 0)), 0)::float AS ca_ht
         FROM sales s
         LEFT JOIN LATERAL (
           SELECT SUM(sd.amount / (1 + COALESCE(sd.tax_rate, 0) / 100.0)) AS line_ht
             FROM sale_details sd WHERE sd.sale_id = s.id
         ) ht ON true
        WHERE s.station_id = $1 AND s.status = 'valide'
          AND s.sold_at::date >= $2 AND s.sold_at::date <= $3
        GROUP BY s.employee_id`,
      [req.sid, period_from, period_to]
    );
    const byEmp = {};
    saleAgg.forEach(row => { byEmp[row.employee_id] = row; });

    const created = [];
    for (const e of employees) {
      // Déjà figé ?
      const { rows: existing } = await c.query(
        `SELECT id FROM seller_commission_entries
          WHERE station_id = $1 AND employee_id = $2 AND kind = 'commission'
            AND period_from = $3 AND period_to = $4 AND status <> 'annule'`,
        [req.sid, e.id, period_from, period_to]
      );
      if (existing.length) continue;

      const caHt = Number((byEmp[e.id] || {}).ca_ht) || 0;
      const taux = e.commission_rate != null ? Number(e.commission_rate) : defaults.default_rate;
      const objectif = e.sales_target != null ? Number(e.sales_target) : defaults.default_target;
      const amount = computeCommission(caHt, objectif, taux, defaults.commission_mode);
      if (amount <= 0) continue;

      const { rows: [row] } = await c.query(
        `INSERT INTO seller_commission_entries
           (station_id, employee_id, kind, period_from, period_to, amount, amount_remaining, note, status, created_by)
         VALUES ($1,$2,'commission',$3,$4,$5,$5,$6,'du',$7)
         RETURNING *`,
        [req.sid, e.id, period_from, period_to, amount,
          `Commission figée ${period_from} → ${period_to} (CA HT ${caHt}, taux ${taux}%, mode ${defaults.commission_mode})`,
          req.user.id]
      );
      created.push(row);
    }
    await audit(c, req, 'commissions',
      `Figage commissions ${period_from} → ${period_to} : ${created.length} écriture(s)`,
      'seller_commission_entries', null, null, { count: created.length, period_from, period_to });
    return created;
  });

  res.status(201).json({ created: result.length, entries: result });
}));

r.post('/seller-commissions/primes', requireManage, body(z.object({
  employee_id: z.number().int().positive(),
  amount: z.number().positive(),
  note: z.string().max(500).optional().nullable(),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [e] } = await pool.query(
    `SELECT id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL`,
    [b.employee_id, req.sid]
  );
  if (!e) throw new HttpError(404, 'Employé introuvable');

  const amount = fl(b.amount);
  const { rows: [row] } = await pool.query(
    `INSERT INTO seller_commission_entries
       (station_id, employee_id, kind, period_from, period_to, amount, amount_remaining, note, status, created_by)
     VALUES ($1,$2,'prime',$3,$4,$5,$5,$6,'du',$7)
     RETURNING *`,
    [req.sid, b.employee_id, b.period_from || null, b.period_to || null, amount, b.note || null, req.user.id]
  );
  await audit(pool, req, 'commissions',
    `Prime exceptionnelle ${amount} pour ${e.first_name} ${e.last_name}`,
    'seller_commission_entries', row.id, null, row);
  res.status(201).json(row);
}));

/**
 * Règlement partiel : impute sur les écritures « du » (FIFO) sans marquer une ligne
 * entière si le montant est inférieur au solde.
 */
r.post('/seller-commissions/reglements', requireManage, body(z.object({
  employee_id: z.number().int().positive(),
  amount: z.number().positive(),
  note: z.string().max(500).optional().nullable(),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable()
})), wrap(async (req, res) => {
  const b = req.body;
  const result = await tx(async (c) => {
    const { rows: [e] } = await c.query(
      `SELECT id, first_name, last_name FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL`,
      [b.employee_id, req.sid]
    );
    if (!e) throw new HttpError(404, 'Employé introuvable');

    let remaining = fl(b.amount);
    const { rows: openLines } = await c.query(
      `SELECT id, amount, COALESCE(amount_remaining, amount) AS amount_remaining
         FROM seller_commission_entries
        WHERE station_id = $1 AND employee_id = $2
          AND kind IN ('prime', 'commission', 'ajustement') AND status = 'du'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE`,
      [req.sid, b.employee_id]
    );

    for (const line of openLines) {
      if (remaining <= 0) break;
      const lineRem = fl(line.amount_remaining);
      if (lineRem <= 0) continue;
      if (remaining >= lineRem) {
        await c.query(
          `UPDATE seller_commission_entries
              SET amount_remaining = 0, status = 'regle', settled_at = now(), settled_by = $2
            WHERE id = $1 AND station_id = $3`,
          [line.id, req.user.id, req.sid]
        );
        remaining = fl(remaining - lineRem);
      } else {
        await c.query(
          `UPDATE seller_commission_entries
              SET amount_remaining = $2
            WHERE id = $1 AND station_id = $3`,
          [line.id, fl(lineRem - remaining), req.sid]
        );
        remaining = 0;
      }
    }

    const paid = fl(b.amount - remaining);
    if (paid <= 0) throw new HttpError(400, 'Aucun solde dû à régler pour cet employé. Figez d’abord les commissions de la période ou ajoutez une prime.');

    const { rows: [row] } = await c.query(
      `INSERT INTO seller_commission_entries
         (station_id, employee_id, kind, period_from, period_to, amount, amount_remaining, note, status, created_by, settled_at, settled_by)
       VALUES ($1,$2,'reglement',$3,$4,$5,0,$6,'regle',$7,now(),$7)
       RETURNING *`,
      [req.sid, b.employee_id, b.period_from || null, b.period_to || null, paid, b.note || null, req.user.id]
    );
    await audit(c, req, 'commissions',
      `Règlement ${paid} pour ${e.first_name} ${e.last_name}`,
      'seller_commission_entries', row.id, null, row);
    return { ...row, amount_requested: fl(b.amount), amount_applied: paid };
  });
  res.status(201).json(result);
}));

r.get('/seller-commissions/entries', requireView, wrap(async (req, res) => {
  let empId = req.query.employee_id ? Number(req.query.employee_id) : null;
  if (!canViewTeam(req)) {
    const ownId = await resolveOwnEmployeeId(req);
    if (!ownId) throw new HttpError(404, 'Aucun profil employé lié à votre compte.');
    empId = ownId;
  }
  const { rows } = await pool.query(
    `SELECT e.*, emp.first_name, emp.last_name
       FROM seller_commission_entries e
       JOIN employees emp ON emp.id = e.employee_id
      WHERE e.station_id = $1
        AND ($2::bigint IS NULL OR e.employee_id = $2)
        AND e.status <> 'annule'
      ORDER BY e.created_at DESC
      LIMIT 200`,
    [req.sid, empId]
  );
  res.json(rows);
}));

r.post('/seller-commissions/entries/:id/cancel', requireManage, body(z.object({
  reason: z.string().min(3).max(300)
})), wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    `UPDATE seller_commission_entries
        SET status = 'annule',
            amount_remaining = 0,
            note = COALESCE(note,'') || ' | Annulé : ' || $3
      WHERE id = $1 AND station_id = $2 AND status = 'du'
      RETURNING *`,
    [req.params.id, req.sid, req.body.reason]
  );
  if (!row) throw new HttpError(404, 'Entrée introuvable ou déjà traitée');
  await audit(pool, req, 'commissions', 'Annulation entrée commission', 'seller_commission_entries', row.id, null, { reason: req.body.reason });
  res.json(row);
}));

r.isModuleActive = isModuleActive;
module.exports = r;
