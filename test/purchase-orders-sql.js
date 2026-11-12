'use strict';
// Bon de commande : scénarios 4 à 10 de la demande, exécutés contre un VRAI PostgreSQL (migrations 001→101 appliquées).
// Désactivé par défaut (aucune base requise pour `npm test`). Activation :
//   BC_PSQL="psql -h <hôte/socket> -p <port> -X -q -At -d <base>"  node test/purchase-orders-sql.js
// (le script envoie les requêtes via psql : pas de module 'pg' nécessaire). Ne PAS pointer vers une base de production.
const { spawn } = require('child_process');
const Module = require('module');
const assert = require('assert');
const CMD = process.env.BC_PSQL;
if (!CMD) { console.log('purchase-orders-sql : ignoré (BC_PSQL non défini)'); process.exit(0); }

class Session {
  constructor() { this.p = spawn('sh', ['-c', CMD], { stdio: ['pipe', 'pipe', 'pipe'] }); this.out = ''; this.err = ''; this.q = Promise.resolve();
    this.p.stdout.on('data', d => { this.out += d; this.tick(); }); this.p.stderr.on('data', d => { this.err += d; this.tick(); }); }
  tick() { if (this.waiter && this.out.includes('@@END@@') && this.err.includes('@@END@@')) { const w = this.waiter; this.waiter = null; w(); } }
  raw(sql) {
    const run = () => new Promise(resolve => { this.out = ''; this.err = ''; this.waiter = resolve;
      this.p.stdin.write(sql + ';\n\\echo @@END@@\n\\warn @@END@@\n'); });
    const next = this.q.then(run); this.q = next.catch(() => {});
    return next.then(() => ({ out: this.out.replace('@@END@@', '').trim(), err: this.err.replace('@@END@@', '').trim() }));
  }
  async query(sql, params = []) {
    let s = sql.replace(/\$(\d+)/g, (_, i) => lit(params[i - 1]));
    const isRead = /^\s*(SELECT|WITH)\b/i.test(s) || /\bRETURNING\b/i.test(s);
    const cmd = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(s);
    let wrapped = s;
    if (!cmd) {
      if (isRead) wrapped = `WITH t AS (${s}) SELECT replace(COALESCE(json_agg(t), '[]'::json)::text, E'\\n', ' ') FROM t`;
      else wrapped = `WITH t AS (${s} RETURNING 1) SELECT replace(COALESCE(json_agg(t), '[]'::json)::text, E'\\n', ' ') FROM t`;
    }
    const { out, err } = await this.raw(wrapped);
    if (/ERROR/.test(err)) { const e = new Error(err.split('\n')[0].replace(/^ERROR:\s*/, '')); e.pg = err; throw e; }
    if (cmd) return { rows: [], rowCount: 0 };
    const rows = out ? JSON.parse(out.split('\n').pop()) : [];
    return { rows: isRead ? rows : [], rowCount: rows.length };
  }
  release() {}
  end() { this.p.stdin.end(); }
}
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'::bytea`;
  if (Array.isArray(v)) return `ARRAY[${v.map(lit).join(',')}]`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
const auto = new Session();
const pool = { query: (s, p) => auto.query(s, p), connect: async () => new Session(), on() {} };
const chain = () => new Proxy(function () {}, { get: (_, k) => k === 'safeParse' ? (d => ({ success: true, data: d })) : chain(), apply: () => chain() });
const orig = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'pg') return { Pool: function () { return pool; }, types: { setTypeParser() {} } };
  if (req === 'dotenv') return { config() {} };
  if (req === 'jsonwebtoken') return {};
  if (req === 'zod') return { z: chain() };
  if (req === 'express') return { Router: () => { const routes = []; const r = {}; for (const m of ['get', 'post', 'put', 'delete']) r[m] = (path, ...h) => routes.push({ m, path, h }); r.routes = routes; return r; } };
  if (req === './product_profile') return { recordPriceChange: async () => {} };
  if (/messaging$|credits$/.test(req)) return { sendSystemAlert() {}, applySupplierCredits() {} };
  return orig.call(this, req, parent, ...rest);
};
// connect() doit renvoyer une session dédiée par transaction
const core = require('../src/core');
const router = require('../src/purchase_orders');
async function call(method, path, bodyData, perms = ['purchase.manage', 'purchase.pay', 'finance.view']) {
  const route = router.routes.find(r => r.m === method.toLowerCase() && matches(r.path, path));
  if (!route) throw new Error('route ?' + method + path);
  const params = {}; route.path.split('/').forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = path.split('?')[0].split('/')[i]; });
  const req = { method, params, body: bodyData || {}, query: {}, sid: ctx.sid, user: { id: ctx.uid, perms: new Set(perms) } };
  let result, status = 200;
  const res = { status(s) { status = s; return this; }, json(d) { result = d; } };
  const handlers = route.h;
  let i = 0, error = null;
  await new Promise(resolve => {
    const next = e => { if (e) { error = e; return resolve(); } const h = handlers[i++]; if (!h) return resolve(); Promise.resolve(h(req, res, next)).then(() => { if (result !== undefined) resolve(); }).catch(er => { error = er; resolve(); }); };
    next();
  });
  if (error) { const e = error; e.status = e.status || 500; throw e; }
  return { status, data: result };
}
const matches = (pattern, path) => { const a = pattern.split('/'), b = path.split('?')[0].split('/'); return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i]); };
const ctx = {};
let passed = 0;
async function check(label, fn) { await fn(); passed++; console.log('✓ ' + label); }
async function rejects(fn, status, re) { try { await fn(); } catch (e) { assert.strictEqual(e.status, status, `statut ${e.status} ≠ ${status} (${e.message})`); if (re) assert.match(e.message, re); return; } assert.fail('devait échouer'); }
const q1 = async (s, p) => (await auto.query(s, p)).rows[0];

(async () => {
  // ----- jeu de données isolé (station dédiée)
  const st = await q1("INSERT INTO stations(name) VALUES ('BC-TEST ' || extract(epoch from now())) RETURNING id"); ctx.sid = st.id;
  const role = await q1('SELECT id FROM roles ORDER BY id LIMIT 1');
  const u = await q1("INSERT INTO users(login, password_hash, role_id) VALUES ($1,'x',$2) RETURNING id", ['bc' + Date.now(), role.id]); ctx.uid = u.id;
  await auto.query("INSERT INTO cash_registers(station_id, name, balance, active) VALUES ($1,'Caisse',1000000,TRUE)", [ctx.sid]);
  const acc = await q1("INSERT INTO money_accounts(station_id, kind, name, opening_balance, active) VALUES ($1,'mobile_money','Orange Money pro',500000,TRUE) RETURNING id", [ctx.sid]);
  await auto.query("INSERT INTO payment_methods(station_id, code, label, kind, account_id, active) VALUES ($1,'especes','Espèces','especes',NULL,TRUE) ON CONFLICT (station_id, code) DO NOTHING", [ctx.sid]);
  await auto.query("INSERT INTO payment_methods(station_id, code, label, kind, account_id, active) VALUES ($1,'orange','Orange Money','mobile_money',$2,TRUE) ON CONFLICT (station_id, code) DO NOTHING", [ctx.sid, acc.id]);
  const cat = await q1('SELECT id FROM categories ORDER BY id LIMIT 1');
  const prod = await q1("INSERT INTO products(station_id, category_id, name, buy_price, sell_price, active) VALUES ($1,$2,'Huile 5L',0,1,TRUE) RETURNING id", [ctx.sid, cat.id]);
  await auto.query("INSERT INTO stock(product_id, station_id, quantity) VALUES ($1,$2,0) ON CONFLICT (product_id) DO NOTHING", [prod.id, ctx.sid]);
  const sup = await q1("INSERT INTO suppliers(station_id, name, balance_due) VALUES ($1,'Fournisseur Test',0) RETURNING id", [ctx.sid]);
  const stock = async () => Number((await q1('SELECT quantity FROM stock WHERE product_id = $1', [prod.id])).quantity);
  const debt = async () => Number((await q1('SELECT balance_due FROM suppliers WHERE id = $1', [sup.id])).balance_due);
  const accBal = async () => Number((await q1("SELECT COALESCE(SUM(amount),0) AS b FROM money_movements WHERE account_id = $1", [acc.id])).b);
  const cashBal = async () => Number((await q1('SELECT balance FROM cash_registers WHERE station_id = $1', [ctx.sid])).balance);
  let po, det;

  await check('4. Création d’un bon de commande (brouillon puis validé), 100 unités à 1 000', async () => {
    const r = await call('POST', '/purchase-orders', { supplier_id: sup.id, items: [{ product_id: prod.id, quantity: 100, unit_cost: 1000 }], notes: 'test' });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.reception_status, 'brouillon'); assert.strictEqual(r.data.total, 100000);
    await rejects(() => call('POST', `/purchase-orders/${r.data.id}/receive`, { lines: [{ detail_id: r.data.lines[0].id, quantity: 1 }], payment_mode: 'differe' }), 409, /Brouillon/);
    const v = await call('POST', `/purchase-orders/${r.data.id}/validate`);
    assert.strictEqual(v.data.reception_status, 'valide'); po = v.data; det = v.data.lines[0].id;
    assert.match(po.order_no, /^BC-/); assert.strictEqual(await stock(), 0); assert.strictEqual(await debt(), 0);
  });

  await check('Paiement obligatoire : réception refusée sans mode de règlement, ni compte en immédiat', async () => {
    await rejects(() => call('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ detail_id: det, quantity: 10 }] }), 400, /mode de règlement/);
    await rejects(() => call('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ detail_id: det, quantity: 10 }], payment_mode: 'immediat' }), 400, /compte|mode de paiement/);
    assert.strictEqual(await stock(), 0);
  });

  await check('5-7. Réception partielle 75/100 en règlement DIFFÉRÉ : stock +75 exact, 25 en attente, dette = 75 000', async () => {
    const r = await call('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ detail_id: det, quantity: 75 }], payment_mode: 'differe', client_ref: 'r1' });
    assert.strictEqual(await stock(), 75);
    assert.strictEqual(r.data.reception_status, 'partiel'); assert.strictEqual(r.data.lines[0].qty_remaining, 25);
    assert.strictEqual(r.data.totals.amount_received, 75000); assert.strictEqual(r.data.payment_status, 'non_regle');
    assert.strictEqual(await debt(), 75000);
    assert.strictEqual(r.data.receipts.length, 1); assert.strictEqual(r.data.receipts[0].payment_mode, 'differe');
    assert.strictEqual(r.data.totals.amount_remaining_to_receive, 25000);
  });

  await check('10a. Rejeu réseau (même client_ref) : aucun double comptage de la réception', async () => {
    const r = await call('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ detail_id: det, quantity: 75 }], payment_mode: 'differe', client_ref: 'r1' });
    assert.strictEqual(r.status, 200); assert.strictEqual(await stock(), 75); assert.strictEqual(await debt(), 75000);
    assert.strictEqual(r.data.receipts.length, 1);
  });

  await check('Quantité reçue > reste à recevoir refusée (aucun effet)', async () => {
    await rejects(() => call('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ detail_id: det, quantity: 26 }], payment_mode: 'differe' }), 409, /reste à recevoir/);
    assert.strictEqual(await stock(), 75); assert.strictEqual(await debt(), 75000);
  });

  await check('Modification impossible après une réception ; annulation impossible', async () => {
    await rejects(() => call('PUT', `/purchase-orders/${po.id}`, { items: [{ product_id: prod.id, quantity: 5, unit_cost: 1 }] }), 409, /Action impossible/);
    await rejects(() => call('POST', `/purchase-orders/${po.id}/cancel`, { reason: 'test annulation' }), 409);
  });

  await check('9. Règlement ultérieur : la dette baisse, statut Partiellement réglé, trésorerie débitée', async () => {
    const cash0 = await cashBal();
    await rejects(() => call('POST', `/purchase-orders/${po.id}/pay`, { amount: 10000 }), 400);
    const r = await call('POST', `/purchase-orders/${po.id}/pay`, { amount: 30000, method: 'especes', client_ref: 'p1' });
    assert.strictEqual(await debt(), 45000); assert.strictEqual(r.data.payment_status, 'partiel'); assert.strictEqual(r.data.remaining_to_pay, 45000);
    assert.strictEqual(await cashBal(), cash0 - 30000);
    const again = await call('POST', `/purchase-orders/${po.id}/pay`, { amount: 30000, method: 'especes', client_ref: 'p1' });   // 10b. rejeu
    assert.strictEqual(await debt(), 45000); assert.strictEqual(await cashBal(), cash0 - 30000); assert.strictEqual(again.data.payments.length, 1);
    await rejects(() => call('POST', `/purchase-orders/${po.id}/pay`, { amount: 45001, method: 'especes' }), 400, /supérieur/);
  });

  await check('8. Réception du solde (25) en règlement IMMÉDIAT Orange Money : compte débité, dette inchangée par le paiement', async () => {
    const a0 = await accBal();
    const r = await call('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ detail_id: det, quantity: 25 }], payment_mode: 'immediat', method: 'orange' });
    assert.strictEqual(await stock(), 100); assert.strictEqual(r.data.reception_status, 'recu');
    assert.strictEqual(await accBal(), a0 - 25000);
    assert.strictEqual(await debt(), 45000);                 // 75 000 + 25 000 reçus − 30 000 − 25 000 payés
    assert.strictEqual(r.data.totals.amount_received, 100000); assert.strictEqual(r.data.paid, 55000);
    assert.strictEqual(r.data.receipts.length, 2); assert.strictEqual(r.data.receipts[1].amount_paid, 25000);
    assert.strictEqual(r.data.payment_status, 'partiel');
  });

  await check('Solde final : paiement du reste → Soldé, dette fournisseur 0, aucun double comptage', async () => {
    const r = await call('POST', `/purchase-orders/${po.id}/pay`, { amount: 45000, method: 'orange' });
    assert.strictEqual(r.data.payment_status, 'solde'); assert.strictEqual(await debt(), 0); assert.strictEqual(await stock(), 100);
    await rejects(() => call('POST', `/purchase-orders/${po.id}/pay`, { amount: 1, method: 'orange' }), 409, /Rien à régler/);
    const mv = await q1("SELECT COUNT(*)::int AS n, SUM(quantity) AS q FROM stock_movements WHERE ref_table = 'purchases' AND ref_id = $1", [po.id]);
    assert.strictEqual(mv.n, 2); assert.strictEqual(Number(mv.q), 100);
    const sp = await q1('SELECT COUNT(*)::int AS n, SUM(amount) AS a FROM supplier_payments WHERE purchase_id = $1', [po.id]);
    assert.strictEqual(sp.n, 3); assert.strictEqual(Number(sp.a), 100000);
  });

  await check('Règlement immédiat sans permission de payer refusé ; liste/filtres', async () => {
    const r = await call('POST', '/purchase-orders', { supplier_id: sup.id, items: [{ product_id: prod.id, quantity: 4, unit_cost: 500 }], validate: true });
    await rejects(() => call('POST', `/purchase-orders/${r.data.id}/receive`, { lines: [{ detail_id: r.data.lines[0].id, quantity: 4 }], payment_mode: 'immediat', method: 'especes' }, ['purchase.manage']), 403);
    const e = await call('PUT', `/purchase-orders/${r.data.id}`, { items: [{ product_id: prod.id, quantity: 6, unit_cost: 500 }] });
    assert.strictEqual(e.data.total, 3000);
    const c = await call('POST', `/purchase-orders/${r.data.id}/cancel`, { reason: 'erreur de saisie' });
    assert.strictEqual(c.data.reception_status, 'annule'); assert.strictEqual(await stock(), 100);
  });

  await check('8. Pièce jointe : photo du bon de livraison enregistrée, contrôlée (type réel) et listée', async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString('base64');
    const r = await call('POST', `/purchase-orders/${po.id}/attachments`, { filename: 'bl fournisseur.jpg', mime: 'image/jpeg', data: jpeg });
    assert.strictEqual(r.status, 201); assert.strictEqual(r.data.attachments.length, 1); assert.strictEqual(r.data.attachments[0].size, 204);
    await rejects(() => call('POST', `/purchase-orders/${po.id}/attachments`, { filename: 'faux.pdf', mime: 'application/pdf', data: jpeg }), 400, /ne correspond pas/);
    const row = await q1('SELECT length(data) AS n FROM purchase_attachments WHERE purchase_id = $1', [po.id]); assert.strictEqual(Number(row.n), 204);
  });

  console.log(`\n${passed} vérifications réussies`);
  auto.end(); process.exit(0);
})().catch(e => { console.error('✗', e.message, e.pg || e.stack); process.exit(1); });
