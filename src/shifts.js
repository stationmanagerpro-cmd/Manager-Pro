// Quarts de service : ouverture, suivi, clôture (cœur du système).
const express = require('express');
const { swallow } = require('./safe');
const { z } = require('zod');
const { pool, tx, fl, f3, HttpError, Preview, wrap, body, need, audit, cashMove, stockMove, setting, accountMove, assertLinkedMethod, ledger } = require('./core');
const { sendSystemAlert } = require('./messaging');
const { notifyQuartEvent, notifyAnomalie } = require('../services/emailService');
const attr = require('./shift_attribution'); // rattachement des ventes, écarts et anomalies à chaque employé du quart
const { checkFuelSalesAttribution } = require('./shift_sales_check');
const fmtQ = v => String(Number(Number(v).toFixed(2)).toLocaleString('fr-FR')).replace(/[\u202f\u00a0]/g, ' ').replace(/\u2212/g, '-');   // nombre lisible (2 décimales max)
const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim();
async function stationName(stationId) {
  const { rows: [row] } = await pool.query('SELECT name FROM stations WHERE id = $1', [stationId]);
  return row?.name || `Station ${stationId}`;
}
async function safeEmailAlert(fn, ...args) {
  try { await fn(...args); } catch (e) { console.warn('[alertes-email] Envoi impossible:', e.message); }
}
const r = express.Router();
const broadShiftRead = req => ['shift.open', 'shift.close', 'report.view'].some(code => req.user?.perms?.has(code));
const canReadOwnShiftReport = (req, res, next) => {
  if (broadShiftRead(req) || req.user?.perms?.has('shift.report.own')) return next();
  return next(new HttpError(403, 'Permission de consultation des rapports de quart requise.'));
};
async function isAssignedToShift(userId, shiftId, stationId) {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM shift_employees se JOIN employees e ON e.id=se.employee_id
      WHERE se.shift_id=$1 AND e.user_id=$2 AND e.station_id=$3 AND e.deleted_at IS NULL LIMIT 1`,
    [shiftId, userId, stationId]);
  return rowCount > 0;
}

const openSchema = z.object({
  kind: z.string().min(1),
  cash_register_id: z.number().int(),
  opening_cash: z.number().min(0),
  employee_ids: z.array(z.number().int()).default([]),
  employee_roles: z.array(z.object({ employee_id: z.number().int(), role: z.string().trim().min(1).max(80) })).default([]),
  pump_assignments: z.array(z.object({ employee_id: z.number().int(), pump_id: z.number().int() })).default([]),
  counters: z.array(z.object({ counter_id: z.number().int(), index_start: z.number().min(0) })).min(1),
  planned_start: z.string().datetime().optional(),
  planned_end: z.string().datetime().optional(),
  // Date/heure d'ouverture (permet l'enregistrement de quarts passés). Si absentes → maintenant.
  shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // Accepte ISO avec ou sans offset (ex. ...Z ou ...+00:00) ; validation fine faite ensuite.
  opened_at: z.string().min(10).max(40).optional(),
});

// ---------- Placement chronologique des quarts (saisie en retard) ----------
// Un quart peut être enregistré après coup : on le replace selon opened_at / closed_at.
// Le N° de quart reste un identifiant immuable (séquence de création) ; l'ordre métier = date.
async function shiftNeighbours(c, stationId, at, excludeId = null) {
  const { rows: [previous] } = await c.query(
    `SELECT id, number, status, opened_at, closed_at FROM shifts
      WHERE station_id = $1 AND status <> 'annule' AND opened_at IS NOT NULL AND opened_at < $2::timestamptz AND ($3::bigint IS NULL OR id <> $3)
      ORDER BY opened_at DESC, id DESC LIMIT 1`, [stationId, at.toISOString(), excludeId]);
  const { rows: [next] } = await c.query(
    `SELECT id, number, status, opened_at, closed_at FROM shifts
      WHERE station_id = $1 AND status <> 'annule' AND opened_at IS NOT NULL AND opened_at > $2::timestamptz AND ($3::bigint IS NULL OR id <> $3)
      ORDER BY opened_at ASC, id ASC LIMIT 1`, [stationId, at.toISOString(), excludeId]);
  return { previous: previous || null, next: next || null };
}
const fmtDt = d => new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
// Index de fin du quart chronologiquement précédent / index de début du suivant, par compteur
async function neighbourIndexes(c, stationId, at, excludeId = null) {
  const { rows: prev } = await c.query(
    `SELECT DISTINCT ON (m.counter_id) m.counter_id, m.index_end
       FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
      WHERE sh.station_id = $1 AND sh.status = 'ferme' AND m.index_end IS NOT NULL AND sh.opened_at < $2::timestamptz AND ($3::bigint IS NULL OR sh.id <> $3)
      ORDER BY m.counter_id, sh.opened_at DESC, sh.id DESC`, [stationId, at.toISOString(), excludeId]);
  const { rows: nxt } = await c.query(
    `SELECT DISTINCT ON (m.counter_id) m.counter_id, m.index_start, sh.number
       FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
      WHERE sh.station_id = $1 AND sh.status <> 'annule' AND sh.opened_at > $2::timestamptz AND ($3::bigint IS NULL OR sh.id <> $3)
      ORDER BY m.counter_id, sh.opened_at ASC, sh.id ASC`, [stationId, at.toISOString(), excludeId]);
  return {
    prevEnd: Object.fromEntries(prev.map(x => [x.counter_id, Number(x.index_end)])),
    nextStart: Object.fromEntries(nxt.map(x => [x.counter_id, { index: Number(x.index_start), number: x.number }])),
  };
}
// Aperçu côté formulaire : où le quart sera-t-il placé ? quels index reprendre ?
r.get('/placement', need('shift.open'), wrap(async (req, res) => {
  const at = new Date(String(req.query.at || ''));
  if (Number.isNaN(at.getTime())) throw new HttpError(400, 'Paramètre at invalide (ISO attendu)');
  if (at.getTime() > Date.now() + 60_000) throw new HttpError(400, 'La date/heure d\'ouverture ne peut pas être dans le futur');
  const { previous, next } = await shiftNeighbours(pool, req.sid, at);
  const idx = next ? await neighbourIndexes(pool, req.sid, at) : { prevEnd: {}, nextStart: {} };
  let overlap = null;
  if (previous && previous.status === 'ferme' && previous.closed_at && new Date(previous.closed_at).getTime() > at.getTime() + 1000)
    overlap = 'Cette date/heure tombe pendant le quart N° ' + previous.number + ' (clôturé le ' + fmtDt(previous.closed_at) + ').';
  res.json({
    inserted: !!next, overlap,
    previous: previous ? { id: previous.id, number: previous.number, opened_at: previous.opened_at, closed_at: previous.closed_at, indexes: idx.prevEnd } : null,
    next: next ? { id: next.id, number: next.number, opened_at: next.opened_at } : null,
  });
}));

// OUVERTURE : caisse initiale, index des compteurs, stock initial, employés affectés.
// shift_date / opened_at optionnels : autorisent la saisie de quarts antérieurs.
// Les agrégats / rapports filtrent déjà sur opened_at → un quart passé est pris en compte.
r.post('/open', need('shift.open'), body(openSchema), wrap(async (req, res) => {
  const b = req.body;
  // Résolution date/heure d'ouverture (passée ou maintenant). Interdit le futur.
  let resolvedOpenedAt = null; // Date JS ou null → now() côté SQL
  let resolvedShiftDate = null; // 'YYYY-MM-DD' ou null → CURRENT_DATE côté SQL
  if (b.opened_at) {
    const d = new Date(b.opened_at);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date/heure d\'ouverture invalide');
    if (d.getTime() > Date.now() + 60_000) throw new HttpError(400, 'La date/heure d\'ouverture ne peut pas être dans le futur');
    resolvedOpenedAt = d;
    resolvedShiftDate = d.toISOString().slice(0, 10);
    // Date locale du client (fuseaux ≠ UTC) : retenue si elle est cohérente avec opened_at (± 1 jour).
    if (b.shift_date) {
      const sd = Date.parse(b.shift_date + 'T12:00:00Z');
      if (!Number.isNaN(sd) && Math.abs(sd - d.getTime()) <= 36 * 3600 * 1000) resolvedShiftDate = b.shift_date;
    }
  } else if (b.shift_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b.shift_date);
    if (!m) throw new HttpError(400, 'shift_date invalide (attendu YYYY-MM-DD)');
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 8, 0, 0)); // 08:00 UTC si seule la date
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'shift_date invalide');
    if (d.getTime() > Date.now() + 86_400_000) throw new HttpError(400, 'La date d\'ouverture ne peut pas être dans le futur');
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (b.shift_date === todayUtc) {
      resolvedShiftDate = b.shift_date;
      resolvedOpenedAt = null; // now()
    } else {
      resolvedOpenedAt = d;
      resolvedShiftDate = b.shift_date;
    }
  }
  const shift = await tx(async c => {
    await c.query('SELECT id FROM stations WHERE id = $1 FOR UPDATE', [req.sid]); // sérialise les ouvertures
    const { rows: [o] } = await c.query("SELECT number FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid]);
    if (o) throw new HttpError(409, 'Un quart est déjà ouvert (N° ' + o.number + ')');
    // Placement chronologique : un quart saisi en retard est replacé selon sa date d'ouverture.
    const effOpen = resolvedOpenedAt || new Date();
    const nb = await shiftNeighbours(c, req.sid, effOpen);
    if (nb.previous && nb.previous.closed_at && new Date(nb.previous.closed_at).getTime() > effOpen.getTime() + 1000)
      throw new HttpError(409, 'Cette date/heure d\'ouverture chevauche le quart N° ' + nb.previous.number + ' (clôturé le ' + fmtDt(nb.previous.closed_at) + ').');
    const inserted = !!nb.next; // un quart plus récent existe déjà → insertion dans l'historique
    const nbIdx = inserted ? await neighbourIndexes(c, req.sid, effOpen) : { prevEnd: {}, nextStart: {} };
    const { rows: [n] } = await c.query('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM shifts WHERE station_id = $1', [req.sid]);
    const { rows: [reg] } = await c.query('SELECT id, balance FROM cash_registers WHERE id = $1 AND station_id = $2 AND active FOR UPDATE', [b.cash_register_id, req.sid]);
    if (!reg) throw new HttpError(400, 'Caisse inconnue pour cette station');
    const { rows: [s] } = await c.query(
      `INSERT INTO shifts(station_id, number, shift_date, kind, planned_start, planned_end, opened_at, manager_id, cash_register_id, opening_cash, status)
       VALUES ($1,$2,COALESCE($9::date, CURRENT_DATE),$3,$4,$5,COALESCE($10::timestamptz, now()),$6,$7,$8,'ouvert') RETURNING *`,
      [req.sid, n.n, b.kind, b.planned_start || null, b.planned_end || null, req.user.id, reg.id, b.opening_cash,
       resolvedShiftDate, resolvedOpenedAt ? resolvedOpenedAt.toISOString() : null]);
    // Quart inséré dans l'historique : le solde courant de la caisse (qui inclut les quarts plus récents) ne doit pas être
    // recalé sur une caisse initiale passée ; l'écart éventuel est constaté à la clôture (caisse théorique du quart).
    const diff = inserted ? 0 : fl(b.opening_cash - reg.balance);
    if (diff) await cashMove(c, { reg: reg.id, shift: s.id, kind: 'ouverture', amount: diff, label: 'Ajustement de la caisse initiale', by: req.user.id });

    // Tous les compteurs des pompes actives doivent être relevés
    const { rows: all } = await c.query(
      `SELECT pc.id, pc.pump_id, pc.product_id, pc.current_index FROM pump_counters pc JOIN pumps pu ON pu.id = pc.pump_id
        WHERE pu.station_id = $1 AND pu.status = 'active' AND pu.deleted_at IS NULL`, [req.sid]);
    for (const k of all) if (!b.counters.some(x => x.counter_id === k.id)) throw new HttpError(400, 'Index initial manquant pour le compteur ' + k.id);
    for (const x of b.counters) {
      const k = all.find(a => a.id === x.counter_id);
      if (!k) throw new HttpError(400, 'Compteur inconnu ou pompe inactive : ' + x.counter_id);
      // Index attendu : dernier index de clôture (quart le plus récent) ou, pour un quart inséré, celui du quart précédent.
      const expected = inserted ? nbIdx.prevEnd[k.id] : Number(k.current_index);
      const later = inserted ? nbIdx.nextStart[k.id] : null;
      if (later && x.index_start > later.index + 0.0005)
        throw new HttpError(400, `Index initial (${x.index_start}) supérieur à l'index initial du quart suivant N° ${later.number} (${later.index}) pour le compteur ${k.id}`);
      await c.query('INSERT INTO meter_readings(shift_id, counter_id, pump_id, product_id, index_start, read_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [s.id, k.id, k.pump_id, k.product_id, x.index_start, req.user.id]);
      if (expected != null && Math.abs(x.index_start - expected) > 0.0005)
        await c.query('INSERT INTO shift_anomalies(shift_id, kind, description, amount, created_by) VALUES ($1,$2,$3,$4,$5)',
          [s.id, 'ecart_compteur', `Compteur ${k.id} : index initial ${x.index_start} ≠ dernier index de clôture ${expected}`, f3(x.index_start - expected), req.user.id]);
      // L'index courant du compteur ne recule jamais : un quart inséré dans le passé ne le modifie pas.
      if (!inserted) await c.query('UPDATE pump_counters SET current_index = $2 WHERE id = $1', [k.id, x.index_start]);
    }
    const roleByEmployee = new Map((b.employee_roles || []).map(x => [x.employee_id, x.role]));
    const participantIds = [...new Set([...(b.employee_ids || []), ...(b.employee_roles || []).map(x => x.employee_id)])];
    for (const eid of participantIds) {
      const { rowCount } = await c.query(
        'INSERT INTO shift_employees(shift_id, employee_id, role_in_shift) SELECT $1, id, $3 FROM employees WHERE id = $2 AND station_id = $4',
        [s.id, eid, roleByEmployee.get(eid) || null, req.sid]);
      if (!rowCount) throw new HttpError(400, 'Employé inconnu : ' + eid);
    }
    // Affectations multi-pompes (max 2 / employé, 1 employé / pompe)
    {
      const pumpsByEmp = {};
      for (const a of b.pump_assignments || []) {
        if (!a || !a.employee_id || !a.pump_id) continue;
        const eid = Number(a.employee_id), pid = Number(a.pump_id);
        if (!pumpsByEmp[eid]) pumpsByEmp[eid] = [];
        if (!pumpsByEmp[eid].includes(pid)) pumpsByEmp[eid].push(pid);
      }
      const seenPumps = new Set();
      for (const [eid, pids] of Object.entries(pumpsByEmp)) {
        if (pids.length > 2) throw new HttpError(400, 'Un employé ne peut être affecté qu’à deux pompes maximum par quart.');
        for (const pid of pids) {
          if (seenPumps.has(pid)) throw new HttpError(400, 'La pompe ' + pid + ' est déjà affectée à un autre employé de ce quart.');
          seenPumps.add(pid);
        }
        await c.query(
          'UPDATE shift_employees SET pump_id = $3 WHERE shift_id = $1 AND employee_id = $2 AND EXISTS (SELECT 1 FROM pumps WHERE id = $3 AND station_id = $4)',
          [s.id, Number(eid), pids[0], req.sid]
        );
        for (const pid of pids) {
          await c.query(
            `INSERT INTO shift_employee_pumps(shift_id, employee_id, pump_id)
             SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM pumps WHERE id = $3 AND station_id = $4)
             ON CONFLICT DO NOTHING`,
            [s.id, Number(eid), pid, req.sid]
          );
        }
      }
    }
    // Une pompe peut rester sans employé (manque de personnel). Dès qu'elle est attribuée, l'employé est responsable de son compteur.
    if (!inserted) {
      await c.query(
        `INSERT INTO shift_stock_counts(shift_id, product_id, opening_stock)
         SELECT $1, p.id, COALESCE(st.quantity, 0) FROM products p LEFT JOIN stock st ON st.product_id = p.id WHERE p.station_id = $2 AND p.deleted_at IS NULL`, [s.id, req.sid]);
    } else {
      // Stock à la date du quart : clôture du quart précédent (physique, sinon théorique) ;
      // à défaut, stock actuel diminué des mouvements des quarts plus récents.
      await c.query(
        `INSERT INTO shift_stock_counts(shift_id, product_id, opening_stock)
         SELECT $1, p.id, COALESCE(
                  (SELECT COALESCE(sc.physical, sc.theoretical) FROM shift_stock_counts sc WHERE sc.shift_id = $3 AND sc.product_id = p.id),
                  COALESCE(st.quantity, 0) - COALESCE((SELECT SUM(sm.quantity) FROM stock_movements sm JOIN shifts lsh ON lsh.id = sm.shift_id
                      WHERE sm.product_id = p.id AND lsh.station_id = $2 AND lsh.status <> 'annule' AND lsh.opened_at > $4::timestamptz), 0))
           FROM products p LEFT JOIN stock st ON st.product_id = p.id WHERE p.station_id = $2 AND p.deleted_at IS NULL`,
        [s.id, req.sid, nb.previous && nb.previous.status === 'ferme' ? nb.previous.id : null, effOpen.toISOString()]);
    }
    // Écritures créées pendant cette transaction (ajustement de caisse…) : horodatées à la date du quart.
    if (resolvedOpenedAt && resolvedOpenedAt.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10))
      await c.query('UPDATE cash_movements SET created_at = $2::timestamptz WHERE shift_id = $1 AND created_at = now()', [s.id, resolvedOpenedAt.toISOString()]);
    const openedIso = s.opened_at ? new Date(s.opened_at).toISOString() : null;
    const shiftDateStr = s.shift_date ? String(s.shift_date).slice(0, 10) : null;
    const isBackdated = !!(openedIso && openedIso.slice(0, 10) < new Date().toISOString().slice(0, 10));
    await audit(c, req, 'quarts',
      isBackdated
        ? ('Ouverture du quart N° ' + s.number + ' (date antérieure ' + (shiftDateStr || openedIso.slice(0, 10)) + ')')
        : ('Ouverture du quart N° ' + s.number),
      'shifts', s.id, null, {
        caisse_initiale: b.opening_cash,
        shift_date: shiftDateStr,
        opened_at: openedIso,
        backdated: isBackdated,
        inserted_in_history: inserted,
        previous_shift: nb.previous ? nb.previous.number : null,
        next_shift: nb.next ? nb.next.number : null,
        kind: s.kind
      });
    return s;
  });
  // Les incohérences d’index sont signalées après validation de l’ouverture.
  try {
    const { rows: [actor] } = await pool.query('SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
    if (actor?.client_id) {
      const { rows: counterAlerts } = await pool.query(
        `SELECT id, description, amount FROM shift_anomalies WHERE shift_id = $1 AND kind = 'ecart_compteur' ORDER BY id`, [shift.id]);
      for (const a of counterAlerts) await sendSystemAlert({
        clientId: actor.client_id, actorUserId: req.user.id, employeeUserId: null,
        kind: 'counter_anomaly', body: `Jaugeage incohérent à l’ouverture du quart ${shift.number} : ${a.description}`,
        refTable: 'shift_anomalies', refId: a.id, stationId: req.sid,
        metricValue: Math.abs(Number(a.amount) || 0), metricUnit: 'litres'
      }).catch(err => console.warn('[alertes] Notification jaugeage impossible:', err.message));
    }
  } catch (alertError) { console.warn('[alertes] Contrôle jaugeage non notifié:', alertError.message); }
  safeEmailAlert(notifyQuartEvent, 'ouverture', await stationName(req.sid), { number: shift.number, user: req.user.login, date: shift.opened_at }).catch(() => {});
  res.status(201).json(shift);
}));

r.get('/', wrap(async (req, res) => {
  let rows;
  // Filtre optionnel par période sur la date d'ouverture (jours de début et de fin inclus) — écran Quarts et export PDF.
  const from = String(req.query.from || ''), to = String(req.query.to || ''), hasRange = !!(from || to);
  if (hasRange) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpError(400, 'Période invalide : renseignez la date de début et la date de fin.');
    if (from > to) throw new HttpError(400, 'La date de début ne peut pas être postérieure à la date de fin.');
  }
  const rg = (col, n) => (hasRange ? ` AND ${col}::date BETWEEN $${n}::date AND $${n + 1}::date` : '');
  const rp = hasRange ? [from, to] : [];
  const lim = hasRange ? 1000 : null;
  if (broadShiftRead(req)) {
    ({ rows } = await pool.query('SELECT id, number, kind, status, opened_at, closed_at, opening_cash, cash_gap FROM shifts WHERE station_id = $1' + rg('opened_at', 2) + ' ORDER BY opened_at DESC NULLS LAST, id DESC LIMIT ' + (lim || 60), [req.sid, ...rp]));
  } else if (req.user?.perms?.has('sale.create') || req.user?.perms?.has('shift.report.own')) {
    ({ rows } = await pool.query(`SELECT DISTINCT sh.id, sh.number, sh.kind, sh.status, sh.opened_at, sh.closed_at, sh.opening_cash, sh.cash_gap
      FROM shifts sh JOIN shift_employees se ON se.shift_id=sh.id JOIN employees e ON e.id=se.employee_id
      WHERE sh.station_id=$1 AND e.user_id=$2 AND e.deleted_at IS NULL${rg('sh.opened_at', 3)} ORDER BY sh.opened_at DESC NULLS LAST, sh.id DESC LIMIT ${lim || 100}`, [req.sid, req.user.id, ...rp]));
  } else {
    throw new HttpError(403, 'Permission de consultation des quarts requise.');
  }
  res.json(rows);
}));

// Quart ouvert avec ses compteurs et ses totaux en cours
r.get('/current', wrap(async (req, res) => {
  const { rows: [s] } = broadShiftRead(req)
    ? await pool.query("SELECT * FROM shifts WHERE station_id = $1 AND status = 'ouvert'", [req.sid])
    : await pool.query(`SELECT sh.* FROM shifts sh JOIN shift_employees se ON se.shift_id=sh.id JOIN employees e ON e.id=se.employee_id
        WHERE sh.station_id=$1 AND sh.status='ouvert' AND e.user_id=$2 AND e.deleted_at IS NULL LIMIT 1`, [req.sid, req.user.id]);
  if (!s) return res.json(null);
  const [rd, sales, an, fd, ex, cr, ch, team] = await Promise.all([
    pool.query('SELECT m.*, p.name AS product, pu.name AS pump, pc.counter_number, m.pump_id, m.counter_id FROM meter_readings m JOIN products p ON p.id = m.product_id JOIN pumps pu ON pu.id = m.pump_id JOIN pump_counters pc ON pc.id = m.counter_id WHERE m.shift_id = $1 ORDER BY pu.number, pc.counter_number', [s.id]),
    pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0) AS total FROM sales WHERE shift_id = $1 AND status = 'valide' AND kind = 'produits'", [s.id]),
    pool.query("SELECT sa.*, NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') AS employee, COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.login) AS reported_by, (e.user_id IS NOT NULL AND e.user_id = sa.created_by) AS reported_self FROM shift_anomalies sa LEFT JOIN employees e ON e.id = sa.employee_id LEFT JOIN users cu ON cu.id = sa.created_by WHERE sa.shift_id = $1 ORDER BY sa.id", [s.id]),
    pool.query("SELECT COUNT(DISTINCT sa.id)::int AS n, COALESCE(SUM(d.amount),0) AS total, COALESCE(SUM(d.quantity),0) AS liters FROM sales sa JOIN sale_details d ON d.sale_id = sa.id WHERE sa.shift_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide'", [s.id]),
    pool.query('SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS total FROM expenses WHERE shift_id = $1 AND deleted_at IS NULL', [s.id]),
    pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(p.amount),0) AS total FROM payments p LEFT JOIN sales sa ON sa.id = p.sale_id WHERE p.shift_id = $1 AND p.method = 'credit' AND (sa.id IS NULL OR sa.status = 'valide')", [s.id]),
    pool.query(`SELECT COALESCE((SELECT TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) FROM shift_employees se JOIN employees e ON e.id = se.employee_id
                                  WHERE se.shift_id = $1 AND se.role_in_shift = 'Responsable' LIMIT 1),
                                 (SELECT login FROM users WHERE id = $2)) AS name`, [s.id, s.manager_id]),
    pool.query(`SELECT se.employee_id AS id,
                       TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS name,
                       se.role_in_shift AS role,
                       se.pump_id AS pump_id,
                       COALESCE(
                         (SELECT json_agg(sep.pump_id ORDER BY sep.pump_id)
                            FROM shift_employee_pumps sep
                           WHERE sep.shift_id = se.shift_id AND sep.employee_id = se.employee_id),
                         CASE WHEN se.pump_id IS NOT NULL THEN json_build_array(se.pump_id) ELSE '[]'::json END
                       ) AS pump_ids
                  FROM shift_employees se
                  JOIN employees e ON e.id = se.employee_id
                 WHERE se.shift_id = $1
                 ORDER BY e.last_name, e.first_name`, [s.id]).catch(swallow('shifts:312', { rows: [] })),
  ]);
  const teamRows = (team.rows || []).map(r => {
    let pids = r.pump_ids;
    if (typeof pids === 'string') { try { pids = JSON.parse(pids); } catch (_) { pids = []; } }
    if (!Array.isArray(pids)) pids = r.pump_id != null ? [r.pump_id] : [];
    return { id: r.id, name: r.name, role: r.role, pump_id: r.pump_id, pump_ids: pids };
  });
  res.json({ ...s, counters: rd.rows, sales: sales.rows[0], fuel_declared: fd.rows[0], anomalies: an.rows,
    expenses: ex.rows[0], credit: cr.rows[0], chief: ch.rows[0]?.name || null, team: teamRows });
}));

// Rapports en lecture seule des quarts auxquels l'employé connecté a été affecté.
// La permission shift.report.own doit être accordée explicitement par l'administrateur client.
r.get('/my-reports', need('shift.report.own'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT sh.id AS shift_id, sh.number, sh.kind, sh.status, sh.opened_at, sh.closed_at,
            rp.content AS report, rp.generated_at
       FROM shift_employees se
       JOIN employees e ON e.id=se.employee_id AND e.station_id=$1 AND e.deleted_at IS NULL
       JOIN shifts sh ON sh.id=se.shift_id AND sh.station_id=$1
       LEFT JOIN LATERAL (SELECT content, generated_at FROM reports WHERE shift_id=sh.id AND kind='quart' ORDER BY id DESC LIMIT 1) rp ON true
      WHERE e.user_id=$2
      ORDER BY sh.opened_at DESC NULLS LAST, sh.id DESC LIMIT 100`, [req.sid, req.user.id]);
  res.json(rows);
}));

r.get('/:id', canReadOwnShiftReport, wrap(async (req, res) => {
  const { rows: [s] } = await pool.query('SELECT * FROM shifts WHERE id = $1 AND station_id = $2', [req.params.id, req.sid]);
  if (!s || (!broadShiftRead(req) && !(await isAssignedToShift(req.user.id, s.id, req.sid)))) throw new HttpError(404, 'Quart introuvable.');
  const [rd, an, rep] = await Promise.all([
    pool.query('SELECT * FROM meter_readings WHERE shift_id = $1', [s.id]),
    pool.query("SELECT sa.*, NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') AS employee, COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.login) AS reported_by, (e.user_id IS NOT NULL AND e.user_id = sa.created_by) AS reported_self FROM shift_anomalies sa LEFT JOIN employees e ON e.id = sa.employee_id LEFT JOIN users cu ON cu.id = sa.created_by WHERE sa.shift_id = $1 ORDER BY sa.id", [s.id]),
    pool.query("SELECT content FROM reports WHERE shift_id = $1 AND kind = 'quart' ORDER BY id DESC LIMIT 1", [s.id]),
  ]);
  res.json({ ...s, readings: rd.rows, anomalies: an.rows, report: rep.rows[0]?.content || null });
}));

r.post('/:id/anomalies', need('shift.open', 'shift.close', 'sale.create'), body(z.object({ kind: z.string().default('autre'), description: z.string().min(3), amount: z.number().optional(), employee_id: z.number().int().optional() })), wrap(async (req, res) => {
  const { rows: [s] } = await pool.query("SELECT id FROM shifts WHERE id = $1 AND station_id = $2 AND status = 'ouvert'", [req.params.id, req.sid]);
  if (!s) throw new HttpError(409, 'Quart introuvable ou non ouvert');
  // Chaque anomalie appartient à un employé du quart. Quart partagé : l'employé concerné est obligatoire.
  const { rows: team } = await pool.query('SELECT employee_id FROM shift_employees WHERE shift_id = $1', [s.id]);
  let empId = req.body.employee_id ?? null;
  // Auteur du signalement : si c'est un employé du quart qui signale depuis son propre accès, l'anomalie lui est attribuée (sans choix à faire) et le signale comme tel.
  const { rows: [me] } = await pool.query(
    `SELECT e.id AS emp_id, COALESCE(NULLIF(TRIM(u.full_name), ''), u.login) AS name, r.label AS role_label
       FROM users u LEFT JOIN roles r ON r.id = u.role_id LEFT JOIN employees e ON e.user_id = u.id AND e.station_id = $2 AND e.deleted_at IS NULL WHERE u.id = $1`, [req.user.id, req.sid]);
  const myEmpId = me && me.emp_id != null && team.some(t => Number(t.employee_id) === Number(me.emp_id)) ? Number(me.emp_id) : null;
  if (empId == null && myEmpId != null && team.length >= 2) empId = myEmpId;
  if (empId == null && team.length === 1) empId = Number(team[0].employee_id);
  if (empId == null && team.length >= 2) throw new HttpError(400, "Quart partagé : indiquez l'employé concerné par cette anomalie.");
  if (empId != null && team.length && !team.some(t => Number(t.employee_id) === Number(empId))) throw new HttpError(400, "Cet employé ne fait pas partie du quart.");
  const out = await tx(async c => {
    const { rows: [a] } = await c.query('INSERT INTO shift_anomalies(shift_id, kind, description, amount, created_by, employee_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [s.id, req.body.kind, req.body.description, req.body.amount ?? null, req.user.id, empId]);
    // Une anomalie chiffrée devient un écart du profil de l'employé : le gérant décide ensuite (dette, retenue sur salaire…)
    if (empId != null && a.amount != null && Number(a.amount) !== 0)
      await c.query("INSERT INTO employee_gaps(station_id, shift_id, employee_id, kind, amount, anomaly_id) VALUES ($1,$2,$3,'anomalie',$4,$5)", [req.sid, s.id, empId, a.amount, a.id]);
    return a;
  });
  const a = out;
  const selfReport = empId != null && myEmpId != null && Number(empId) === myEmpId;   // l'employé concerné a lui-même signalé l'anomalie
  const byWho = selfReport ? "par l'employé lui-même" : `par ${me?.name || req.user.login}${me?.role_label ? ' (' + me.role_label + ')' : ''}`;
  if (empId != null) await require('./employee_actions').track(pool, { stationId: req.sid, employeeId: empId, kind: 'anomalie', amount: a.amount, refTable: 'shift_anomalies', refId: a.id, actorUserId: req.user.id, description: `Anomalie signalée ${byWho} : ${a.description}` });
  try {
    const { rows: [actor] } = await pool.query('SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
    if (actor?.client_id) await sendSystemAlert({
      clientId: actor.client_id, actorUserId: req.user.id, employeeUserId: null,
      kind: 'incident_note', body: `Incident signalé sur le quart ${req.params.id} ${byWho}${empId != null ? ' — employé concerné : ' + (await pool.query("SELECT TRIM(first_name || ' ' || last_name) AS n FROM employees WHERE id = $1", [empId])).rows[0]?.n : ''} : ${a.description}${a.amount == null ? '' : ` (montant/écart : ${a.amount})`}`,
      refTable: 'shift_anomalies', refId: a.id, stationId: req.sid
    });
  } catch (alertError) { console.warn('[alertes] Note d’incident enregistrée mais non notifiée:', alertError.message); }
  safeEmailAlert(notifyAnomalie, await stationName(req.sid), `Incident sur le quart ${req.params.id} signalé ${byWho} : ${a.description}${a.amount == null ? '' : ` (montant/écart : ${a.amount})`}`).catch(() => {});
  res.status(201).json(a);
}));

const closeSchema = z.object({
  counters: z.array(z.object({ counter_id: z.number().int(), index_end: z.number().min(0) })).min(1),
  non_cash: z.object({
    mobile_money: z.number().min(0).default(0), card: z.number().min(0).default(0),
    credit: z.number().min(0).default(0), credit_customer_id: z.number().int().optional(),
  }).default({}),
  counted_cash: z.number().min(0),
  // Quart partagé (2 employés ou plus) : situation propre à chaque employé (espèces remises + paiements non espèces de SES pompes)
  employee_closings: z.array(z.object({ employee_id: z.number().int(), counted_cash: z.number().min(0), mobile_money: z.number().min(0).default(0), card: z.number().min(0).default(0), credit: z.number().min(0).default(0) })).default([]),
  stock_counts: z.array(z.object({ product_id: z.number().int(), physical: z.number().min(0) })).default([]),
  justification: z.string().default(''),
  observations: z.string().default(''),
  // Date/heure de clôture optionnelle (quarts passés). Si absente → now().
  closed_at: z.string().min(10).max(40).optional(),
});

// CLÔTURE : compteurs → litres → ventes → caisse → stock, avec détection des incohérences.
// ?preview=1 calcule le résumé sans rien enregistrer (écran « Avant validation »).
// closed_at optionnel : permet de dater la clôture dans le passé (après opened_at, pas dans le futur).
/** Corrige UNE vente carburant d'un quart ouvert : elle est remise au nom du responsable de sa pompe (affectation d'ouverture). Tracé : audit + anomalie « rattachement » au dossier de l'employé. */
r.post('/:id/sales/:saleId/reassign-to-pump-owner', need('shift.close'), wrap(async (req, res) => {
  const out = await tx(async c => {
    const { rows: [s] } = await c.query('SELECT id, number, status FROM shifts WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
    if (!s) throw new HttpError(404, 'Quart introuvable');
    if (s.status !== 'ouvert') throw new HttpError(409, "Ce quart n'est pas ouvert : correction impossible");
    const { rows: [sale] } = await c.query("SELECT id, pump_id, employee_id, total FROM sales WHERE id = $1 AND shift_id = $2 AND station_id = $3 AND kind = 'carburant' AND status = 'valide' FOR UPDATE", [req.params.saleId, s.id, req.sid]);
    if (!sale || sale.pump_id == null) throw new HttpError(404, 'Vente carburant introuvable sur ce quart');
    const { rows: own } = await c.query(
      `SELECT employee_id FROM shift_employees WHERE shift_id = $1 AND pump_id = $2 UNION SELECT employee_id FROM shift_employee_pumps WHERE shift_id = $1 AND pump_id = $2`, [s.id, sale.pump_id]);
    const owners = [...new Set(own.map(o => Number(o.employee_id)))];
    if (owners.length !== 1) throw new HttpError(409, owners.length ? 'Pompe partagée par plusieurs employés : correction automatique impossible' : "Cette pompe n'a pas de responsable sur ce quart : rien à corriger");
    const to = owners[0], from = sale.employee_id == null ? null : Number(sale.employee_id);
    if (from === to) throw new HttpError(409, 'Cette vente est déjà au nom du responsable de la pompe');
    const { rows: names } = await c.query("SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name FROM employees WHERE station_id = $1 AND id = ANY($2)", [req.sid, [to, from].filter(x => x != null)]);
    const nm = id => (names.find(e => Number(e.id) === Number(id)) || {}).name || (id == null ? 'aucun employé' : 'Employé ' + id);
    await c.query('UPDATE sales SET employee_id = $2 WHERE id = $1 AND shift_id = $3', [sale.id, to, s.id]);
    await c.query('SAVEPOINT attr_fix');
    try { await c.query("UPDATE employee_actions SET employee_id = $3 WHERE ref_table = 'sales' AND ref_id = $1 AND station_id = $4 AND employee_id IS NOT DISTINCT FROM $2", [sale.id, from, to, req.sid]); await c.query('RELEASE SAVEPOINT attr_fix'); }
    catch (_) { await c.query('ROLLBACK TO SAVEPOINT attr_fix'); }
    const desc = `Vente carburant n° ${sale.id} (${sale.total}) saisie au nom de ${nm(from)}, remise au nom de ${nm(to)} (responsable de la pompe)`;
    await c.query('INSERT INTO shift_anomalies(shift_id, kind, description, amount, created_by, employee_id) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, 'rattachement', desc, sale.total, req.user.id, to]);
    await audit(c, req, 'quart', `${desc}, quart ${s.number}`, 'sales', sale.id, { employee_id: from }, { employee_id: to });
    return { sale_id: sale.id, from: nm(from), to: nm(to) };
  });
  res.json(out);
}));

r.post('/:id/close', need('shift.close'), body(closeSchema), wrap(async (req, res) => {
  const b = req.body;
  try {
    const report = await tx(async c => {
      const { rows: [s] } = await c.query('SELECT * FROM shifts WHERE id = $1 AND station_id = $2 FOR UPDATE', [req.params.id, req.sid]);
      if (!s) throw new HttpError(404, 'Quart introuvable');
      if (s.status !== 'ouvert') throw new HttpError(409, "Ce quart n'est pas ouvert");
      // Résolution closed_at (passé autorisé, futur interdit, doit être >= opened_at)
      let resolvedClosedAt = null; // null → now() SQL
      if (b.closed_at) {
        const d = new Date(b.closed_at);
        if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Date/heure de clôture invalide');
        if (d.getTime() > Date.now() + 60_000) throw new HttpError(400, 'La date/heure de clôture ne peut pas être dans le futur');
        if (s.opened_at && d.getTime() < new Date(s.opened_at).getTime() - 1000)
          throw new HttpError(400, 'La clôture ne peut pas être antérieure à l\'ouverture du quart');
        resolvedClosedAt = d;
      }
      // Placement chronologique : si des quarts plus récents existent, ce quart est « dans le passé ».
      const nbc = s.opened_at ? await shiftNeighbours(c, req.sid, new Date(s.opened_at), s.id) : { previous: null, next: null };
      const notLatest = !!nbc.next;
      if (notLatest) {
        if (!resolvedClosedAt) throw new HttpError(400, 'Ce quart est antérieur au quart N° ' + nbc.next.number + ' : indiquez sa date/heure de clôture réelle.');
        if (resolvedClosedAt.getTime() > new Date(nbc.next.opened_at).getTime() + 1000)
          throw new HttpError(409, 'La clôture ne peut pas être postérieure à l\'ouverture du quart suivant N° ' + nbc.next.number + ' (' + fmtDt(nbc.next.opened_at) + ').');
      }
      const nbIdx = notLatest ? await neighbourIndexes(c, req.sid, new Date(s.opened_at), s.id) : { prevEnd: {}, nextStart: {} };
      const tol = await setting(c, req.sid, 'tolerance_fuel_liters', 5);
      const an = []; // anomalies détectées : [type, description, montant]
      const gaps = []; // écarts de stock à enregistrer pour attribution

      // A. Compteurs → litres → montant théorique (produit lu sur le compteur, jamais codé en dur)
      const { rows: rd } = await c.query(
        `SELECT m.*, p.sell_price, p.buy_price, p.name AS pname, pc.counter_number, pu.name AS pump_name
           FROM meter_readings m JOIN products p ON p.id = m.product_id JOIN pump_counters pc ON pc.id = m.counter_id JOIN pumps pu ON pu.id = m.pump_id
          WHERE m.shift_id = $1 ORDER BY pu.number, pc.counter_number`, [s.id]);
      const fuel = {}, counters = []; let fuelTotal = 0;
      for (const m of rd) {
        const k = b.counters.find(x => x.counter_id === m.counter_id);
        const label = `${m.pump_name} compteur ${m.counter_number}`;
        if (!k) throw new HttpError(400, 'Index final manquant : ' + label);
        if (k.index_end < m.index_start) throw new HttpError(400, 'Index final inférieur à l\'index initial : ' + label);
        const laterStart = notLatest ? nbIdx.nextStart[m.counter_id] : null;
        if (laterStart && k.index_end > laterStart.index + 0.0005)
          throw new HttpError(400, `Index final supérieur à l'index initial du quart suivant N° ${laterStart.number} (${laterStart.index}) : ` + label);
        const liters = f3(k.index_end - m.index_start), amount = fl(liters * m.sell_price);
        await c.query('UPDATE meter_readings SET index_end = $2, unit_price = $3, amount = $4, unit_cost = $5 WHERE id = $1', [m.id, k.index_end, m.sell_price, amount, m.buy_price]);
        if (!notLatest) await c.query('UPDATE pump_counters SET current_index = $2 WHERE id = $1', [m.counter_id, k.index_end]);
        const o = fuel[m.product_id] ??= { name: m.pname, liters: 0, amount: 0, cost: 0 };
        o.liters = f3(o.liters + liters); o.amount = fl(o.amount + amount); o.cost = fl(o.cost + liters * m.buy_price);
        fuelTotal = fl(fuelTotal + amount);
        counters.push({ pump_id: m.pump_id, product_id: m.product_id, pump: m.pump_name, counter: m.counter_number, product: m.pname, index_start: m.index_start, index_end: k.index_end, liters, unit_price: m.sell_price, amount });
      }

      // A'. Rattachement par employé : chacun n'est responsable que de SES pompes (attribuées à l'ouverture), SES ventes saisies,
      // SES espèces remises. Un employé seul sur le quart est responsable de tout (comportement historique).
      const { rows: teamRows } = await c.query(
        `SELECT se.employee_id AS id, TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS name
           FROM shift_employees se JOIN employees e ON e.id = se.employee_id WHERE se.shift_id = $1 ORDER BY se.employee_id`, [s.id]);
      const { rows: ownRows } = await c.query(
        `SELECT employee_id, pump_id FROM shift_employees WHERE shift_id = $1 AND pump_id IS NOT NULL
         UNION SELECT employee_id, pump_id FROM shift_employee_pumps WHERE shift_id = $1`, [s.id]);
      // A''. Vérification du rattachement : chaque vente carburant doit être au nom du responsable de SA pompe (affectation d'ouverture).
      // Une vente au nom d'un autre employé BLOQUE la clôture (aperçu compris) : le gérant la corrige explicitement (POST /:id/sales/:saleId/reassign-to-pump-owner), tracé à l'audit.
      const { rows: fuelSalesRows } = await c.query("SELECT id, pump_id, employee_id, total FROM sales WHERE shift_id = $1 AND kind = 'carburant' AND status = 'valide' AND pump_id IS NOT NULL ORDER BY id", [s.id]);
      const ownersByPump = new Map();
      for (const r of ownRows) { const pid = Number(r.pump_id); if (!ownersByPump.has(pid)) ownersByPump.set(pid, new Set()); ownersByPump.get(pid).add(Number(r.employee_id)); }
      const attrCheck = checkFuelSalesAttribution(fuelSalesRows, ownersByPump);
      if (attrCheck.fixes.length) {
        const { rows: allEmpNames } = await c.query("SELECT id, TRIM(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) AS name FROM employees WHERE station_id = $1", [req.sid]);
        const { rows: pumpNames } = await c.query('SELECT id, name FROM pumps WHERE station_id = $1', [req.sid]);
        const nmE = id => (allEmpNames.find(e => Number(e.id) === Number(id)) || {}).name || (id == null ? 'aucun employé' : 'Employé ' + id);
        const nmP = id => (pumpNames.find(p => Number(p.id) === Number(id)) || {}).name || ('pompe ' + id);
        throw new HttpError(409, `Clôture bloquée : ${attrCheck.fixes.length} vente(s) carburant ne sont pas au nom du responsable de leur pompe. Corrigez-les puis relancez la clôture`,
          attrCheck.fixes.map(fx => ({ sale_id: fx.sale_id, description: `Vente n° ${fx.sale_id} (${fx.total}) saisie au nom de ${nmE(fx.from)} ; ${nmP(fx.pump_id)} est affectée à ${nmE(fx.to)}` })));
      }
      const { rows: decEmp } = await c.query("SELECT employee_id, COALESCE(SUM(total),0) AS t FROM sales WHERE shift_id = $1 AND kind = 'carburant' AND status = 'valide' AND employee_id IS NOT NULL GROUP BY employee_id", [s.id]);
      const { rows: cashEmp } = await c.query("SELECT sa.employee_id, COALESCE(SUM(p.amount),0) AS t FROM payments p JOIN sales sa ON sa.id = p.sale_id WHERE sa.shift_id = $1 AND sa.status = 'valide' AND p.method = 'especes' AND sa.employee_id IS NOT NULL GROUP BY sa.employee_id", [s.id]);
      const { rows: qtyEmp } = await c.query("SELECT sa.employee_id, d.product_id, COALESCE(SUM(d.quantity),0) AS q FROM sale_details d JOIN sales sa ON sa.id = d.sale_id WHERE sa.shift_id = $1 AND sa.status = 'valide' AND sa.employee_id IS NOT NULL GROUP BY sa.employee_id, d.product_id", [s.id]);
      const team = teamRows.map(t => ({ id: Number(t.id), name: t.name || ('Employé ' + t.id) }));
      const multi = team.length >= 2, soleId = team.length === 1 ? team[0].id : null;
      const nameById = id => (team.find(t => t.id === Number(id)) || {}).name || ('Employé ' + id);
      const soldQty = new Map();
      for (const r of qtyEmp) { const pid = Number(r.product_id); if (!soldQty.has(pid)) soldQty.set(pid, new Map()); soldQty.get(pid).set(Number(r.employee_id), Number(r.q)); }
      let empCl, fuelEmp, ownersMap;
      try {
        ownersMap = attr.buildPumpOwners(ownRows);
        fuelEmp = attr.fuelByEmployee(counters, ownersMap, soleId);
        empCl = attr.computeEmployeeClosings({
          team, fuelByEmp: fuelEmp,
          declaredFuelByEmp: new Map(decEmp.map(x => [Number(x.employee_id), Number(x.t)])),
          cashDeclaredByEmp: new Map(cashEmp.map(x => [Number(x.employee_id), Number(x.t)])),
          inputs: multi ? b.employee_closings : [], requireInputs: multi && !req.query.preview });
      } catch (e) { if (e instanceof attr.AttributionError) throw new HttpError(400, e.message); throw e; }
      if (multi) for (const r of empCl.rows) if (r.overdeclared > 0)
        an.push(['ecart_compteur', `Ventes carburant déclarées par ${r.name} supérieures aux compteurs de ses pompes (de ${fmtQ(r.overdeclared)} FCFA)`, -r.overdeclared, r.employee_id]);

      // B. Ventes : carburant réparti par moyen de paiement, autres ventes déjà enregistrées
      let { mobile_money: mm, card, credit, credit_customer_id: cid } = b.non_cash;
      if (multi) {   // quart partagé : les paiements non espèces sont ceux saisis par chaque employé pour SES pompes
        // Quart partagé : paiements non espèces de chaque employé (pour SES pompes) + ceux saisis globalement = pompes sans employé
        const t = empCl.non_cash_total;
        if (fl(mm + card + credit) > 0 && !(empCl.unowned && empCl.unowned.amount > 0))
          throw new HttpError(400, "Aucune pompe sans employé sur ce quart : saisissez les paiements non espèces employé par employé.");
        mm = fl(mm + t.mobile_money); card = fl(card + t.card); credit = fl(credit + t.credit);
      }
      // Ventes carburant déclarées pendant le quart (index, litres ou montant) : le reste des litres des compteurs est traité comme vendu en espèces
      const { rows: [dec] } = await c.query("SELECT COALESCE(SUM(total), 0) AS total FROM sales WHERE shift_id = $1 AND kind = 'carburant' AND status = 'valide'", [s.id]);
      const { rows: decPay } = await c.query("SELECT p.method, SUM(p.amount) AS amount FROM payments p JOIN sales sa ON sa.id = p.sale_id WHERE sa.shift_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide' GROUP BY p.method", [s.id]);
      const declared = fl(dec.total), undeclared = fl(fuelTotal - declared);
      if (undeclared < -0.01) an.push(['ecart_compteur', `Ventes carburant déclarées (${fmtQ(declared)} FCFA) supérieures aux compteurs (${fmtQ(fuelTotal)} FCFA)`, undeclared]);
      const rest = Math.max(undeclared, 0), decBy = Object.fromEntries(decPay.map(x => [x.method, x.amount]));
      const fuelCash = fl(rest - mm - card - credit);
      if (fuelCash < 0) throw new HttpError(400, `Les paiements non espèces dépassent le carburant non déclaré (${rest})`);
      if (credit > 0) {
        if (!cid) throw new HttpError(400, 'Client requis pour le carburant à crédit');
        const { rows: [cu] } = await c.query('SELECT * FROM customers WHERE id = $1 AND station_id = $2 FOR UPDATE', [cid, req.sid]);
        if (!cu) throw new HttpError(400, 'Client inconnu');
        if (cu.credit_limit > 0 && cu.balance + credit > cu.credit_limit) throw new HttpError(409, 'Limite de crédit dépassée pour ' + cu.name);
        await c.query('UPDATE customers SET balance = balance + $2 WHERE id = $1 AND station_id = $3', [cid, credit, req.sid]);
        await ledger(c, { customer: cid, station: req.sid, kind: 'credit', amount: credit, ref: ['shifts', s.id], by: req.user.id });
      }
      for (const [method, amount] of [['especes', fuelCash], ['mobile_money', mm], ['carte', card], ['credit', credit]])
        if (amount > 0) {
          await c.query("INSERT INTO payments(station_id, shift_id, method, amount, reference, created_by) VALUES ($1,$2,$3,$4,'carburant',$5)", [req.sid, s.id, method, amount, req.user.id]);
          if (method === 'mobile_money' || method === 'carte') {
            await assertLinkedMethod(c, req.sid, method);
            const accId = await accountMove(c, { station: req.sid, method, amount, label: 'Carburant, quart ' + s.number, ref: ['shifts', s.id], shift: s.id, by: req.user.id });
            if (accId == null) throw new HttpError(409, 'Aucun compte rattaché au moyen « ' + method + ' » pour la clôture carburant.');
          }
        }
      const { rows: other } = await c.query(
        `SELECT p.method, SUM(p.amount) AS amount FROM payments p JOIN sales sa ON sa.id = p.sale_id WHERE sa.shift_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits' GROUP BY p.method`, [s.id]);
      const otherTotal = fl(other.reduce((a, x) => a + x.amount, 0));
      const { rows: shopRows } = await c.query(`SELECT pr.id AS product_id, pr.name AS product, pr.unit, SUM(d.quantity) AS quantity, SUM(d.amount) AS amount FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN products pr ON pr.id = d.product_id WHERE sa.shift_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits' GROUP BY pr.id, pr.name, pr.unit ORDER BY pr.name`, [s.id]);
      const shopSales = shopRows.map(x => ({ product: x.product, unit: x.unit, quantity: Number(x.quantity), amount: fl(x.amount) }));
      const shopQty = new Map(shopRows.map(x => [Number(x.product_id), Number(x.quantity)]));

      // C. Caisse : théorique = solde actuel + espèces carburant ; écart = physique − théorique
      const { rows: [reg] } = await c.query('SELECT balance FROM cash_registers WHERE id = $1 FOR UPDATE', [s.cash_register_id]);
      // Quart le plus récent : solde courant. Quart ancien : caisse initiale + mouvements rattachés à ce quart (le solde courant inclut les quarts suivants).
      let baseCash = reg.balance;
      if (notLatest) {
        const { rows: [mv] } = await c.query('SELECT COALESCE(SUM(amount), 0) AS t FROM cash_movements WHERE shift_id = $1 AND cash_register_id = $2', [s.id, s.cash_register_id]);
        baseCash = fl(Number(s.opening_cash) + Number(mv.t));
      }
      const theoretical = fl(baseCash + fuelCash), gap = fl(b.counted_cash - theoretical);
      if (gap !== 0) an.push(['ecart_caisse', 'Écart de caisse : ' + fmtQ(gap) + ' FCFA' + (multi ? ' (ensemble du quart)' : ''), gap]);
      if (multi) for (const r of empCl.rows) if (r.cash_gap && Math.abs(r.cash_gap) > attr.EPS) an.push(['ecart_caisse', `Écart de caisse de ${r.name} : ${fmtQ(r.cash_gap)} FCFA`, r.cash_gap, r.employee_id]);
      const incomplete = multi && empCl.rows.some(r => r.in_team && r.counted_cash == null);   // aperçu sans toutes les saisies
      const residGap = multi && !incomplete ? attr.residualGap(gap, empCl.rows) : null;         // part non attribuable à un employé
      if (fuelCash > 0) await cashMove(c, { reg: s.cash_register_id, shift: s.id, kind: 'encaissement', amount: fuelCash, label: 'Recette carburant espèces, quart ' + s.number, by: req.user.id });
      if (gap !== 0) await cashMove(c, { reg: s.cash_register_id, shift: s.id, kind: 'ecart_cloture', amount: gap, label: 'Écart de clôture, quart ' + s.number, by: req.user.id });

      // D. Stock : les litres vendus sortent du stock, puis comparaison avec l'inventaire physique
      const { rows: prods } = await c.query(
        `SELECT p.id, p.name, p.unit, cat.code AS cat, COALESCE(st.quantity, 0) AS qty FROM products p JOIN categories cat ON cat.id = p.category_id
           LEFT JOIN stock st ON st.product_id = p.id WHERE p.station_id = $1 AND p.deleted_at IS NULL`, [req.sid]);
      const stock = [];
      for (const p of prods) {
        const lit = fuel[p.id]?.liters || 0;
        if (lit > 0) await stockMove(c, { station: req.sid, product: p.id, kind: 'vente', qty: -lit, shift: s.id, ref: ['meter_readings', s.id], comment: 'Carburant, quart ' + s.number, by: req.user.id, allowNegative: true });
        let baseQty = p.qty;
        if (notLatest) {
          const { rows: [sc] } = await c.query('SELECT opening_stock FROM shift_stock_counts WHERE shift_id = $1 AND product_id = $2', [s.id, p.id]);
          const { rows: [sm] } = await c.query('SELECT COALESCE(SUM(quantity), 0) AS t FROM stock_movements WHERE shift_id = $1 AND product_id = $2', [s.id, p.id]);
          baseQty = f3(Number(sc ? sc.opening_stock : p.qty) + Number(sm.t) + lit); // + lit : la sortie carburant (-lit) vient d'être enregistrée ci-dessus et est retranchée plus bas
        }
        const theo = f3(baseQty - lit), cnt = b.stock_counts.find(x => x.product_id === p.id);
        let sg = null;
        if (theo < 0) an.push(['ecart_stock', 'Stock théorique négatif : ' + p.name, theo]);
        if (cnt) {
          sg = f3(cnt.physical - theo);
          if (Math.abs(sg) > (p.cat === 'CARBURANT' ? tol : 0)) {
            an.push(['ecart_stock', `Écart de stock ${cleanName(p.name)} : ${fmtQ(sg)} ${cleanName(p.unit) || '(quantité)'}`, sg]);
            const parts = multi ? attr.attributeStockGap({ gap: sg, productId: p.id, fuelByEmp: fuelEmp, soldQtyByEmp: soldQty }) : null;
            gaps.push({ product: p.id, name: p.name, amount: sg, parts });
            if (parts) for (const x of parts) if (x.employee_id != null) an.push(['ecart_stock', `Écart de stock ${cleanName(p.name)} imputé à ${nameById(x.employee_id)} : ${fmtQ(x.amount)} ${cleanName(p.unit) || '(quantité)'}`, x.amount, x.employee_id]);
          }
          if (sg !== 0) await stockMove(c, { station: req.sid, product: p.id, kind: 'correction', qty: sg, shift: s.id, comment: 'Inventaire, quart ' + s.number, by: req.user.id, allowNegative: true });
        }
        await c.query('UPDATE shift_stock_counts SET theoretical = $3, physical = $4, gap = $5 WHERE shift_id = $1 AND product_id = $2', [s.id, p.id, theo, cnt?.physical ?? null, sg]);
        if (lit > 0 || cnt || shopQty.get(Number(p.id)) > 0) stock.push({ product: p.name, theoretical: theo, physical: cnt?.physical ?? null, gap: sg });
      }

      const anomalies = an.map(a => ({ kind: a[0], description: a[1], amount: a[2], employee_id: a[3] ?? null, employee: a[3] != null ? nameById(a[3]) : null }));
      const { rows: manual } = await c.query(
        `SELECT sa.kind, sa.description, sa.amount, sa.employee_id, NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') AS employee, COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.login) AS reported_by, (e.user_id IS NOT NULL AND e.user_id = sa.created_by) AS reported_self
           FROM shift_anomalies sa LEFT JOIN employees e ON e.id = sa.employee_id LEFT JOIN users cu ON cu.id = sa.created_by WHERE sa.shift_id = $1 ORDER BY sa.id`, [s.id]);
      const pumpName = new Map(rd.map(m => [Number(m.pump_id), m.pump_name]));
      const employeesReport = empCl.rows.map(r => ({
        employee_id: r.employee_id, name: r.name,
        pumps: [...ownersMap.entries()].filter(([, e]) => e === r.employee_id).map(([pid]) => pumpName.get(pid)).filter(Boolean),
        fuel_liters: r.fuel_liters, fuel_amount: r.fuel_amount, declared_fuel: r.declared_fuel, undeclared: r.undeclared, non_cash: r.non_cash, cash_declared: r.cash_declared,
        expected_cash: multi ? r.expected_cash : null, counted_cash: multi ? r.counted_cash : null,
        cash_gap: multi ? r.cash_gap : (soleId === r.employee_id ? gap : null),
        stock_gaps: gaps.flatMap(g => (g.parts || (soleId != null ? [{ employee_id: soleId, amount: g.amount }] : [])).filter(x => x.employee_id === r.employee_id).map(x => ({ product: g.name, amount: x.amount }))),
      }));
      const unassigned = multi ? { cash_gap: residGap, fuel_amount: empCl.unowned ? empCl.unowned.amount : 0,
        stock_gaps: gaps.flatMap(g => (g.parts || []).filter(x => x.employee_id == null).map(x => ({ product: g.name, amount: x.amount }))) } : null;
      const report = {
        shift: { id: s.id, number: s.number, kind: s.kind, opened_at: s.opened_at, closed_at: resolvedClosedAt ? resolvedClosedAt.toISOString() : null, manager: req.user.login, opening_cash: s.opening_cash },
        counters, fuel: Object.values(fuel), fuel_total: fuelTotal,
        fuel_payments: { especes: fl(fuelCash + (decBy.especes || 0)), mobile_money: fl(mm + (decBy.mobile_money || 0)), carte: fl(card + (decBy.carte || 0)), credit: fl(credit + (decBy.credit || 0)), autres: fl(decPay.filter(x => !['especes', 'mobile_money', 'carte', 'credit'].includes(x.method)).reduce((a, x) => a + x.amount, 0)) },
        fuel_declared: { total: declared, undeclared: rest, by_method: decPay },
        other_sales: { total: otherTotal, by_method: other },
        shop_sales: shopSales,
        cash: { opening: s.opening_cash, theoretical, counted: b.counted_cash, gap },
        stock, anomalies: [...manual, ...anomalies],
        employees: employeesReport, unassigned, shared: multi,
        attribution_check: { checked_sales: attrCheck.checked, mismatches: 0 },
      };
      if (req.query.preview) throw new Preview(report); // annule tout : simple aperçu

      if (an.length && !b.justification.trim())
        throw new HttpError(422, 'Justification obligatoire : des anomalies ont été détectées', anomalies);

      // Écarts rattachés à l'employé à l'origine. Employé seul : tout est à lui. Quart partagé : chacun pour SES pompes, SES ventes
      // et SES espèces remises ; ce qui n'est attribuable à personne reste sans employé (attribution manuelle par le gérant ensuite).
      const insGap = (emp, kind, amount, product = null) => c.query(
        'INSERT INTO employee_gaps(station_id, shift_id, employee_id, kind, product_id, amount) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.sid, s.id, emp, kind, product, amount]);
      if (multi) {
        for (const r of empCl.rows) if (r.cash_gap && Math.abs(r.cash_gap) > attr.EPS) await insGap(r.employee_id, 'caisse', r.cash_gap);
        if (residGap != null && Math.abs(residGap) > attr.EPS) await insGap(null, 'caisse', residGap);
      } else if (gap !== 0) await insGap(soleId, 'caisse', gap);
      for (const g of gaps) {
        if (g.parts) for (const x of g.parts) await insGap(x.employee_id, 'stock', x.amount, g.product);
        else await insGap(soleId, 'stock', g.amount, g.product);
      }
      for (const a of an) await c.query('INSERT INTO shift_anomalies(shift_id, kind, description, amount, created_by, employee_id) VALUES ($1,$2,$3,$4,$5,$6)', [s.id, a[0], a[1], a[2], req.user.id, a[3] ?? null]);
      const closedIso = resolvedClosedAt ? resolvedClosedAt.toISOString() : null;
      // Écritures générées par cette clôture (recette carburant, écart de caisse, sorties de stock, paiements) :
      // horodatées à la date de clôture réelle pour que les rapports par période les placent correctement.
      // (now() est constant dans la transaction : created_at = now() désigne exactement les lignes créées ici.)
      if (closedIso && closedIso.slice(0, 10) < new Date().toISOString().slice(0, 10)) {
        await c.query('UPDATE cash_movements SET created_at = $2::timestamptz WHERE shift_id = $1 AND created_at = now()', [s.id, closedIso]);
        await c.query('UPDATE stock_movements SET created_at = $2::timestamptz WHERE shift_id = $1 AND created_at = now()', [s.id, closedIso]);
        await c.query('UPDATE payments SET paid_at = $2::timestamptz WHERE shift_id = $1 AND paid_at = now()', [s.id, closedIso]);
        await c.query('UPDATE money_movements SET created_at = $2::timestamptz, moved_on = $2::date WHERE shift_id = $1 AND created_at = now()', [s.id, closedIso]);
      }
      await c.query(
        `UPDATE shifts SET status = 'ferme', closed_at = COALESCE($8::timestamptz, now()), closed_by = $2, theoretical_cash = $3, counted_cash = $4, cash_gap = $5, gap_justification = $6, observations = $7 WHERE id = $1 AND station_id = $9`,
        [s.id, req.user.id, theoretical, b.counted_cash, gap, b.justification, b.observations, closedIso, req.sid]);
      // Relecture pour le rapport / audit
      const { rows: [closedRow] } = await c.query('SELECT closed_at FROM shifts WHERE id = $1', [s.id]);
      if (report.shift) report.shift.closed_at = closedRow?.closed_at || closedIso;
      if (an.length) await c.query("INSERT INTO notifications(station_id, level, kind, message, ref_table, ref_id) VALUES ($1,$2,$3,$4,'shifts',$5)",
        [req.sid, gap !== 0 ? 'warning' : 'info', gap !== 0 ? 'ecart_caisse' : 'anomalie', `Quart ${s.number} clôturé avec ${an.length} anomalie(s)`, s.id]);
      await c.query("INSERT INTO reports(station_id, shift_id, kind, content, generated_by) VALUES ($1,$2,'quart',$3,$4)", [req.sid, s.id, JSON.stringify(report), req.user.id]);
      const closedBackdated = !!(closedIso && closedIso.slice(0, 10) < new Date().toISOString().slice(0, 10));
      await audit(c, req, 'quarts',
        closedBackdated
          ? ('Clôture du quart N° ' + s.number + ' (date antérieure ' + closedIso.slice(0, 10) + ')')
          : ('Clôture du quart N° ' + s.number),
        'shifts', s.id,
        { statut: 'ouvert' },
        { statut: 'ferme', ecart_caisse: gap, closed_at: closedIso || closedRow?.closed_at, backdated: closedBackdated });
      return report;
    });
    // Déclenche une notification client après la validation de la clôture. L’envoi
    // d’alerte ne doit jamais annuler une clôture métier déjà validée.
    if (report?.cash?.gap) {
      try {
        const { rows: [actor] } = await pool.query('SELECT client_id FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user.id]);
        if (actor?.client_id) {
          const absoluteGap = Math.abs(Number(report.cash.gap));
          const base = Math.max(1, Math.abs(Number(report.cash.theoretical) || 0));
          await sendSystemAlert({
            clientId: actor.client_id, actorUserId: req.user.id, employeeUserId: report.shared ? null : req.user.id, kind: 'cash_variance',
            body: `Écart de caisse à la fermeture du quart ${report.shift?.number ?? ''} : ${report.cash.gap} FCFA. Vérification requise.`,
            refTable: 'shifts', refId: report.shift?.id || null, stationId: req.sid,
            metricValue: absoluteGap, metricUnit: 'XOF', metricPercent: absoluteGap / base * 100
          });
        }
      } catch (alertError) { console.warn('[alertes] Impossible de notifier l’écart de clôture:', alertError.message); }
    }
    // Écarts et anomalies de chaque employé : historique de son profil + message dans SA messagerie (jamais ceux d'un collègue)
    if (report) await require('./employee_actions').afterClose(req, report.shift.id, report.shift.number);
    if (report) {
      try {
        const { rows: [actorRow] } = await pool.query('SELECT client_id FROM users WHERE id = $1', [req.user.id]);
        if (actorRow?.client_id) await require('./notification_rules').fireNotificationRules({ clientId: actorRow.client_id, trigger: 'on_report_create', reportKey: 'shifts', actorUserId: req.user.id, extra: { note: `Quart n° ${report.shift?.number ?? ''} clôturé par ${req.user.login}.` } });
      } catch (ruleError) { console.warn('[notification-rules] clôture de quart :', ruleError.message); }
    }
    if (report) {
      const station = await stationName(req.sid).catch(() => `Station ${req.sid}`);
      safeEmailAlert(notifyQuartEvent, 'fermeture', station, { number: report.shift?.number, user: req.user.login, date: report.shift?.closed_at || new Date().toISOString(), cashGap: report.cash?.gap, details: `${report.anomalies?.length || 0} anomalie(s)` }).catch(() => {});
      if (Math.abs(Number(report.cash?.gap) || 0) > 0) safeEmailAlert(notifyAnomalie, station, `Écart de caisse à la fermeture du quart ${report.shift?.number ?? ''} : ${report.cash.gap} FCFA.`).catch(() => {});
    }
    res.json({ preview: false, report });
  } catch (e) {
    if (e instanceof Preview) return res.json({ preview: true, report: e.data });
    throw e;
  }
}));


/** Priorité 7 — Rapport consolidé d'un quart */
// Journalise (au lieu d'avaler) une requête partielle de la fiche complète : la fiche reste affichable, mais l'erreur est visible dans les logs.
const logFullErr = label => e => { console.warn('[quart/full] requête en échec' + (label ? ' (' + label + ')' : '') + ' :', e.message); return { rows: [] }; };
r.get('/:id/full', canReadOwnShiftReport, wrap(async (req, res) => {
  const id = +req.params.id;
  const { rows: [s] } = await pool.query(
    `SELECT sh.*, u1.login AS opened_by_login, u2.login AS closed_by_login, cr.name AS cash_register_name
     FROM shifts sh
     LEFT JOIN users u1 ON u1.id = sh.manager_id
     LEFT JOIN users u2 ON u2.id = sh.closed_by
     LEFT JOIN cash_registers cr ON cr.id = sh.cash_register_id
     WHERE sh.id = $1 AND sh.station_id = $2`, [id, req.sid]);
  if (!s) throw new HttpError(404, 'Quart introuvable');
  if (!broadShiftRead(req)) {
    if (!(await isAssignedToShift(req.user.id, s.id, req.sid))) throw new HttpError(404, 'Quart introuvable.');
    const { rows: [rp] } = await pool.query("SELECT content, generated_at FROM reports WHERE shift_id=$1 AND kind='quart' ORDER BY id DESC LIMIT 1", [s.id]);
    return res.json({ own_report: true, shift: { id: s.id, number: s.number, kind: s.kind, status: s.status, opened_at: s.opened_at, closed_at: s.closed_at }, report: rp?.content || null, generated_at: rp?.generated_at || null });
  }

  const [emps, meters, sales, payments, expenses, cashMoves, anomalies, gaps, advances, snapshot, declaredFuel] = await Promise.all([
    pool.query(
      `SELECT e.id, e.matricule, e.first_name, e.last_name, e.position, se.role_in_shift AS role
       FROM shift_employees se JOIN employees e ON e.id = se.employee_id WHERE se.shift_id = $1`, [id]).catch(logFullErr('équipe')),
    pool.query(
      `SELECT m.*, p.name AS product, pu.name AS pump, pc.counter_number
       FROM meter_readings m
       JOIN products p ON p.id = m.product_id
       JOIN pumps pu ON pu.id = m.pump_id
       JOIN pump_counters pc ON pc.id = m.counter_id
       WHERE m.shift_id = $1 ORDER BY pu.number, pc.counter_number`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT s.id, s.invoice_no, s.total, s.status, s.sold_at, s.kind,
              COALESCE(c.name, '') AS customer
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.shift_id = $1 ORDER BY s.id`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT p.method, SUM(p.amount) AS amount, COUNT(*)::int AS n
       FROM payments p WHERE p.shift_id = $1 GROUP BY p.method`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT id, category, amount, method, beneficiary, comment, spent_on
       FROM expenses WHERE shift_id = $1 AND deleted_at IS NULL ORDER BY id`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT m.kind, m.amount, m.label, m.created_at
       FROM cash_movements m WHERE m.shift_id = $1 ORDER BY m.id`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT sa.kind, sa.description, sa.amount, sa.created_at, NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), '') AS employee, COALESCE(NULLIF(TRIM(cu.full_name), ''), cu.login) AS reported_by, (e.user_id IS NOT NULL AND e.user_id = sa.created_by) AS reported_self FROM shift_anomalies sa LEFT JOIN employees e ON e.id = sa.employee_id LEFT JOIN users cu ON cu.id = sa.created_by WHERE sa.shift_id = $1 ORDER BY sa.id`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT kind, amount, status, product_id FROM employee_gaps WHERE shift_id = $1`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT sa.id, sa.amount, sa.reason, sa.status, e.first_name || ' ' || e.last_name AS employee
       FROM salary_advances sa JOIN employees e ON e.id = sa.employee_id
       WHERE sa.station_id = $1 AND sa.created_at >= $2 AND ($3::timestamptz IS NULL OR sa.created_at <= $3)
       ORDER BY sa.id DESC LIMIT 20`,
      [req.sid, s.opened_at, s.closed_at]).catch(logFullErr()),
    pool.query(
      `SELECT content, generated_at FROM reports WHERE shift_id = $1 AND kind = 'quart' ORDER BY id DESC LIMIT 1`, [id]).catch(logFullErr()),
    pool.query(
      `SELECT COALESCE(SUM(d.quantity), 0) AS liters FROM sale_details d JOIN sales sa ON sa.id = d.sale_id
       WHERE sa.shift_id = $1 AND sa.kind = 'carburant' AND sa.status = 'valide'`, [id]).catch(logFullErr('litres déclarés'))
  ]);

  // Agrégats calculés en direct : un quart ouvert n'a pas encore d'index final (litres/montant des compteurs = NULL),
  // on s'appuie donc sur les ventes réellement enregistrées, puis sur les compteurs dès qu'ils sont relevés à la clôture.
  const valid = sales.rows.filter(x => x.status === 'valide');
  const salesTotal = valid.reduce((a, x) => a + Number(x.total), 0);
  const fuelSales = valid.filter(x => x.kind === 'carburant'), productSales = valid.filter(x => x.kind !== 'carburant');
  const fuelSalesAmount = fuelSales.reduce((a, x) => a + Number(x.total), 0);
  const productSalesAmount = productSales.reduce((a, x) => a + Number(x.total), 0);
  const expTotal = expenses.rows.reduce((a, x) => a + Number(x.amount), 0);
  const meterLiters = meters.rows.reduce((a, m) => a + Number(m.liters || 0), 0);
  const meterAmount = meters.rows.reduce((a, m) => a + Number(m.amount || 0), 0);
  const metersClosed = meters.rows.length > 0 && meters.rows.every(m => m.index_end != null);
  const fuelLiters = metersClosed ? meterLiters : Number(declaredFuel.rows[0]?.liters || 0);
  const fuelAmount = metersClosed ? meterAmount : fuelSalesAmount;

  res.json({
    shift: {
      id: s.id, number: s.number, kind: s.kind, status: s.status,
      station_id: s.station_id,
      opened_at: s.opened_at, closed_at: s.closed_at,
      opened_by: s.opened_by_login, closed_by: s.closed_by_login,
      cash_register: s.cash_register_name,
      opening_cash: s.opening_cash,
      theoretical_cash: s.theoretical_cash,
      counted_cash: s.counted_cash,
      cash_gap: s.cash_gap,
      gap_justification: s.gap_justification,
      observations: s.observations
    },
    employees: emps.rows,
    meters: meters.rows,
    sales: sales.rows,
    payments_by_method: payments.rows,
    expenses: expenses.rows,
    cash_movements: cashMoves.rows,
    anomalies: anomalies.rows,
    gaps: gaps.rows,
    advances_during_shift: advances.rows,
    closure_snapshot: snapshot.rows[0]?.content || null,
    summary: {
      sales_total: salesTotal,
      sales_count: valid.length,
      cancelled_count: sales.rows.length - valid.length,
      fuel_sales_amount: fuelSalesAmount,
      product_sales_amount: productSalesAmount,
      fuel_is_live: !metersClosed,
      expenses_total: expTotal,
      fuel_liters: fuelLiters,
      fuel_amount: fuelAmount,
      cash_gap: s.cash_gap,
      employees_count: emps.rows.length,
      anomalies_count: anomalies.rows.length,
      gaps_count: gaps.rows.length
    },
    note: 'Rapport consolidé P7 — données isolées à la station courante.'
  });
}));

/** Ventes rattachées à un quart (bouton « Afficher » de la liste des quarts) */
r.get('/:id/sales', canReadOwnShiftReport, wrap(async (req, res) => {
  const id = +req.params.id;
  if (!id) throw new HttpError(400, 'Identifiant de quart invalide');
  const { rows: [s] } = await pool.query('SELECT id, number, kind, status, opened_at, closed_at FROM shifts WHERE id = $1 AND station_id = $2', [id, req.sid]);
  if (!s) throw new HttpError(404, 'Quart introuvable');
  if (!broadShiftRead(req) && !(await isAssignedToShift(req.user.id, s.id, req.sid))) throw new HttpError(404, 'Quart introuvable.');
  const { rows } = await pool.query(
    `SELECT sa.id, sa.invoice_no, sa.sold_at, sa.kind, sa.status, sa.total,
            COALESCE(c.name, '') AS customer,
            COALESCE(NULLIF(TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')), ''), '') AS employee,
            COALESCE((SELECT string_agg(DISTINCT p.method, ', ') FROM payments p WHERE p.sale_id = sa.id), '') AS methods,
            COALESCE((SELECT string_agg(pr.name || ' × ' || TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM d.quantity::numeric(14,3)::text)), ', ' ORDER BY d.id)
                      FROM sale_details d JOIN products pr ON pr.id = d.product_id WHERE d.sale_id = sa.id), '') AS items
       FROM sales sa
       LEFT JOIN customers c ON c.id = sa.customer_id
       LEFT JOIN employees e ON e.id = sa.employee_id
      WHERE sa.shift_id = $1 AND sa.station_id = $2
      ORDER BY sa.sold_at, sa.id`, [id, req.sid]);
  const valid = rows.filter(x => x.status === 'valide');
  res.json({
    shift: s,
    sales: rows,
    summary: {
      count: valid.length,
      cancelled: rows.length - valid.length,
      total: valid.reduce((a, x) => a + Number(x.total), 0),
      fuel_total: valid.filter(x => x.kind === 'carburant').reduce((a, x) => a + Number(x.total), 0),
      products_total: valid.filter(x => x.kind !== 'carburant').reduce((a, x) => a + Number(x.total), 0)
    }
  });
}));

module.exports = r;
