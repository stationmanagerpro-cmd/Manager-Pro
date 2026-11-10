// Initialisation : node src/setup.js <login> <motdepasse> "<Nom de la station>"
// Crée la station, sa caisse, le compte administrateur et la matrice des permissions.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const [login, password, stationName = 'Station principale'] = process.argv.slice(2);
if (!login || !password || password.length < 12) { console.error('Usage : npm run setup -- <login> <motdepasse (12+ car.)> "<Nom station>"'); process.exit(1); }

const MATRIX = {
  // Matrice alignee sur migrations 051/052 — setup initialise aussi ces droits.
  GERANT: [
    'shift.open','shift.close','shift.report.own','sale.create','sale.delete','price.edit','stock.adjust',
    'expense.create','cash.manage','report.view','finance.view','finance.report','audit.view','sale.credit',
    'user.manage','role.assign','settings.edit','purchase.manage','purchase.pay','transfer.manage',
    'customer.view','customer.edit','customer.delete','supplier.view','supplier.edit','supplier.delete',
    'receivable.view','debt.view','export.customers','export.suppliers','money.manage',
    'appearance.manage','appearance.self','image.manage',
    'hr.view','hr.manage','hr.settings','hr.payroll','hr.payroll.close','hr.payroll.reopen','hr.debts','hr.gaps',
    'hr.employee.view','hr.employee.create','hr.employee.edit','hr.employee.documents','hr.documents.view',
    'hr.leave.view','hr.leave.request','hr.leave.manage','hr.leave.approve',
    'hr.attendance.view','hr.attendance.manage','hr.attendance.correct',
    'hr.schedule.view','hr.schedule.manage','hr.skills.view','hr.skills.manage',
    'hr.training.view','hr.training.manage','hr.evaluation.view','hr.evaluation.manage',
    'hr.overtime.view','hr.overtime.propose','hr.overtime.validate','hr.overtime.approve',
    'cost.view'
  ],
  SUPERVISEUR: [
    'shift.open','shift.close','shift.report.own','sale.create','sale.credit','sale.delete','price.edit','stock.adjust',
    'expense.create','cash.manage','report.view','finance.view','purchase.manage','purchase.pay',
    'customer.view','customer.edit','supplier.view','supplier.edit','receivable.view','debt.view',
    'export.customers','export.suppliers','hr.view','hr.employee.view','hr.leave.view','hr.attendance.view',
    'hr.schedule.view','appearance.self'
  ],
  CAISSIER: [
    'sale.create','cash.manage','customer.view','customer.edit','receivable.view',
    'shift.open','shift.close','shift.report.own','report.view','appearance.self'
  ],
  POMPISTE: ['sale.create','shift.report.own','appearance.self'],
  MAGASINIER: [
    'stock.adjust','purchase.manage','purchase.pay','transfer.manage',
    'supplier.view','supplier.edit','debt.view','report.view','export.suppliers','appearance.self'
  ],
  COMPTABLE: [
    'report.view','finance.view','finance.report','audit.view','expense.create','cash.manage','money.manage',
    'receivable.view','debt.view','customer.view','supplier.view','export.customers','export.suppliers',
    'hr.view','hr.payroll','hr.payroll.close','hr.employee.view','appearance.self','cost.view'
  ],
};

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [st] } = await c.query('INSERT INTO stations(name) VALUES ($1) RETURNING id', [stationName]);
    await c.query("INSERT INTO cash_registers(station_id, name) VALUES ($1, 'Caisse principale')", [st.id]);
    await c.query(`INSERT INTO payment_methods(station_id, code, label, kind) VALUES ($1,'especes','Espèces','especes'),($1,'mobile_money','Mobile Money','mobile_money'),($1,'orange_money','Orange Money','mobile_money'),($1,'wave','Wave','mobile_money'),($1,'carte','Carte bancaire','carte'),($1,'banque','Virement / banque','banque'),($1,'credit','Crédit client','credit'),($1,'autre','Autre','autre')`, [st.id]);
    await c.query("INSERT INTO settings(station_id, key, value) VALUES ($1, 'tolerance_fuel_liters', '5')", [st.id]);
    const { rows: [role] } = await c.query("SELECT id FROM roles WHERE code IN ('SUPERADMIN','ADMIN') ORDER BY (code = 'SUPERADMIN') DESC LIMIT 1");
    const { rows: [u] } = await c.query('INSERT INTO users(login, password_hash, role_id, is_global) VALUES ($1,$2,$3,TRUE) RETURNING id', [login, await bcrypt.hash(password, 12), role.id]);
    await c.query('INSERT INTO user_stations(user_id, station_id) VALUES ($1,$2)', [u.id, st.id]);
    for (const [r, perms] of Object.entries(MATRIX))
      await c.query('INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = $1 AND p.code = ANY($2) ON CONFLICT DO NOTHING', [r, perms]);
    await c.query('COMMIT');
    console.log(`Station n°${st.id} « ${stationName} » créée. Administrateur : ${login}`);
  } catch (e) { await c.query('ROLLBACK'); console.error(e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
})();
