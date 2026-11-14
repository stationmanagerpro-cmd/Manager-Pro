'use strict';
// Résumé du soir et prévision de rupture de cuve contre un VRAI PostgreSQL (tables minimales créées dans un schéma temporaire).
//   BC_PSQL="psql -h <socket> -p <port> -X -q -At -d <base>" node test/alerts-extra-sql.js
const { execFileSync } = require('child_process');
const assert = require('assert');
const CMD = process.env.BC_PSQL;
const x = require('../src/alerts_extra');
// logique pure (toujours exécutée)
assert.strictEqual(x.daysLeft(700, 700), 7);
assert.strictEqual(x.daysLeft(100, 0), null);
assert.strictEqual(x.daysLeft(-5, 70), 0);
assert.strictEqual(x.summaryRefId('2026-11-14', 7), 20261114000007);
const txt = x.formatSummary({ date: '2026-11-14', stationName: 'S1', pumps: [{ name: 'Pompe 1', liters: 120.5, amount: 90000 }], totals: { liters: 120.5, amount: 90000 }, shifts: { count: 2, closed: 1, gapCount: 1, gapTotal: -500 }, anomalies: 1 });
assert.match(txt, /Pompe 1 : 120,5 L, 90 000 FCFA/); assert.match(txt, /Écarts de caisse : 1 quart\(s\), cumul -500 FCFA/); assert.match(txt, /Anomalies signalées : 1/);
assert.match(x.formatSummary({ date: 'd', pumps: [], totals: {}, shifts: { count: 0, closed: 0, gapCount: 0, gapTotal: 0 }, anomalies: 0 }), /Aucune vente de carburant/);
if (!CMD) { console.log('alerts-extra : logique pure OK ; partie SQL ignorée (BC_PSQL non défini)'); process.exit(0); }
const lit = v => v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const sh = sql => execFileSync('sh', ['-c', CMD], { input: sql, encoding: 'utf8' }).trim();
const pool = { query: async (sql, p = []) => { const s = sql.replace(/\$(\d+)/g, (_, i) => lit(p[i - 1])); const out = sh(`SET search_path TO aex_test; SELECT COALESCE(json_agg(t),'[]'::json)::jsonb FROM (${s}) t;`); return { rows: JSON.parse(out.split('\n').pop()) }; } };
sh(`DROP SCHEMA IF EXISTS aex_test CASCADE; CREATE SCHEMA aex_test; SET search_path TO aex_test;
CREATE TABLE stations(id int primary key, name text); CREATE TABLE products(id int primary key, name text); CREATE TABLE pumps(id int primary key, name text);
CREATE TABLE sales(id serial primary key, station_id int, pump_id int, kind text, status text, sold_at timestamptz);
CREATE TABLE sale_details(id serial primary key, sale_id int, product_id int, quantity numeric, amount numeric);
CREATE TABLE shifts(id serial primary key, station_id int, status text, opened_at timestamptz, cash_gap numeric);
CREATE TABLE shift_anomalies(id serial primary key, shift_id int, created_at timestamptz DEFAULT now());
CREATE TABLE tanks(id int primary key, station_id int, product_id int, deleted_at timestamptz, active boolean default true);
CREATE TABLE tank_measurements(id serial primary key, tank_id int, quantity numeric, measured_at timestamptz);
INSERT INTO stations VALUES (1,'Station Test'); INSERT INTO products VALUES (10,'Gasoil'),(11,'Super'); INSERT INTO pumps VALUES (1,'Pompe 1'),(2,'Pompe 2');
INSERT INTO sales(station_id,pump_id,kind,status,sold_at) VALUES (1,1,'carburant','valide',now()),(1,2,'carburant','valide',now()),(1,1,'carburant','annule',now()),(1,1,'carburant','valide',now() - interval '2 days');
INSERT INTO sale_details(sale_id,product_id,quantity,amount) VALUES (1,10,100,75000),(2,11,50,40000),(3,10,999,999999),(4,10,300,225000);
INSERT INTO shifts(station_id,status,opened_at,cash_gap) VALUES (1,'ouvert',now(),NULL),(1,'ferme',now(),-1500),(1,'ferme',now() - interval '2 days',-9999);
INSERT INTO shift_anomalies(shift_id) VALUES (1),(2);
INSERT INTO tanks VALUES (1,1,10,NULL,true),(2,1,11,NULL,true);
INSERT INTO tank_measurements(tank_id,quantity,measured_at) VALUES (1,1000,now() - interval '3 days'),(2,5000,now() - interval '3 days');`);
(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const r = await x.buildDailySummary(pool, 1, today);
  console.log(r.text);
  assert.strictEqual(r.totals.liters, 150); assert.strictEqual(r.totals.amount, 115000);
  assert.match(r.text, /Pompe 1 : 100 L, 75 000 FCFA/); assert.match(r.text, /Pompe 2 : 50 L, 40 000 FCFA/);
  assert.match(r.text, /Quarts du jour : 2 \(dont 1 clôturé/); assert.match(r.text, /1 quart\(s\), cumul -1 500 FCFA/); assert.match(r.text, /Anomalies signalées : 2/);
  const t = await x.tankRunouts(pool, 1);
  const g = t.find(v => v.name === 'Gasoil'), s = t.find(v => v.name === 'Super');
  // Gasoil : 1000 − (100 + 300 vendus depuis le jaugeage) = 600 ; 7 j = 400 → 57,1 L/j → 10,5 jours
  assert.strictEqual(g.stock, 600); assert.ok(Math.abs(g.days - 600 / (400 / 7)) < 1e-6);
  assert.strictEqual(s.stock, 4950);
  console.log('Gasoil', g.days.toFixed(1), 'jours ; Super', s.days.toFixed(1), 'jours');
  sh('DROP SCHEMA aex_test CASCADE;');
  console.log('alerts-extra : SQL OK');
})().catch(e => { try { sh('DROP SCHEMA IF EXISTS aex_test CASCADE;'); } catch (_) {} console.error(e); process.exit(1); });
