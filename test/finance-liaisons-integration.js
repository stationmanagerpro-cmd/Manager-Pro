/**
 * Tests d'intégration des liaisons financières (Phase 6 / Phase 7).
 * Prérequis :
 *   - PostgreSQL local
 *   - DATABASE_URL pointant vers une base jetable dont le nom contient "test" ou "ci"
 *   - ALLOW_DESTRUCTIVE_TESTS=1
 *   - Schéma migré (npm run migrate) et au moins une station + caisse + moyens de paiement
 *
 * Usage :
 *   ALLOW_DESTRUCTIVE_TESTS=1 DATABASE_URL=postgres://.../managepro_test node test/finance-liaisons-integration.js
 *
 * Sans base conforme : exit 0 avec SKIP (ne casse pas la CI statique).
 */
'use strict';
try { require('dotenv').config(); } catch (_) { /* optionnel */ }
const assert = require('assert');

const databaseUrl = process.env.DATABASE_URL || '';
let dbUrl;
try { dbUrl = new URL(databaseUrl); } catch {
  console.log('SKIP finance-liaisons-integration : DATABASE_URL absent ou invalide');
  process.exit(0);
}
const host = dbUrl.hostname.replace(/^\[|\]$/g, '');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const databaseName = decodeURIComponent(dbUrl.pathname.replace(/^\//, ''));
if (!localHosts.has(host) || !/(^|[_-])(test|ci)([_-]|$)/i.test(databaseName)) {
  console.log('SKIP finance-liaisons-integration : base non locale ou nom hors test/ci');
  process.exit(0);
}
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== '1') {
  console.log('SKIP finance-liaisons-integration : définir ALLOW_DESTRUCTIVE_TESTS=1');
  process.exit(0);
}

const { Pool } = require('pg');
const pool = new Pool({ connectionString: databaseUrl });

let n = 0;
const ok = (name) => { n++; console.log('✔', name); };

async function main() {
  const client = await pool.connect();
  try {
    // Station + caisse minimales
    const { rows: stations } = await client.query('SELECT id FROM stations ORDER BY id LIMIT 1');
    if (!stations.length) {
      console.log('SKIP : aucune station — initialisez la base de test (setup/migrate)');
      return;
    }
    const sid = stations[0].id;

    await client.query('BEGIN');
    // Caisse
    let { rows: [reg] } = await client.query(
      'SELECT id, balance FROM cash_registers WHERE station_id = $1 AND active ORDER BY id LIMIT 1', [sid]);
    if (!reg) {
      const ins = await client.query(
        `INSERT INTO cash_registers(station_id, name, balance, active) VALUES ($1,'Caisse test',0,true) RETURNING id, balance`, [sid]);
      reg = ins.rows[0];
    }
    const bal0 = Number(reg.balance);

    // Compte banque test
    const { rows: [acc] } = await client.query(
      `INSERT INTO money_accounts(station_id, kind, name, opening_balance, opening_date, active)
       VALUES ($1,'banque','Banque test phase7',0,CURRENT_DATE,true) RETURNING id`, [sid]);

    // --- Scénario P1 : dépôt avec account_id (simulation SQL des écritures de la route) ---
    const deposit = 10000;
    await client.query('UPDATE cash_registers SET balance = balance + $2 WHERE id = $1', [reg.id, -deposit]);
    await client.query(
      `INSERT INTO cash_movements(cash_register_id, kind, amount, label, created_by)
       VALUES ($1,'depot_bancaire',$2,'Test P1 dépôt',NULL)`, [reg.id, -deposit]);
    await client.query(
      `INSERT INTO money_movements(account_id, station_id, kind, amount, label)
       VALUES ($1,$2,'depot',$3,'Test P1 dépôt')`, [acc.id, sid, deposit]);

    const { rows: [reg1] } = await client.query('SELECT balance FROM cash_registers WHERE id = $1', [reg.id]);
    const { rows: [sumM] } = await client.query(
      'SELECT COALESCE(SUM(amount),0)::float AS s FROM money_movements WHERE account_id = $1', [acc.id]);
    assert.strictEqual(Number(reg1.balance), bal0 - deposit, 'caisse doit baisser du montant du dépôt');
    assert.strictEqual(Number(sumM.s), deposit, 'compte doit monter du montant du dépôt');
    ok('P1 SQL : dépôt caisse↔compte double écriture cohérente');

    // --- Intégrité caisse (formule P7) ---
    const { rows: [gap] } = await client.query(
      `SELECT r.balance - COALESCE((SELECT SUM(m.amount) FROM cash_movements m WHERE m.cash_register_id = r.id),0) AS gap
       FROM cash_registers r WHERE r.id = $1`, [reg.id]);
    // gap peut être non nul si la caisse avait un solde d'ouverture sans mouvements historiques —
    // on vérifie seulement que la requête s'exécute et renvoie un nombre.
    assert.ok(typeof Number(gap.gap) === 'number' && !Number.isNaN(Number(gap.gap)));
    ok('P7 SQL : requête d’intégrité caisse exécutable');

    // --- Transfert inter-comptes (P3) ---
    const { rows: [acc2] } = await client.query(
      `INSERT INTO money_accounts(station_id, kind, name, opening_balance, opening_date, active)
       VALUES ($1,'mobile_money','MM test phase7',0,CURRENT_DATE,true) RETURNING id`, [sid]);
    const xfer = 3000;
    const { rows: [mOut] } = await client.query(
      `INSERT INTO money_movements(account_id, station_id, kind, amount, label)
       VALUES ($1,$2,'transfert_sortant',$3,'xfer test') RETURNING id`, [acc.id, sid, -xfer]);
    await client.query(
      `INSERT INTO money_movements(account_id, station_id, kind, amount, label, reference)
       VALUES ($1,$2,'transfert_entrant',$3,'xfer test',$4)`, [acc2.id, sid, xfer, 'xfer:' + mOut.id]);
    const { rows: [s1] } = await client.query(
      'SELECT COALESCE(SUM(amount),0)::float AS s FROM money_movements WHERE account_id = $1', [acc.id]);
    const { rows: [s2] } = await client.query(
      'SELECT COALESCE(SUM(amount),0)::float AS s FROM money_movements WHERE account_id = $1', [acc2.id]);
    assert.strictEqual(Number(s1.s), deposit - xfer);
    assert.strictEqual(Number(s2.s), xfer);
    ok('P3 SQL : transfert sortant+entrant conserve la somme des liquidités comptes');

    // --- Dépense via expenses + signe (structure) ---
    const { rows: [exp] } = await client.query(
      `INSERT INTO expenses(station_id, category, amount, method, comment)
       VALUES ($1,'Test phase7',500,'especes','integration') RETURNING id, amount`, [sid]);
    assert.strictEqual(Number(exp.amount), 500);
    ok('Dépense : insertion expenses amount > 0');

    await client.query('ROLLBACK'); // ne laisse aucune trace sur la base de test
    ok('ROLLBACK : aucune donnée de test persistée');
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\n✔ finance-liaisons-integration : ${n}/${n} scénarios SQL réussis (transaction annulée)`);
}

main().catch(e => {
  console.error('FAIL', e.message);
  process.exit(1);
});
