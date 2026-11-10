// Test de sauvegarde / restauration : node scripts/test-restore.js
// Sauvegarde la base courante, la restaure dans une base temporaire vide et compare le contenu des tables principales.
require('dotenv').config();
const { Pool } = require('pg'), { spawnSync } = require('child_process'), path = require('path');
const url = new URL(process.env.DATABASE_URL), name = url.pathname.slice(1), tmp = name + '_restore_test';
const admin = new URL(url); admin.pathname = '/postgres';
const tmpUrl = new URL(url); tmpUrl.pathname = '/' + tmp;
const TABLES = ['stations', 'users', 'employees', 'sales', 'payments', 'payslips', 'employee_debts', 'employee_debt_payments', 'cash_movements', 'stock_movements', 'money_movements', 'customer_ledger', 'purchases'];
(async () => {
  const a = new Pool({ connectionString: admin.href }), src = new Pool({ connectionString: process.env.DATABASE_URL });
  await a.query(`DROP DATABASE IF EXISTS "${tmp}"`); await a.query(`CREATE DATABASE "${tmp}"`);
  const d = require('../src/backup'); const b = await d.dump(); console.log('Sauvegarde : ' + b.name + ' (' + b.size + ' octets)');
  const r = spawnSync('node', [path.join(__dirname, '../src/restore.js'), path.join(d.dir(), b.name)], { env: { ...process.env, DATABASE_URL: tmpUrl.href }, encoding: 'utf8' });
  console.log((r.stdout || '').trim()); if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const dst = new Pool({ connectionString: tmpUrl.href }); let bad = 0;
  for (const t of TABLES) { const x = (await src.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n, y = (await dst.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n; if (x !== y) bad++; console.log(`${x === y ? '✔' : '✖'} ${t}: origine ${x}, restauré ${y}`); }
  const s1 = (await src.query('SELECT COALESCE(SUM(net_pay),0) v FROM payslips')).rows[0].v, s2 = (await dst.query('SELECT COALESCE(SUM(net_pay),0) v FROM payslips')).rows[0].v; console.log(`${s1 == s2 ? '✔' : '✖'} somme des nets de paie: ${s1} / ${s2}`); if (s1 != s2) bad++;
  await dst.end(); await src.end(); await a.query(`DROP DATABASE "${tmp}"`); await a.end();
  console.log(bad ? '✖ restauration non conforme' : 'Sauvegarde et restauration vérifiées.'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
