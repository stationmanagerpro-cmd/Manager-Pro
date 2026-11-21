'use strict';
// Scan QR des pompes : scénarios exécutés sur une VRAIE base PostgreSQL (schéma issu de toutes les migrations), avec le VRAI code de
// src/qr_codes.js / qr_db.js / qr_logic.js / qr_pdf.js (voir test/helpers/qr-harness.js pour ce que la doublure remplace).
// Lancement : QR_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ma_base_test node test/qr-db-scenarios.js
//   ou, avec psql : PGHOST=/tmp PGPORT=5544 PGUSER=postgres PGDATABASE=sm_test node test/qr-db-scenarios.js
// Sans base locale nommée « test » ou « ci » : le test s'ignore (code 0) et le SKIP est écrit en clair. Il crée ses propres données (suffixe unique).
const assert = require('assert');
const H = require('./helpers/qr-harness');
const L = require('../src/qr_logic');
const D = require('../src/qr_db');

let ok = 0, ko = 0; const failures = [];
async function t(name, fn) { try { await fn(); ok++; console.log('✓ ' + name); } catch (e) { ko++; failures.push(name); console.log('✗ ' + name + '\n   ' + (e.message || e).toString().split('\n').slice(0, 3).join('\n   ')); } }

(async () => {
  const pool = await H.connect();
  if (!pool) { console.log('SKIP : aucune base locale « test/ci » configurée (QR_TEST_DATABASE_URL ou PGDATABASE). Aucun contrôle exécuté.'); process.exit(0); }
  const sfx = Date.now().toString(36), q = (sql, p) => pool.query(sql, p);
  const ins = async (sql, p) => (await q(sql + ' RETURNING id', p)).rows[0].id;
  const roleId = async code => (await q('SELECT id FROM roles WHERE code = $1 AND client_id IS NULL', [code])).rows[0].id;
  const permsOf = async code => new Set((await q('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id JOIN roles r ON r.id = rp.role_id WHERE r.code = $1 AND r.client_id IS NULL', [code])).rows.map(x => x.code));
  const mkUser = async (login, role) => ({ id: await ins('INSERT INTO users(login, password_hash, role_id) VALUES ($1,$2,$3)', [login + '_' + sfx, 'x', await roleId(role)]), perms: await permsOf(role), role });

  // ---------- Données ----------
  const stA = await ins('INSERT INTO stations(name) VALUES ($1)', ['Station A ' + sfx]), stB = await ins('INSERT INTO stations(name) VALUES ($1)', ['Station B ' + sfx]);
  const gerA = await mkUser('gerA', 'GERANT'), gerB = await mkUser('gerB', 'GERANT'), pomp1 = await mkUser('pomp1', 'POMPISTE'), pomp2 = await mkUser('pomp2', 'POMPISTE'), pomp3 = await mkUser('pomp3', 'POMPISTE'), pompB = await mkUser('pompB', 'POMPISTE');
  const emp = async (st, u, n) => ins(`INSERT INTO employees(station_id, user_id, matricule, last_name, first_name, position) VALUES ($1,$2,$3,$4,$5,'pompiste')`, [st, u ? u.id : null, 'M' + n + sfx, 'Nom' + n, 'Prénom' + n]);
  const e1 = await emp(stA, pomp1, 1), e2 = await emp(stA, pomp2, 2), e3 = await emp(stA, pomp3, 3), eB = await emp(stB, pompB, 9);
  const cat = (await q('SELECT id FROM categories LIMIT 1')).rows[0].id;
  const prod = (st, n) => ins('INSERT INTO products(station_id, category_id, name, buy_price, sell_price) VALUES ($1,$2,$3,500,700)', [st, cat, n]);
  const gasA = await prod(stA, 'Gasoil'), supA = await prod(stA, 'Super'), gasB = await prod(stB, 'Gasoil');
  const pump = (st, n, status = 'active') => ins('INSERT INTO pumps(station_id, number, name, status) VALUES ($1,$2,$3,$4)', [st, n, 'Pompe ' + n, status]);
  const pu1 = await pump(stA, 1), pu2 = await pump(stA, 2), pu3 = await pump(stA, 3, 'inactive'), puB = await pump(stB, 1);
  const ctr = (pu, n, pr) => ins('INSERT INTO pump_counters(pump_id, counter_number, product_id) VALUES ($1,$2,$3)', [pu, n, pr]);
  const c1 = await ctr(pu1, 1, gasA), c2 = await ctr(pu1, 2, supA), c3 = await ctr(pu2, 1, gasA), c4 = await ctr(pu3, 1, gasA), cB = await ctr(puB, 1, gasB);
  const reg = await ins('INSERT INTO cash_registers(station_id, name) VALUES ($1,$2)', [stA, 'Caisse A']);
  const shift = await ins(`INSERT INTO shifts(station_id, number, shift_date, kind, manager_id, cash_register_id, status) VALUES ($1,1,CURRENT_DATE,'jour',$2,$3,'ouvert')`, [stA, gerA.id, reg]);
  await q('INSERT INTO shift_employees(shift_id, employee_id, pump_id) VALUES ($1,$2,$3)', [shift, e1, pu1]);
  await q('INSERT INTO shift_employees(shift_id, employee_id, pump_id) VALUES ($1,$2,$3)', [shift, e2, pu2]);
  for (const [c, pu, pr] of [[c1, pu1, gasA], [c2, pu1, supA], [c3, pu2, gasA], [c4, pu3, gasA]]) await q('INSERT INTO meter_readings(shift_id, counter_id, pump_id, product_id, index_start) VALUES ($1,$2,$3,$4,1000)', [shift, c, pu, pr]);

  const api = H.install(pool);
  const as = (user, sid) => ({ user, sid });
  const admA = as(gerA, stA), admB = as(gerB, stB), p1 = as(pomp1, stA), p2 = as(pomp2, stA), p3 = as(pomp3, stA);
  const tokenOf = async id => (await q('SELECT token FROM qr_codes WHERE id = $1', [id])).rows[0].token;
  const scan = (who, token) => api.call('POST', '/sales/scan-pump', { ...who, body: { code: L.payloadOf(token) } });
  const codeOf = r => r.body && r.body.details && r.body.details.code;
  const events = async (where = 'true') => (await q(`SELECT * FROM qr_events WHERE ${where} ORDER BY id`)).rows;

  // ---------- 1-3 : génération, unicité, droits ----------
  let bulk;
  await t('1. Génération groupée : un QR actif par compteur de la station (4), aucun pour l’autre station', async () => {
    bulk = await api.call('POST', '/qr-codes/bulk', admA); assert.strictEqual(bulk.status, 201, JSON.stringify(bulk.body));
    assert.strictEqual(bulk.body.created.length, 4);
    const n = (await q('SELECT station_id, COUNT(*)::int AS n FROM qr_codes WHERE station_id IN ($1,$2) GROUP BY station_id', [stA, stB])).rows;
    assert.deepStrictEqual(n.map(x => [Number(x.station_id), x.n]), [[stA, 4]]);
  });
  await t('1b. Relancer la génération ne crée aucun doublon actif (idempotent)', async () => {
    const r = await api.call('POST', '/qr-codes/bulk', admA); assert.strictEqual(r.status, 200); assert.strictEqual(r.body.created.length, 0);
    const r2 = await api.call('POST', `/pumps/${pu1}/qr-code`, { ...admA, body: {} }); assert.strictEqual(r2.status, 200); assert.strictEqual(r2.body.created.length, 0);
  });
  await t('2. Jetons uniques, opaques (32 car. base64url), référence courte XXXX-XXXX, aucune donnée métier dans le jeton', async () => {
    const rows = (await q('SELECT token, short_ref FROM qr_codes WHERE station_id = $1', [stA])).rows;
    assert.strictEqual(new Set(rows.map(r => r.token)).size, rows.length);
    for (const r of rows) { assert.match(r.token, /^[A-Za-z0-9_-]{32}$/); assert.match(r.short_ref, /^[0-9A-F]{4}-[0-9A-F]{4}$/); assert.strictEqual(L.shortRef(r.token), r.short_ref); assert.ok(!r.token.startsWith('SMP1')); }
  });
  await t('2b. Un second QR actif pour le même compteur est refusé par la base (index unique partiel)', async () => {
    await assert.rejects(() => q(`INSERT INTO qr_codes(station_id, pump_id, counter_id, token, short_ref) VALUES ($1,$2,$3,$4,'AAAA-BBBB')`, [stA, pu1, c1, 'a'.repeat(32)]), /uq_qr_codes_active_counter|duplicate/i);
  });
  await t('2c. Format du jeton contraint en base (CHECK)', async () => {
    await assert.rejects(() => q(`INSERT INTO qr_codes(station_id, pump_id, counter_id, token, short_ref, status) VALUES ($1,$2,$3,'trop-court','AAAA-BBBB','revoked')`, [stA, pu1, c1]), /check/i);
  });
  await t('23. Droits : un pompiste ne peut ni lister, ni générer, ni révoquer, ni imprimer, ni lire l’historique', async () => {
    const id = (await q('SELECT id FROM qr_codes WHERE counter_id = $1', [c1])).rows[0].id;
    for (const [m, u, body] of [['GET', '/qr-codes'], ['POST', '/qr-codes/bulk'], ['POST', `/pumps/${pu1}/qr-code`, {}], ['PATCH', `/qr-codes/${id}/revoke`, {}], ['POST', `/qr-codes/${id}/regenerate`, {}], ['GET', '/qr-codes/sheet.pdf'], ['GET', `/qr-codes/${id}/label.pdf`], ['GET', '/qr-codes/history']]) {
      const r = await api.call(m, u, { ...p1, body: body || {} }); assert.strictEqual(r.status, 403, m + ' ' + u + ' → ' + r.status);
    }
    assert.ok(!pomp1.perms.has('qr.manage') && pomp1.perms.has('sale.create') && gerA.perms.has('qr.manage'));
    assert.ok((await permsOf('ADMIN')).has('qr.manage'));
  });

  // ---------- 4 : isolation des stations (administration) ----------
  await t('24. Isolation : la liste, la révocation et les étiquettes d’une station ne touchent jamais l’autre', async () => {
    const listB = await api.call('GET', '/qr-codes', admB); assert.strictEqual(listB.status, 200); assert.strictEqual(listB.body.items.length, 1); assert.strictEqual(Number(listB.body.items[0].counter_id), cB);
    const idA = (await q('SELECT id FROM qr_codes WHERE counter_id = $1', [c1])).rows[0].id;
    assert.strictEqual((await api.call('PATCH', `/qr-codes/${idA}/revoke`, { ...admB, body: {} })).status, 404);
    assert.strictEqual((await api.call('POST', `/qr-codes/${idA}/regenerate`, { ...admB, body: {} })).status, 404);
    assert.strictEqual((await api.call('GET', `/qr-codes/${idA}/label.pdf`, admB)).status, 404);
    assert.strictEqual((await api.call('POST', `/pumps/${pu1}/qr-code`, { ...admB, body: {} })).status, 404);
    assert.strictEqual((await q('SELECT status FROM qr_codes WHERE id = $1', [idA])).rows[0].status, 'active');
  });
  await t('3. Génération pour la station B puis planche PDF : seulement ses étiquettes (jamais celles de A)', async () => {
    assert.strictEqual((await api.call('POST', '/qr-codes/bulk', admB)).status, 201);
    const rB = await api.call('GET', '/qr-codes/sheet.pdf', admB), rA = await api.call('GET', '/qr-codes/sheet.pdf', admA);
    assert.strictEqual(rB.status, 200); assert.strictEqual(rB.headers['Content-Type'], 'application/pdf');
    assert.ok(rB.buffer.slice(0, 5).toString() === '%PDF-' && rA.buffer.slice(0, 5).toString() === '%PDF-');
    const txtB = rB.buffer.toString('latin1'), txtA = rA.buffer.toString('latin1');
    assert.ok(txtB.includes('Station B ' + sfx) && !txtB.includes('Station A ' + sfx), 'planche B mélangée');
    assert.ok(txtA.includes('Station A ' + sfx) && !txtA.includes('Station B ' + sfx), 'planche A mélangée');
    assert.strictEqual((await events("event = 'print'")).filter(e => Number(e.station_id) === stB).length, 1);
  });
  await t('2d. Étiquette individuelle : PDF A5 (une page) et compteur d’impressions incrémenté', async () => {
    const id = (await q('SELECT id FROM qr_codes WHERE counter_id = $1', [c2])).rows[0].id;
    const before = (await q('SELECT print_count FROM qr_codes WHERE id = $1', [id])).rows[0].print_count;
    const r = await api.call('GET', `/qr-codes/${id}/label.pdf`, admA); assert.strictEqual(r.status, 200); assert.match(r.headers['Content-Disposition'], /qr-code-[0-9A-F]{4}-[0-9A-F]{4}\.pdf/);
    assert.strictEqual((await q('SELECT print_count FROM qr_codes WHERE id = $1', [id])).rows[0].print_count, before + 1);
    assert.ok(r.buffer.slice(0, 5).toString() === '%PDF-' && (r.buffer.toString('latin1').match(/\/Type \/Page /g) || []).length === 1);
  });

  // ---------- 4-5 : scan ----------
  const idOf = async c => (await q(`SELECT id FROM qr_codes WHERE counter_id = $1 AND status = 'active'`, [c])).rows[0].id;
  const tokGas1 = await tokenOf(await idOf(c1));
  await t('4/7. Scan valide : pompe, produit, employé (compte connecté), quart ouvert ; aucune vente créée', async () => {
    const before = (await q('SELECT COUNT(*)::int AS n FROM sales WHERE station_id = $1', [stA])).rows[0].n;
    const r = await scan(p1, tokGas1); assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.can_record_sale, true); assert.strictEqual(r.body.product.name, 'Gasoil'); assert.strictEqual(Number(r.body.employee.id), e1); assert.strictEqual(Number(r.body.counter.id), c1); assert.strictEqual(r.body.shift.status, 'open');
    assert.ok(r.body.scan_id && r.body.expires_at);
    assert.ok(!JSON.stringify(r.body).includes(tokGas1), 'le jeton ne doit pas revenir dans la réponse');
    assert.strictEqual((await q('SELECT COUNT(*)::int AS n FROM sales WHERE station_id = $1', [stA])).rows[0].n, before, 'le scan a créé une vente');
  });
  await t('4b. Saisie manuelle de la référence courte (secours caméra) : même contrôles', async () => {
    const ref = (await q('SELECT short_ref FROM qr_codes WHERE counter_id = $1 AND status = \'active\'', [c1])).rows[0].short_ref;
    const r = await api.call('POST', '/sales/scan-pump', { ...p1, body: { short_ref: ref.toLowerCase().replace('-', ' ') } }); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(Number(r.body.counter.id), c1);
    const bad = await api.call('POST', '/sales/scan-pump', { ...p1, body: { short_ref: 'ZZZZ-0000' } }); assert.strictEqual(codeOf(bad), 'QR_INVALID');
  });
  await t('5. QR inconnu ou texte étranger : refus QR_INVALID, journalisé', async () => {
    const r1 = await scan(p1, L.generateToken()), r2 = await api.call('POST', '/sales/scan-pump', { ...p1, body: { code: 'https://exemple.com/x' } });
    assert.strictEqual(r1.status, 404); assert.strictEqual(codeOf(r1), 'QR_INVALID'); assert.strictEqual(codeOf(r2), 'QR_INVALID');
    assert.ok((await events("event = 'scan_refused' AND reason_code = 'QR_INVALID'")).length >= 2);
  });
  await t('8. Employé non affecté à la pompe (pompe 2 est à un autre employé) : refus EMPLOYEE_NOT_ASSIGNED', async () => {
    const r = await scan(p1, await tokenOf(await idOf(c3))); assert.strictEqual(r.status, 403); assert.strictEqual(codeOf(r), 'EMPLOYEE_NOT_ASSIGNED');
    assert.strictEqual((await scan(p2, await tokenOf(await idOf(c3)))).status, 200);
  });
  await t('8b. Employé absent de l’équipe du quart : EMPLOYEE_NOT_ON_SHIFT ; compte sans employé : EMPLOYEE_NOT_FOUND', async () => {
    assert.strictEqual(codeOf(await scan(p3, tokGas1)), 'EMPLOYEE_NOT_ON_SHIFT');
    const sansEmp = as({ ...gerA, perms: new Set([...gerA.perms, 'sale.create']) }, stA); assert.strictEqual(codeOf(await scan(sansEmp, tokGas1)), 'EMPLOYEE_NOT_FOUND');
  });
  await t('11. Pompe désactivée : PUMP_DISABLED', async () => {
    assert.strictEqual(codeOf(await scan(p1, await tokenOf(await idOf(c4)))), 'PUMP_DISABLED');
  });
  await t('13. QR d’une autre station : STATION_MISMATCH sans aucune donnée d’équipement, journalisé sans identité de l’autre station', async () => {
    const tokB = await tokenOf(await idOf(cB)); const r = await scan(p1, tokB);
    assert.strictEqual(r.status, 403); assert.strictEqual(codeOf(r), 'STATION_MISMATCH'); assert.deepStrictEqual(Object.keys(r.body).sort(), ['details', 'error']);
    const ev = (await events("reason_code = 'STATION_MISMATCH'")).pop(); assert.strictEqual(Number(ev.station_id), stA); assert.strictEqual(ev.qr_code_id, null); assert.strictEqual(ev.pump_id, null);
  });
  await t('12. Compteur sans relevé d’ouverture sur le quart : COUNTER_NOT_READ', async () => {
    const c5 = await ctr(pu2, 2, supA); await api.call('POST', `/pumps/${pu2}/qr-code`, { ...admA, body: { counter_id: c5 } });
    assert.strictEqual(codeOf(await scan(p2, await tokenOf(await idOf(c5)))), 'COUNTER_NOT_READ');
  });

  // ---------- 6/21 : révocation, régénération ----------
  await t('6/21. Révocation : l’ancien QR est inutilisable immédiatement', async () => {
    const id = await idOf(c2), tok = await tokenOf(id);
    assert.strictEqual((await scan(p1, tok)).status, 200);
    const r = await api.call('PATCH', `/qr-codes/${id}/revoke`, { ...admA, body: { reason: 'étiquette abîmée' } }); assert.strictEqual(r.status, 200);
    const s = await scan(p1, tok); assert.strictEqual(s.status, 409); assert.strictEqual(codeOf(s), 'QR_REVOKED');
    assert.strictEqual((await api.call('PATCH', `/qr-codes/${id}/revoke`, { ...admA, body: {} })).status, 409);
  });
  await t('21b. Régénération : ancien « remplacé » inutilisable, nouveau actif, un seul actif par compteur, chaînage replaced_by', async () => {
    const oldId = await idOf(c1), oldTok = await tokenOf(oldId);
    const r = await api.call('POST', `/qr-codes/${oldId}/regenerate`, { ...admA, body: { reason: 'perdu' } }); assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(codeOf(await scan(p1, oldTok)), 'QR_REVOKED');
    const newTok = await tokenOf(r.body.id); assert.notStrictEqual(newTok, oldTok); assert.strictEqual((await scan(p1, newTok)).status, 200);
    const rows = (await q('SELECT status, replaced_by FROM qr_codes WHERE counter_id = $1 ORDER BY id', [c1])).rows;
    assert.deepStrictEqual(rows.map(x => x.status), ['replaced', 'active']); assert.strictEqual(Number(rows[0].replaced_by), Number(r.body.id));
  });

  // ---------- 14-18 : validation de la vente (contrôles refaits) ----------
  const fresh = async (who = p1, c = c1) => { const r = await scan(who, await tokenOf(await idOf(c))); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); return r.body.scan_id; };
  const check = (who, scanId, body) => D.checkScanForSale(pool, { stationId: who.sid, userId: who.user.id, scanId, body });
  await t('7/validation : un scan valide est accepté à la validation, puis consommé une seule fois', async () => {
    const id = await fresh(); const v = await check(p1, id, { counter_id: c1 }); assert.strictEqual(v.verdict.ok, true, JSON.stringify(v.verdict));
    const sale = await ins(`INSERT INTO sales(station_id, shift_id, employee_id, pump_id, total, kind, input_mode, client_ref) VALUES ($1,$2,$3,$4,1000,'carburant','montant',$5)`, [stA, shift, e1, pu1, 'ref-' + sfx]);
    assert.strictEqual(await D.consumeScan(pool, id, sale), true); assert.strictEqual(await D.consumeScan(pool, id, sale), false);
    assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'SCAN_USED');
  });
  await t('14. Valeurs falsifiées côté navigateur (compteur, pompe, employé) : SCAN_MISMATCH', async () => {
    const id = await fresh();
    for (const body of [{ counter_id: c3 }, { counter_id: c1, employee_id: e2 }, { counter_id: c1, pump_id: pu2 }, { counter_id: c1, product_id: supA }]) assert.strictEqual((await check(p1, id, body)).verdict.code, 'SCAN_MISMATCH', JSON.stringify(body));
    assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.ok, true);
  });
  await t('14b. Le scan d’un autre compte ne peut pas être utilisé (identité = session)', async () => {
    const id = await fresh(p1, c1); assert.strictEqual((await check(p2, id, { counter_id: c1 })).verdict.code, 'SCAN_INVALID');
    assert.strictEqual((await check(p1, 99999999, { counter_id: c1 })).verdict.code, 'SCAN_INVALID');
  });
  await t('16. Affectation modifiée après le scan : nouvelle vérification, refus EMPLOYEE_NOT_ASSIGNED', async () => {
    const id = await fresh(); await q('UPDATE shift_employees SET pump_id = $2 WHERE shift_id = $1 AND employee_id = $3', [shift, pu2, e1]);
    try { assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'EMPLOYEE_NOT_ASSIGNED'); } finally { await q('UPDATE shift_employees SET pump_id = $2 WHERE shift_id = $1 AND employee_id = $3', [shift, pu1, e1]); }
    assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.ok, true);
  });
  await t('16b. Employé retiré de l’équipe après le scan : EMPLOYEE_NOT_ON_SHIFT', async () => {
    const id = await fresh(); await q('DELETE FROM shift_employees WHERE shift_id = $1 AND employee_id = $2', [shift, e1]);
    try { assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'EMPLOYEE_NOT_ON_SHIFT'); } finally { await q('INSERT INTO shift_employees(shift_id, employee_id, pump_id) VALUES ($1,$2,$3)', [shift, e1, pu1]); }
  });
  await t('21c. QR révoqué ou pompe désactivée après le scan : refus à la validation', async () => {
    let id = await fresh(); const qid = await idOf(c1);
    await q(`UPDATE qr_codes SET status = 'revoked' WHERE id = $1`, [qid]);
    try { assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'QR_REVOKED'); } finally { await q(`UPDATE qr_codes SET status = 'active' WHERE id = $1`, [qid]); }
    id = await fresh(); await q(`UPDATE pumps SET status = 'maintenance' WHERE id = $1`, [pu1]);
    try { assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'PUMP_DISABLED'); } finally { await q(`UPDATE pumps SET status = 'active' WHERE id = $1`, [pu1]); }
  });
  await t('25. Scan expiré (15 min) : SCAN_EXPIRED', async () => {
    const id = await fresh(); await q(`UPDATE qr_scans SET expires_at = now() - interval '1 minute' WHERE id = $1`, [id]);
    assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'SCAN_EXPIRED');
  });
  await t('15. Double soumission simultanée du même scan (2 transactions) : une seule vente passe', async () => {
    const id = await fresh(); const run = async n => {
      const c = await pool.connect();
      try { await c.query('BEGIN'); const { verdict } = await D.checkScanForSale(c, { stationId: stA, userId: pomp1.id, scanId: id, body: { counter_id: c1 } });
        if (!verdict.ok) { await c.query('ROLLBACK'); return verdict.code; }
        await new Promise(r => setTimeout(r, 400));   // la 2e transaction attend le verrou FOR UPDATE du scan
        const sale = (await c.query(`INSERT INTO sales(station_id, shift_id, employee_id, pump_id, total, kind, input_mode, client_ref) VALUES ($1,$2,$3,$4,500,'carburant','montant',$5) RETURNING id`, [stA, shift, e1, pu1, 'dbl-' + n + sfx])).rows[0].id;
        const okc = await D.consumeScan(c, id, sale); if (!okc) { await c.query('ROLLBACK'); return 'SCAN_USED'; }
        await c.query('COMMIT'); return 'OK';
      } finally { c.release(); }
    };
    const res = await Promise.all([run(1), run(2)]); assert.deepStrictEqual(res.slice().sort(), ['OK', 'SCAN_USED'], JSON.stringify(res));
    assert.strictEqual((await q('SELECT COUNT(*)::int AS n FROM sales WHERE id IN (SELECT consumed_sale_id FROM qr_scans WHERE id = $1)', [id])).rows[0].n, 1);
  });
  await t('17/18. Quart clôturé après le scan : SHIFT_CLOSED ; sans quart ouvert, un nouveau scan est refusé (SHIFT_NOT_OPEN)', async () => {
    const id = await fresh(); await q(`UPDATE shifts SET status = 'ferme' WHERE id = $1`, [shift]);
    try {
      assert.strictEqual((await check(p1, id, { counter_id: c1 })).verdict.code, 'SHIFT_CLOSED');
      const r = await scan(p1, await tokenOf(await idOf(c1))); assert.strictEqual(r.status, 409); assert.strictEqual(codeOf(r), 'SHIFT_NOT_OPEN');
    } finally { await q(`UPDATE shifts SET status = 'ouvert' WHERE id = $1`, [shift]); }
  });

  await t('Vente refusée après un scan : événement sale_refused journalisé, erreur transmise ; demande de confirmation (409 + liste) non journalisée', async () => {
    const id = await fresh(), req = { body: { qr_scan_id: id }, sid: stA, user: pomp1, ip: '127.0.0.1' }; let passed = null;
    await api.mod.saleRefusalLogger(new api.HttpError(409, 'Ce quart est déjà clôturé.', { code: 'SHIFT_CLOSED' }), req, {}, e => { passed = e; });
    assert.strictEqual(passed.details.code, 'SHIFT_CLOSED');
    const ev = (await events(`event = 'sale_refused' AND scan_id = ${id}`)); assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0].reason_code, 'SHIFT_CLOSED'); assert.strictEqual(Number(ev[0].employee_id), e1);
    await api.mod.saleRefusalLogger(new api.HttpError(409, 'Avertissements', ['Index inhabituel']), req, {}, () => {});
    await api.mod.saleRefusalLogger(new Error('panne'), { ...req, body: {} }, {}, () => {});
    assert.strictEqual((await events(`event = 'sale_refused' AND scan_id = ${id}`)).length, 1);
  });

  // ---------- Journal ----------
  await t('Journal : ajout seul (modification et suppression refusées par la base)', async () => {
    await assert.rejects(() => q(`UPDATE qr_events SET result = 'ok' WHERE id = (SELECT min(id) FROM qr_events)`), /ajout seul/);
    await assert.rejects(() => q(`DELETE FROM qr_events WHERE id = (SELECT min(id) FROM qr_events)`), /ajout seul/);
  });
  await t('Journal : aucun jeton complet n’est enregistré, seulement la référence courte', async () => {
    const toks = (await q('SELECT token FROM qr_codes WHERE station_id IN ($1,$2)', [stA, stB])).rows.map(r => r.token);
    const evs = (await q('SELECT row_to_json(e)::text AS j FROM qr_events e WHERE station_id IN ($1,$2)', [stA, stB])).rows.map(r => r.j);
    assert.ok(evs.length > 20); for (const tk of toks) assert.ok(!evs.some(j => j.includes(tk)), 'jeton en clair dans le journal');
  });
  await t('Journal : générations, révocations, régénérations, impressions, scans OK et refus présents ; historique limité à la station', async () => {
    const kinds = new Set((await events(`station_id = ${stA}`)).map(e => e.event + ':' + e.result));
    for (const k of ['generate:ok', 'revoke:ok', 'regenerate:ok', 'print:ok', 'scan_ok:ok', 'scan_refused:refused']) assert.ok(kinds.has(k), 'manque ' + k);
    const h = await api.call('GET', '/qr-codes/history?limit=500', admA); assert.strictEqual(h.status, 200);
    assert.ok(h.body.length > 10 && h.body.every(e => e.id)); const hB = await api.call('GET', '/qr-codes/history', admB);
    assert.ok(hB.body.every(e => e.event === 'generate' || e.event === 'print'), 'la station B voit des événements de A');
    assert.ok(h.body.some(e => e.reason_code === 'STATION_MISMATCH') && !hB.body.some(e => e.reason_code === 'STATION_MISMATCH'));
  });
  await t('Migration : permission qr.manage accordée à ADMIN et GERANT, absente des rôles d’exploitation', async () => {
    for (const r of ['ADMIN', 'GERANT']) assert.ok((await permsOf(r)).has('qr.manage'), r);
    for (const r of ['POMPISTE', 'CAISSIER', 'COMPTABLE', 'MAGASINIER']) assert.ok(!(await permsOf(r)).has('qr.manage'), r);
  });

  console.log(`\n${ok}/${ok + ko} contrôles réussis.` + (ko ? ' ÉCHECS : ' + failures.join(' | ') : ''));
  await pool.end(); process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR FATALE', e); process.exit(2); });
