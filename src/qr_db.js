'use strict';
// Scan QR des pompes : accès base (SQL) isolé, sans dépendance au noyau de l'application.
// `db` = pool ou client pg (méthode query). Même code en production (qr_codes.js, fuelsales.js) et dans test/qr-db-scenarios.js.
const L = require('./qr_logic');

/** Charge les données nécessaires aux contrôles. `lock` : verrouille le quart ouvert (FOR SHARE) pendant la transaction de vente. */
async function loadContext(db, { stationId, userId, qr, lock = false }) {
  const one = async (sql, p) => (await db.query(sql, p)).rows[0] || null;
  const counter = qr ? await one('SELECT id, pump_id, product_id, counter_number FROM pump_counters WHERE id = $1', [qr.counter_id]) : null;
  const pump = qr ? await one('SELECT id, station_id, number, name, status, deleted_at FROM pumps WHERE id = $1', [qr.pump_id]) : null;
  const product = counter ? await one('SELECT id, name, active, deleted_at FROM products WHERE id = $1', [counter.product_id]) : null;
  const shift = await one(`SELECT id, number, status, station_id FROM shifts WHERE station_id = $1 AND status = 'ouvert'${lock ? ' FOR SHARE' : ''}`, [stationId]);
  const employee = await one(`SELECT id, first_name, last_name FROM employees WHERE user_id = $1 AND station_id = $2 AND deleted_at IS NULL AND status = 'actif'`, [userId, stationId]);
  let team = [], pumpAssign = [], counterRead = false;
  if (shift) {
    team = (await db.query('SELECT employee_id, pump_id FROM shift_employees WHERE shift_id = $1', [shift.id])).rows;
    pumpAssign = (await db.query('SELECT employee_id, pump_id FROM shift_employee_pumps WHERE shift_id = $1', [shift.id])).rows;
    if (qr) counterRead = !!(await one('SELECT 1 AS x FROM meter_readings WHERE shift_id = $1 AND counter_id = $2', [shift.id, qr.counter_id]));
  }
  return { stationId, qr, counter, pump, product, shift, employee, team, pumpAssign, counterRead };
}

/** Recherche du QR : par jeton (scan caméra) ou par référence courte de la station (saisie manuelle). */
async function findQr(db, { token, shortRef, stationId }) {
  if (token) return (await db.query('SELECT * FROM qr_codes WHERE token = $1', [token])).rows[0] || null;
  if (shortRef) { const { rows } = await db.query('SELECT * FROM qr_codes WHERE short_ref = $1 AND station_id = $2', [shortRef, stationId]); return rows.length === 1 ? rows[0] : null; }
  return null;
}

async function insertEvent(db, ev) {
  await db.query(
    `INSERT INTO qr_events(station_id, user_id, event, result, reason_code, qr_code_id, short_ref, pump_id, counter_id, product_id, shift_id, employee_id, scan_id, sale_id, detail, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [ev.station_id || null, ev.user_id || null, ev.event, ev.result || 'ok', ev.reason_code || null, ev.qr_code_id || null, ev.short_ref || null, ev.pump_id || null, ev.counter_id || null,
     ev.product_id || null, ev.shift_id || null, ev.employee_id || null, ev.scan_id || null, ev.sale_id || null, ev.detail ? JSON.stringify(ev.detail) : null, ev.ip_address || null]);
}

/** Ouvre la session de scan (après verdict ok). */
async function openScan(db, { qr, ctx, userId, delegated = false }) {
  const { rows: [s] } = await db.query(
    `INSERT INTO qr_scans(qr_code_id, station_id, user_id, employee_id, shift_id, pump_id, counter_id, product_id, expires_at, delegated_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' milliseconds')::interval, $10) RETURNING id, scanned_at, expires_at`,
    [qr.id, ctx.stationId, userId, ctx.employee.id, ctx.shift.id, ctx.pump.id, ctx.counter.id, ctx.product.id, String(L.SCAN_TTL_MS), delegated ? userId : null]);
  return s;
}

/** Employé actif de la station (responsable désigné par la pompe, pour une vente au nom d'un employé). */
async function loadEmployee(db, { stationId, employeeId }) {
  const { rows: [e] } = await db.query(
    "SELECT id, first_name, last_name, user_id, email FROM employees WHERE id = $1 AND station_id = $2 AND deleted_at IS NULL AND status = 'actif'",
    [employeeId, stationId]);
  return e || null;
}

/**
 * Validation d'une vente par scan, DANS la transaction de vente : verrouille le scan (FOR UPDATE) et le QR (FOR SHARE : une
 * révocation concurrente attend la fin de la vente), recharge tout depuis la base et re-contrôle. Retourne { verdict, scan }.
 */
async function checkScanForSale(db, { stationId, userId, scanId, body, canDelegate = false }) {
  const { rows: [scan] } = await db.query('SELECT * FROM qr_scans WHERE id = $1 AND station_id = $2 FOR UPDATE', [scanId, stationId]);
  const qr = scan ? (await db.query('SELECT * FROM qr_codes WHERE id = $1 FOR SHARE', [scan.qr_code_id])).rows[0] || null : null;
  const ctx = await loadContext(db, { stationId, userId, qr, lock: true });
  ctx.canDelegate = !!canDelegate;
  if (scan && scan.delegated_by_user_id != null) {   // vente au nom d'un employé : le responsable du scan remplace le compte connecté, puis tout est re-contrôlé
    ctx.employee = await loadEmployee(db, { stationId, employeeId: scan.employee_id });
    ctx.delegatedBy = userId;
  }
  return { verdict: L.evaluateScanUse(ctx, scan || null, body, userId), scan: scan || null, ctx };
}

/** Marque le scan consommé par la vente ; false si déjà consommé (une seule vente par scan). */
async function consumeScan(db, scanId, saleId) {
  const u = await db.query('UPDATE qr_scans SET consumed_sale_id = $2, consumed_at = now() WHERE id = $1 AND consumed_sale_id IS NULL', [scanId, saleId]);
  return u.rowCount === 1;
}

module.exports = { loadContext, loadEmployee, findQr, insertEvent, openScan, checkScanForSale, consumeScan };
