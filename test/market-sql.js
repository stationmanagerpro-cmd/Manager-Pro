'use strict';
// Fonctions marché (rapprochement, fidélité, risque, prévision, prix du jour), exécutés contre un VRAI PostgreSQL (migrations 001→101 appliquées).
// Désactivé par défaut (aucune base requise pour `npm test`). Activation :
//   BC_PSQL="psql -h <hôte/socket> -p <port> -X -q -At -d <base>"  node test/market-sql.js
// (le script envoie les requêtes via psql : pas de module 'pg' nécessaire). Ne PAS pointer vers une base de production.
const { spawn } = require('child_process');
const Module = require('module');
const assert = require('assert');
const CMD = process.env.BC_PSQL;
if (!CMD) { console.log('market-sql : ignoré (BC_PSQL non défini)'); process.exit(0); }

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
  if (req === './premium') return { requireModule: () => (_q, _s, n) => n() };
  if (req === './mailer') return { sendMail: async () => ({ ok: true }) };
  if (req === 'express-rate-limit') return () => (_q, _s, n) => n();
  if (req === 'dotenv') return { config() {} };
  if (req === 'jsonwebtoken') return {};
  if (req === 'zod') return { z: chain() };
  if (req === 'express') return { Router: () => { const routes = []; const r = {}; r.use = () => {}; for (const m of ['get', 'post', 'put', 'delete']) r[m] = (path, ...h) => routes.push({ m, path, h }); r.routes = routes; return r; } };
  if (req === './product_profile') return { recordPriceChange: async (c, { station, product, type, oldPrice, newPrice, by = null, note = null }) => {
    if (oldPrice != null && Number(oldPrice) === Number(newPrice)) return false;
    await c.query('UPDATE price_history SET effective_to = now() WHERE station_id = $1 AND product_id = $2 AND price_type = $3 AND effective_to IS NULL', [station, product, type]);
    await c.query('INSERT INTO price_history(station_id, product_id, price_type, price, old_price, effective_from, created_by, note) VALUES ($1,$2,$3,$4,$5,now(),$6,$7)', [station, product, type, newPrice, oldPrice, by, note]); return true; } };
  if (/messaging$|credits$/.test(req)) return { sendSystemAlert() {}, applySupplierCredits() {} };
  return orig.call(this, req, parent, ...rest);
};
// connect() doit renvoyer une session dédiée par transaction
const core = require('../src/core');
const router = require('../src/market');
const portal = require('../src/client_portal');
const gaps = require('../src/gaps');
async function call(method, path, bodyData, perms = ['money.manage', 'finance.view', 'report.view', 'sale.create', 'customer.view', 'customer.edit', 'settings.edit', 'price.edit', 'cost.view'], rt = router) {
  const route = rt.routes.find(r => r.m === method.toLowerCase() && matches(r.path, path));
  if (!route) throw new Error('route ?' + method + path);
  const params = {}; route.path.split('/').forEach((seg, i) => { if (seg.startsWith(':')) params[seg.slice(1)] = path.split('?')[0].split('/')[i]; });
  const req = { method, params, body: bodyData || {}, query: Object.fromEntries(new URLSearchParams(path.split('?')[1] || '')), protocol: 'https', get: () => 'example.test', setHeader() {}, sid: ctx.sid, user: { id: ctx.uid, perms: new Set(perms) } };
  let result, status = 200;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(d) { result = d; } };
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
const ins = async (s, p) => (await auto.query(s + ' RETURNING id', p)).rows[0].id;

(async () => {
  const st = await q1("INSERT INTO stations(name) VALUES ('MK-TEST ' || extract(epoch from now())) RETURNING id"); ctx.sid = st.id;
  const role = await q1('SELECT id FROM roles ORDER BY id LIMIT 1');
  const u = await q1("INSERT INTO users(login, password_hash, role_id) VALUES ($1,'x',$2) RETURNING id", ['mk' + Date.now(), role.id]); ctx.uid = u.id;
  const cr = await ins("INSERT INTO cash_registers(station_id, name, balance, active) VALUES ($1,'Caisse',0,TRUE)", [ctx.sid]);
  const acc = await ins("INSERT INTO money_accounts(station_id, kind, name, opening_balance, active) VALUES ($1,'mobile_money','Orange Money',0,TRUE)", [ctx.sid]);
  const fuel = await ins("INSERT INTO products(station_id, category_id, name, buy_price, sell_price, active, unit) VALUES ($1,1,'Gasoil',600,700,TRUE,'L')", [ctx.sid]);
  const oil = await ins("INSERT INTO products(station_id, category_id, name, buy_price, sell_price, active) VALUES ($1,3,'Huile',1000,2000,TRUE)", [ctx.sid]);
  await auto.query("INSERT INTO stock(product_id, station_id, quantity) VALUES ($1,$2,300),($3,$2,50)", [fuel, ctx.sid, oil]);
  const e1 = await ins("INSERT INTO employees(station_id, matricule, last_name, first_name, position) VALUES ($1,'E1','Traore','Awa','Pompiste')", [ctx.sid]);
  const e2 = await ins("INSERT INTO employees(station_id, matricule, last_name, first_name, position) VALUES ($1,'E2','Diallo','Moussa','Pompiste')", [ctx.sid]);
  const mkShift = async (n, day, gap) => ins(`INSERT INTO shifts(station_id, number, shift_date, kind, manager_id, cash_register_id, status, opened_at) VALUES ($1,$2,$3,'jour',$4,$5,'ouvert',$3::date + time '06:00')`, [ctx.sid, n, day, ctx.uid, cr, gap]);
  const dayMinus = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const sh = await mkShift(1, dayMinus(1));
  const sale = async (invoice, total, status = 'valide', emp = e1, prod = fuel, qty = 10) => {
    const id = await ins("INSERT INTO sales(station_id, shift_id, employee_id, invoice_no, total, status, kind, sold_at) VALUES ($1,$2,$3,$4,$5,$6,'carburant', now() - interval '1 day')", [ctx.sid, sh, emp, invoice, total, status]);
    await auto.query('INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, amount) VALUES ($1,$2,$3,$4,$5)', [id, prod, qty, total / qty, total]); return id;
  };

  await check('A. Rapprochement : 3 paiements OM déclarés, 2 reçus + 1 reçu non déclaré', async () => {
    const s1 = await sale('F1', 10000), s2 = await sale('F2', 5000, 'valide', e2), s3 = await sale('F3', 7000, 'valide', e2), s4 = await sale('F4', 9000, 'annule');
    const d = dayMinus(1);
    for (const [s, a] of [[s1, 10000], [s2, 5000], [s3, 7000], [s4, 9000]]) await auto.query("INSERT INTO payments(station_id, sale_id, shift_id, method, amount, paid_at) VALUES ($1,$2,$3,'mobile_money',$4, now() - interval '1 day')", [ctx.sid, s, sh, a]);
    for (const [a, h] of [[10000, 'a'], [5000, 'b'], [4242, 'c']]) await auto.query("INSERT INTO money_statement_lines(station_id, account_id, line_date, amount, line_hash) VALUES ($1,$2,$3,$4,$5)", [ctx.sid, acc, d, a, h + ctx.sid]);
    ctx.sOil = await sale('F5', 20000, 'valide', e1, oil, 10);
    await auto.query("INSERT INTO shift_anomalies(shift_id, kind, description) VALUES ($1,'index_incoherent','test')", [sh]);
    await auto.query("UPDATE shifts SET status='ferme', closed_at=now(), theoretical_cash=100000, cash_gap=-3000 WHERE id=$1", [sh]);
    const r = (await call('GET', `/money/sales-reconcile?account_id=${acc}&from=${dayMinus(3)}&to=${dayMinus(0)}`)).data;
    assert.strictEqual(r.summary.declared, 22000, 'annulée exclue');
    assert.strictEqual(r.summary.matched_count, 2);
    assert.strictEqual(r.summary.declared_not_received, 7000);
    assert.strictEqual(r.summary.received_not_declared, 4242);
    assert.strictEqual(r.by_employee[0].employee, 'Moussa Diallo');
    await rejects(() => call('GET', '/money/sales-reconcile'), 400);
  });

  await check('B. Fidélité : activation, gain, idempotence, utilisation, ajustement', async () => {
    await rejects(() => call('POST', '/loyalty/earn', { sale_id: 1, phone: '70112233' }), 409, /désactivé/);
    await call('PUT', '/loyalty/settings', { enabled: true, earn_per_amount: 1000, point_value: 10, min_redeem: 5, fuel_only: true });
    const sFuel = await q1("SELECT s.id FROM sales s WHERE s.station_id=$1 AND invoice_no='F1'", [ctx.sid]);
    const e = (await call('POST', '/loyalty/earn', { sale_id: sFuel.id, phone: '70 11 22 33', plate: 'ab-123-cd' })).data;
    assert.strictEqual(e.points_earned, 10); assert.strictEqual(e.account.plate, 'AB123CD');
    const again = (await call('POST', '/loyalty/earn', { sale_id: sFuel.id, phone: '70112233' })).data;
    assert.strictEqual(again.already, true); assert.strictEqual(again.account.points, 10);
    const lk = (await call('GET', '/loyalty/lookup?plate=ab-123-cd')).data; assert.strictEqual(lk.account.points, 10);
    const sOil = ctx.sOil;
    const o = (await call('POST', '/loyalty/earn', { sale_id: sOil, plate: 'AB123CD' })).data; assert.strictEqual(o.points_earned, 0, 'huile hors carburant');
    const id = e.account.id;
    await rejects(() => call('POST', `/loyalty/accounts/${id}/redeem`, { points: 3 }), 409, /Minimum/);
    await rejects(() => call('POST', `/loyalty/accounts/${id}/redeem`, { points: 50 }), 409, /insuffisant/);
    const rd = (await call('POST', `/loyalty/accounts/${id}/redeem`, { points: 6 })).data; assert.strictEqual(rd.value, 60); assert.strictEqual(rd.account.points, 4);
    await rejects(() => call('POST', `/loyalty/accounts/${id}/adjust`, { points: -10, note: 'erreur' }), 409);
    const aj = (await call('POST', `/loyalty/accounts/${id}/adjust`, { points: 5, note: 'geste commercial' })).data; assert.strictEqual(aj.account.points, 9);
    const det = (await call('GET', `/loyalty/accounts/${id}`)).data; assert.strictEqual(det.events.length, 3);
    const nt = (await call('POST', `/loyalty/accounts/${id}/notify`)).data; assert.ok(nt.wa_link.includes('wa.me'));
    const sCan = await q1("SELECT id FROM sales WHERE station_id=$1 AND invoice_no='F4'", [ctx.sid]);
    await rejects(() => call('POST', '/loyalty/earn', { sale_id: sCan.id, phone: '70112233' }), 409, /annulée/);
    const list = (await call('GET', '/loyalty/accounts?search=AB-123')).data; assert.strictEqual(list.accounts.length, 1);
  });

  await check('C. Risque : écart + annulation + anomalie → score expliqué', async () => {
    const r = (await call('GET', `/risk/shifts?from=${dayMinus(3)}&to=${dayMinus(0)}`)).data;
    const s = r.shifts.find(x => x.id === sh); assert.ok(s, 'quart présent'); assert.ok(s.score > 0, 'score ' + s.score);
    assert.ok(['a_controler', 'a_surveiller', 'normal'].includes(s.level)); assert.strictEqual(s.cancelled_count, 1);
  });

  await check('D. Prévision : vente de 20 L/jour, stock 300 → ~19 jours', async () => {
    for (let i = 1; i <= 14; i++) await auto.query("INSERT INTO stock_movements(station_id, product_id, kind, quantity, created_at) VALUES ($1,$2,'vente',-20, now() - ($3 || ' days')::interval)", [ctx.sid, fuel, String(i)]);
    await auto.query('UPDATE stock SET quantity = 300 WHERE product_id = $1', [fuel]);
    const r = (await call('GET', '/stock/forecast?lead=2')).data;
    const it = r.items.find(x => x.id === fuel); assert.ok(it, 'carburant prévu'); assert.ok(Math.abs(it.days_left - 19) < 2, 'jours ' + it.days_left);
    assert.ok(r.no_sales.some(x => x.id === oil), 'huile sans vente');
    await auto.query('UPDATE stock SET quantity = 30 WHERE product_id = $1', [fuel]);
    const r2 = (await call('GET', '/stock/forecast?lead=2')).data; assert.strictEqual(r2.items.find(x => x.id === fuel).level, 'critique');
  });

  await check('E. Prix du jour : tableau, marge, changement groupé, historique', async () => {
    const b = (await call('GET', '/prices/board')).data; assert.strictEqual(b.items.length, 1); assert.strictEqual(b.items[0].margin, 100);
    const nb = (await call('GET', '/prices/board', null, ['report.view'])).data; assert.strictEqual(nb.items[0].margin, undefined, 'marge masquée sans cost.view');
    await rejects(() => call('POST', '/prices/board', { changes: [{ product_id: fuel, price: 700 }] }), 400);
    await rejects(() => call('POST', '/prices/board', { changes: [{ product_id: oil, price: 100 }] }), 404);
    const r = (await call('POST', '/prices/board', { changes: [{ product_id: fuel, price: 750 }], note: 'hausse' })).data; assert.strictEqual(r.changed[0].new_price, 750);
    assert.strictEqual(Number((await q1('SELECT sell_price FROM products WHERE id=$1', [fuel])).sell_price), 750);
    const h = await q1("SELECT old_price::float8 AS o, price::float8 AS p FROM price_history WHERE product_id=$1 AND price_type='sell' ORDER BY id DESC LIMIT 1", [fuel]);
    assert.deepStrictEqual([h.o, h.p], [700, 750]);
    const b2 = (await call('GET', '/prices/board')).data; assert.strictEqual(b2.items[0].previous_price, 700);
  });

  await check('F. Espace client : lien à jeton haché, lecture, expiration, révocation', async () => {
    const cu = await ins("INSERT INTO customers(station_id, name, kind, balance, credit_limit, active) VALUES ($1,'Client Test','entreprise',15000,50000,TRUE)", [ctx.sid]);
    const l = (await call('POST', '/portal/links', { customer_id: cu, days: 7 }, undefined, portal)).data;
    assert.match(l.url, /\/c\/[A-Za-z0-9_-]{30,}$/); const tok = l.url.split('/c/')[1];
    assert.strictEqual((await q1('SELECT count(*)::int AS n FROM client_portal_links WHERE token_hash = $1', [tok])).n, 0, 'jeton jamais stocké en clair');
    const pubCall = t => call('GET', '/portal/' + t, null, [], portal.pub);
    const d = (await pubCall(tok)).data; assert.strictEqual(d.customer.name, 'Client Test'); assert.strictEqual(d.balance, 15000); assert.strictEqual(d.available, 35000);
    assert.ok(!JSON.stringify(d).match(/"(station_id|customer_id|id)"/), 'aucun identifiant interne');
    await rejects(() => pubCall('x'.repeat(30)), 404);
    assert.strictEqual((await q1('SELECT views FROM client_portal_links WHERE id = $1', [l.id])).views, 1);
    await auto.query("UPDATE client_portal_links SET expires_at = now() - interval '1 day' WHERE id = $1", [l.id]); await rejects(() => pubCall(tok), 404);
    const l2 = (await call('POST', '/portal/links', { customer_id: cu }, undefined, portal)).data, t2 = l2.url.split('/c/')[1];
    await call('POST', '/portal/links/' + l2.id + '/revoke', {}, undefined, portal); await rejects(() => pubCall(t2), 404);
    const list = (await call('GET', '/portal/links', null, undefined, portal)).data; assert.strictEqual(list.filter(x => x.active).length, 0);
  });

  await check('G. Liens vente → fidélité et mode Orange personnalisé', async () => {
    const mm = await q1("SELECT count(*)::int AS n FROM payment_methods WHERE station_id=$1 AND kind='mobile_money'", [ctx.sid]);
    await auto.query("INSERT INTO payment_methods(station_id, code, label, kind) VALUES ($1,'orange_pay','Orange Pay','mobile_money'),($1,'mobile_money','Mobile Money','mobile_money')", [ctx.sid]);
    const sh2 = await mkShift(2, dayMinus(1));
    const sOm = await ins("INSERT INTO sales(station_id, shift_id, employee_id, invoice_no, total, status, kind, sold_at) VALUES ($1,$2,$3,'F9',3000,'valide','carburant', now() - interval '1 day')", [ctx.sid, sh2, e1]);
    await auto.query('INSERT INTO sale_details(sale_id, product_id, quantity, unit_price, amount) VALUES ($1,$2,3,1000,3000)', [sOm, fuel]);
    await auto.query("INSERT INTO payments(station_id, sale_id, shift_id, method, amount, paid_at) VALUES ($1,$2,$3,'orange_pay',3000, now() - interval '1 day')", [ctx.sid, sOm, sh2]);
    await auto.query("UPDATE shifts SET status='ferme', closed_at=now() WHERE id=$1", [sh2]);
    const r = (await call('GET', `/money/sales-reconcile?account_id=${acc}&from=${dayMinus(3)}&to=${dayMinus(0)}`)).data;
    assert.ok(r.methods.includes('orange_pay'), 'méthodes ' + r.methods); assert.strictEqual(r.summary.declared, 25000, 'inclut le mode personnalisé');
    const ok = await router.afterSale({ sid: ctx.sid, user: { id: ctx.uid } }, sOm, { phone: '76 00 11 22', plate: 'zz-9-zz' });
    assert.strictEqual(ok.points_earned, 3); assert.strictEqual(ok.account.plate, 'ZZ9ZZ');
    assert.strictEqual(await router.afterSale({ sid: ctx.sid, user: { id: ctx.uid } }, sOm, { phone: '' }), null, 'sans données : rien');
    await auto.query("UPDATE loyalty_settings SET enabled = FALSE WHERE station_id = $1", [ctx.sid]);
    assert.strictEqual(await router.afterSale({ sid: ctx.sid, user: { id: ctx.uid } }, sOm, { phone: '76001122' }), null, 'programme désactivé : la vente n’est jamais bloquée');
  });

  await check('H. Transferts de stock entre stations : envoi, réception, annulation', async () => {
    const cl = await q1("INSERT INTO clients(name) VALUES ('Client transferts') RETURNING id").catch(() => null);
    const st2 = await q1("INSERT INTO stations(name) VALUES ('MK-DEST') RETURNING id");
    if (cl) await auto.query('UPDATE stations SET client_id = $1 WHERE id IN ($2,$3)', [cl.id, ctx.sid, st2.id]);
    await auto.query('INSERT INTO user_stations(user_id, station_id) VALUES ($1,$2),($1,$3) ON CONFLICT DO NOTHING', [ctx.uid, ctx.sid, st2.id]);
    const pd = await ins("INSERT INTO products(station_id, category_id, name, buy_price, sell_price, active) VALUES ($1,3,'Huile',1000,2000,TRUE)", [st2.id]);
    await auto.query('INSERT INTO stock(product_id, station_id, quantity) VALUES ($1,$2,5)', [pd, st2.id]);
    await auto.query('UPDATE stock SET quantity = 50 WHERE product_id = $1', [oil]);
    const P = ['transfer.manage', 'stock.adjust', 'report.view'];
    const dests = (await call('GET', '/stock/transfers/stations', null, P, gaps)).data; assert.ok(dests.some(d => d.id === st2.id));
    await rejects(() => call('POST', '/stock/transfers', { to_station_id: st2.id, items: [{ product_id: oil, quantity: 999 }] }, P, gaps), 409, /insuffisant/);
    const t = (await call('POST', '/stock/transfers', { to_station_id: st2.id, items: [{ product_id: oil, quantity: 20 }], comment: 'test' }, P, gaps)).data;
    assert.strictEqual(Number((await q1('SELECT quantity FROM stock WHERE product_id=$1', [oil])).quantity), 30);
    const t2 = (await call('POST', '/stock/transfers', { to_station_id: st2.id, items: [{ product_id: oil, quantity: 5 }] }, P, gaps)).data;
    await call('POST', `/stock/transfers/${t2.id}/cancel`, {}, P, gaps);
    assert.strictEqual(Number((await q1('SELECT quantity FROM stock WHERE product_id=$1', [oil])).quantity), 30, 'annulation restitue');
    await rejects(() => call('POST', `/stock/transfers/${t.id}/receive`, {}, P, gaps), 404);   // mauvaise station (la source ne reçoit pas)
    ctx.sid = st2.id; await call('POST', `/stock/transfers/${t.id}/receive`, {}, P, gaps);
    assert.strictEqual(Number((await q1('SELECT quantity FROM stock WHERE product_id=$1', [pd])).quantity), 25);
    await rejects(() => call('POST', `/stock/transfers/${t.id}/receive`, {}, P, gaps), 409);
    const lst = (await call('GET', '/stock/transfers', null, P, gaps)).data; assert.strictEqual(lst.find(x => x.id === t.id).items[0].quantity, 20);
    ctx.sid = (await q1('SELECT id FROM stations WHERE name LIKE $1 ORDER BY id DESC LIMIT 1 OFFSET 1', ['MK-TEST%'])).id;
  });

  await check('I. Prêts, SMTP, licence, préférences dashboard, compétences', async () => {
    const loan = await ins("INSERT INTO personal_loans(station_id, borrower_name, amount, loan_date) VALUES ($1,'Ali',1000, CURRENT_DATE)", [ctx.sid]);
    await auto.query("INSERT INTO personal_loan_payments(loan_id, amount, method) VALUES ($1,400,'especes')", [loan]);
    const lp = (await call('GET', `/finance/loans/${loan}/payments`, null, undefined, gaps)).data; assert.strictEqual(lp[0].amount, 400);
    const sm = (await call('POST', '/admin/smtp/test', { to: 'a@b.co' }, undefined, gaps)).data; assert.strictEqual(sm.success, false, 'sans SMTP_HOST : échec expliqué'); assert.match(sm.diagnostic, /SMTP/);
    assert.strictEqual((await call('GET', '/admin/smtp/diagnostics', null, undefined, gaps)).data.length, 1);
    const cl = await q1('SELECT client_id FROM stations WHERE id=$1', [ctx.sid]);
    if (cl.client_id) { assert.strictEqual(await gaps.logLicenseWarning(cl.client_id, 6), true); assert.strictEqual(await gaps.logLicenseWarning(cl.client_id, 6), false, 'pas de doublon'); }
    await call('PUT', '/dashboard/my-prefs', { cards: { revenue: false, fuel: true }, sections: { shifts: false } }, undefined, gaps);
    const pf = (await call('GET', '/dashboard/my-prefs', null, undefined, gaps)).data; assert.deepStrictEqual(pf.cards, { revenue: false }, 'seuls les masquages sont gardés');
    const sk = (await call('POST', '/hr/v2/skills', { label: 'Conduite sécurisée' }, ['hr.manage'], gaps)).data; assert.ok(sk.id);
    const pump = await ins("INSERT INTO pumps(station_id, number, name) VALUES ($1,1,'P1')", [ctx.sid]);
    const ev = await q1("INSERT INTO pump_counters(pump_id, counter_number, product_id, current_index) VALUES ($1,1,$2,0) RETURNING id", [pump, fuel]);
    await auto.query("INSERT INTO pump_counter_history(counter_id, product_id) VALUES ($1,$2)", [ev.id, fuel]);
    if (ev) { await auto.query("INSERT INTO counter_events(counter_id, station_id, event_type, index_before, index_after, reason) VALUES ($1,$2,'correction',10,12,'erreur')", [ev.id, ctx.sid]);
      const h = (await call('GET', '/pumps/counter-history', null, undefined, gaps)).data; assert.ok(h.some(x => x.kind === 'correction' && x.index_after === 12) && h.some(x => x.kind === 'produit')); }
  });

  console.log(`\n${passed} scénarios OK`); auto.end(); process.exit(0);
})().catch(e => { console.error('✗ ÉCHEC :', e.message, e.pg || e.stack); process.exit(1); });
