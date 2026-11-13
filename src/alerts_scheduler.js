'use strict';

// Surveillance périodique des règles activées. Les alertes ne sont émises que si
// le contrat du client autorise auto_alerts et qu'une règle active existe.
const { pool } = require('./core');
const { swallow } = require('./safe');
const { sendSystemAlert } = require('./messaging');

const SCANNED_KINDS = ['stock_low', 'account_inactive', 'license_expiring', 'payroll_pending'];
let running = false;
let lastRunAt = null;
let lastRunResult = null;
let lastRunError = null;

async function scanStation(station) {
  const { rows: configs } = await pool.query(
    `SELECT * FROM alert_notify_config
      WHERE client_id = $1 AND active AND alert_kind = ANY($2::text[])
        AND (station_id IS NULL OR station_id = $3)
      ORDER BY station_id NULLS LAST`,
    [station.client_id, SCANNED_KINDS, station.station_id]
  );
  const configByKind = new Map();
  for (const c of configs) if (!configByKind.has(c.alert_kind)) configByKind.set(c.alert_kind, c);
  if (!configByKind.size) return;

  const fire = async (kind, args) => {
    if (!configByKind.has(kind)) return;
    try {
      await sendSystemAlert({
        clientId: station.client_id, actorUserId: station.actor_id,
        employeeUserId: null, kind, stationId: station.station_id, ...args
      });
    } catch (e) {
      console.warn(`[alertes-auto] ${kind} station ${station.station_id}: ${e.message}`);
    }
  };

  if (configByKind.has('stock_low')) {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.min_stock, st.quantity
         FROM products p JOIN stock st ON st.product_id = p.id
        WHERE p.station_id = $1 AND p.deleted_at IS NULL
          AND p.min_stock > 0 AND st.quantity <= p.min_stock
        ORDER BY p.name LIMIT 100`, [station.station_id]
    );
    for (const p of rows) await fire('stock_low', {
      body: `Stock sous le minimum : ${p.name} — ${p.quantity} restant(s), minimum ${p.min_stock}.`,
      refTable: 'products', refId: p.id
    });
  }

  if (configByKind.has('account_inactive')) {
    const cfg = configByKind.get('account_inactive');
    const days = Math.max(1, Math.min(3650, Math.floor(Number(cfg.threshold_value) || 0)));
    if (cfg.threshold_unit === 'days' && days > 0) {
      const { rows } = await pool.query(
        `SELECT id, login, full_name, last_login_at, created_at
           FROM users
          WHERE client_id = $1 AND active AND deleted_at IS NULL
            AND COALESCE(is_global, FALSE) = FALSE
            AND (EXISTS (SELECT 1 FROM user_stations us WHERE us.user_id = users.id AND us.station_id = $3)
              OR users.id = $4)
            AND ((last_login_at IS NULL AND created_at <= now() - ($2::text || ' days')::interval)
              OR last_login_at <= now() - ($2::text || ' days')::interval)
          ORDER BY last_login_at NULLS FIRST LIMIT 100`, [station.client_id, days, station.station_id, station.actor_id]
      );
      for (const u of rows) await fire('account_inactive', {
        employeeUserId: u.id,
        body: `Compte inactif depuis au moins ${days} jour(s) : ${u.full_name || u.login}. Dernière connexion : ${u.last_login_at || 'jamais connecté'}.`,
        refTable: 'users', refId: u.id
      });
    }
  }

  if (configByKind.has('license_expiring')) {
    const cfg = configByKind.get('license_expiring');
    const days = Math.max(1, Math.min(365, Math.floor(Number(cfg.threshold_value) || 0)));
    if (cfg.threshold_unit === 'days' && days > 0) {
      const { rows } = await pool.query(
        `SELECT id, end_date, status FROM client_contracts
          WHERE client_id = $1 AND status = 'actif' AND end_date IS NOT NULL
            AND end_date >= CURRENT_DATE AND end_date <= CURRENT_DATE + $2::int`,
        [station.client_id, days]
      );
      for (const c of rows) await require('./gaps').logLicenseWarning(station.client_id, Math.ceil((new Date(c.end_date) - new Date()) / 86400000));
      for (const c of rows) await fire('license_expiring', {
        body: `Le contrat du compte client arrive à échéance le ${String(c.end_date).slice(0, 10)} (dans ${Math.max(0, Math.ceil((new Date(c.end_date) - new Date()) / 86400000))} jour(s)).`,
        refTable: 'client_contracts', refId: c.id
      });
    }
  }

  if (configByKind.has('payroll_pending')) {
    const { rows: [p] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM payslips WHERE station_id = $1 AND status = 'brouillon'`,
      [station.station_id]
    ).catch(swallow('alerts_scheduler:96', { rows: [{ count: 0 }] }));
    if (p.count > 0) await fire('payroll_pending', {
      body: `${p.count} bulletin(s) de paie sont encore en brouillon dans la station.`,
      refTable: 'payroll_pending', refId: station.station_id
    });
  }
}

async function runAlertScan() {
  if (running) return { skipped: 'already_running' };
  running = true;
  let client;
  let locked = false;
  try {
    client = await pool.connect();
    const lock = await client.query('SELECT pg_try_advisory_lock(74120318) AS locked');
    locked = !!lock.rows[0]?.locked;
    if (!locked) return { skipped: 'another_instance_running' };

    const { rows: stations } = await pool.query(
      `SELECT s.id AS station_id, s.client_id, u.id AS actor_id
         FROM stations s
         JOIN LATERAL (
           SELECT u.id FROM users u LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.client_id = s.client_id AND u.active AND u.deleted_at IS NULL
              AND COALESCE(u.is_global, FALSE) = FALSE
            ORDER BY CASE WHEN r.code IN ('ADMIN','GERANT') THEN 0 ELSE 1 END, u.id
            LIMIT 1
         ) u ON TRUE
        WHERE s.active AND s.client_id IS NOT NULL
        ORDER BY s.id`
    );
    let scanned = 0;
    for (const station of stations) {
      try { await scanStation(station); scanned++; }
      catch (e) { console.warn(`[alertes-auto] Scan station ${station.station_id}: ${e.message}`); }
    }
    let fiscal = null;
    try {
      fiscal = await require('./fiscal').scanFiscalDeadlines();
    } catch (e) {
      console.warn('[alertes-auto] Scan échéances fiscales:', e.message);
    }
    lastRunAt = new Date().toISOString();
    lastRunResult = { scanned, fiscal };
    lastRunError = null;
    return lastRunResult;
  } catch (e) {
    console.warn('[alertes-auto] Scan périodique indisponible:', e.message);
    lastRunAt = new Date().toISOString();
    lastRunError = e.message;
    lastRunResult = { error: e.message };
    return lastRunResult;
  } finally {
    if (client) {
      if (locked) await client.query('SELECT pg_advisory_unlock(74120318)').catch(() => {});
      client.release();
    }
    running = false;
  }
}

function startScheduler() {
  if (process.env.ALERTS_AUTO === '0') {
    console.log('[alertes-auto] Planificateur désactivé (ALERTS_AUTO=0)');
    return null;
  }
  const tick = () => runAlertScan().catch(e => console.warn('[alertes-auto] Erreur de scan:', e.message));
  const first = setTimeout(tick, 20000);
  if (first.unref) first.unref();
  const timer = setInterval(tick, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
  console.log('[alertes-auto] Surveillance périodique activée (intervalle 5 minutes)');
  return timer;
}

function getAlertsHealth() {
  return {
    enabled: process.env.ALERTS_AUTO !== '0',
    running,
    last_run_at: lastRunAt,
    last_result: lastRunResult,
    last_error: lastRunError,
    interval_ms: 5 * 60 * 1000,
    scanned_kinds: SCANNED_KINDS
  };
}

module.exports = { startScheduler, runAlertScan, scanStation, getAlertsHealth };

