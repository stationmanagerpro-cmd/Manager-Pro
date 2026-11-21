// Scan QR des pompes : gestion des QR Codes (administration), PDF d'étiquettes, journal, et vérification d'un scan.
// Le QR identifie un COMPTEUR (point de distribution = pompe + produit). Le compte connecté identifie l'employé.
// Les règles (affectation, quart) sont celles de /sales/fuel : voir qr_logic.js. La vente reste enregistrée par POST /sales/fuel (fuelsales.js).
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need } = require('./core');
const L = require('./qr_logic');
const { swallow } = require('./safe');
const D = require('./qr_db');
const { sheetPdf, singlePdf } = require('./qr_pdf');
const r = express.Router();

const reqIp = req => (req.ip || '').slice(0, 64);
const fullName = e => [e.first_name, e.last_name].filter(Boolean).join(' ').trim();

/** Journal du scan (ajout seul). Ne contient jamais le jeton complet : uniquement la référence courte. */
async function logEvent(db, req, ev) {
  try { await D.insertEvent(db, { ...ev, station_id: req.sid || null, user_id: req.user?.id || null, ip_address: reqIp(req) }); }
  catch (e) {
    // Hors transaction : on trace côté serveur sans masquer la réponse. Dans une transaction de vente/administration, l'échec annule l'opération (journal obligatoire).
    console.error('[qr_events] écriture impossible :', e.message);
    if (db !== pool) throw e;
  }
}
const loadContext = D.loadContext;

const refusal = (res) => new HttpError(res.status || 409, res.message, { code: res.code });

// ---------------------------------------------------------------- Administration
const adminOnly = need('qr.manage');

/** Liste des points de distribution de la station avec l'état de leur QR Code. */
r.get('/qr-codes', adminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT pc.id AS counter_id, pc.counter_number, pu.id AS pump_id, pu.number AS pump_number, pu.name AS pump_name, pu.status AS pump_status,
            pr.name AS product, q.id AS qr_id, q.status AS qr_status, q.short_ref, q.created_at AS qr_created_at, q.print_count, q.last_printed_at,
            (SELECT COUNT(*)::int FROM qr_codes o WHERE o.counter_id = pc.id AND o.status <> 'active') AS previous_codes
       FROM pump_counters pc
       JOIN pumps pu ON pu.id = pc.pump_id AND pu.station_id = $1 AND pu.deleted_at IS NULL
       JOIN products pr ON pr.id = pc.product_id
       LEFT JOIN qr_codes q ON q.counter_id = pc.id AND q.status = 'active'
      ORDER BY pu.number, pc.counter_number`, [req.sid]);
  res.json({ items: rows, totals: { counters: rows.length, with_qr: rows.filter(x => x.qr_id).length, without_qr: rows.filter(x => !x.qr_id).length } });
}));

/** Crée un QR actif pour chaque compteur de la liste qui n'en a pas (jamais de doublon actif : index unique partiel). */
async function generateFor(c, req, counterRows) {
  const created = [];
  for (const k of counterRows) {
    const { rows: ex } = await c.query(`SELECT id FROM qr_codes WHERE counter_id = $1 AND status = 'active' FOR UPDATE`, [k.counter_id]);
    if (ex.length) continue;
    const token = L.generateToken(), ref = L.shortRef(token);
    const { rows: [q] } = await c.query(
      `INSERT INTO qr_codes(station_id, pump_id, counter_id, token, short_ref, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, short_ref, counter_id, pump_id`,
      [req.sid, k.pump_id, k.counter_id, token, ref, req.user.id]);
    await logEvent(c, req, { event: 'generate', qr_code_id: q.id, short_ref: ref, pump_id: k.pump_id, counter_id: k.counter_id, product_id: k.product_id });
    created.push(q);
  }
  return created;
}
const stationCounters = (c, sid, pumpId = null, counterId = null) => c.query(
  `SELECT pc.id AS counter_id, pc.pump_id, pc.product_id FROM pump_counters pc JOIN pumps pu ON pu.id = pc.pump_id
    WHERE pu.station_id = $1 AND pu.deleted_at IS NULL AND ($2::bigint IS NULL OR pu.id = $2) AND ($3::bigint IS NULL OR pc.id = $3) ORDER BY pu.number, pc.counter_number`, [sid, pumpId, counterId]).then(x => x.rows);

r.post('/pumps/:pumpId/qr-code', adminOnly, body(z.object({ counter_id: z.number().int().positive().optional() })), wrap(async (req, res) => {
  const pumpId = parseInt(req.params.pumpId, 10);
  const out = await tx(async c => {
    const list = await stationCounters(c, req.sid, pumpId, req.body.counter_id || null);
    if (!list.length) throw new HttpError(404, 'Pompe ou compteur introuvable dans cette station.');
    return { created: await generateFor(c, req, list), requested: list.length };
  });
  res.status(out.created.length ? 201 : 200).json({ success: true, ...out, message: out.created.length ? out.created.length + ' QR Code(s) généré(s).' : 'Cette pompe a déjà un QR Code actif pour chaque compteur.' });
}));

r.post('/qr-codes/bulk', adminOnly, wrap(async (req, res) => {
  const out = await tx(async c => { const list = await stationCounters(c, req.sid); return { created: await generateFor(c, req, list), requested: list.length }; });
  res.status(out.created.length ? 201 : 200).json({ success: true, ...out, message: out.created.length + ' QR Code(s) généré(s) sur ' + out.requested + ' point(s) de distribution.' });
}));

const loadOwn = async (c, req, id) => {
  const { rows: [q] } = await c.query('SELECT * FROM qr_codes WHERE id = $1 AND station_id = $2 FOR UPDATE', [id, req.sid]);
  if (!q) throw new HttpError(404, 'QR Code introuvable.');
  return q;
};

r.patch('/qr-codes/:id/revoke', adminOnly, body(z.object({ reason: z.string().trim().max(300).optional() })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const q = await loadOwn(c, req, parseInt(req.params.id, 10));
    if (q.status !== 'active') throw new HttpError(409, 'Ce QR Code n’est pas actif.');
    await c.query(`UPDATE qr_codes SET status = 'revoked', revoked_at = now(), revoked_by = $2, revoke_reason = $3, updated_at = now() WHERE id = $1`, [q.id, req.user.id, req.body.reason || null]);
    await logEvent(c, req, { event: 'revoke', qr_code_id: q.id, short_ref: q.short_ref, pump_id: q.pump_id, counter_id: q.counter_id, detail: { reason: req.body.reason || null } });
    return { id: q.id };
  });
  res.json({ success: true, ...out, message: 'QR Code désactivé : il est immédiatement inutilisable.' });
}));

r.post('/qr-codes/:id/regenerate', adminOnly, body(z.object({ reason: z.string().trim().max(300).optional() })), wrap(async (req, res) => {
  const out = await tx(async c => {
    const old = await loadOwn(c, req, parseInt(req.params.id, 10));
    if (old.status !== 'active') throw new HttpError(409, 'Seul un QR Code actif peut être régénéré.');
    const { rows: [k] } = await c.query('SELECT product_id FROM pump_counters WHERE id = $1', [old.counter_id]);
    // L'ancien est révoqué AVANT l'insertion du nouveau (index unique : un seul actif par compteur), dans la même transaction.
    await c.query(`UPDATE qr_codes SET status = 'replaced', revoked_at = now(), revoked_by = $2, revoke_reason = $3, updated_at = now() WHERE id = $1`, [old.id, req.user.id, req.body.reason || 'régénéré']);
    const token = L.generateToken(), ref = L.shortRef(token);
    const { rows: [nq] } = await c.query(`INSERT INTO qr_codes(station_id, pump_id, counter_id, token, short_ref, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, short_ref`, [req.sid, old.pump_id, old.counter_id, token, ref, req.user.id]);
    await c.query('UPDATE qr_codes SET replaced_by = $2 WHERE id = $1', [old.id, nq.id]);
    await logEvent(c, req, { event: 'regenerate', qr_code_id: nq.id, short_ref: ref, pump_id: old.pump_id, counter_id: old.counter_id, product_id: k?.product_id, detail: { replaces: old.short_ref, reason: req.body.reason || null } });
    return { id: nq.id, short_ref: ref, replaced: old.short_ref };
  });
  res.status(201).json({ success: true, ...out, message: 'Nouveau QR Code généré ; l’ancien (' + out.replaced + ') est désormais inutilisable. Imprimez la nouvelle étiquette.' });
}));

// ---------------------------------------------------------------- PDF
async function labelsFor(c, sid, ids) {
  const { rows } = await c.query(
    `SELECT q.id, q.token, q.short_ref, pu.number AS pump_number, pu.name AS pump_name, pc.counter_number, pr.name AS product, st.name AS station_name,
            (SELECT COUNT(*) FROM pump_counters x WHERE x.pump_id = pu.id)::int AS n_counters
       FROM qr_codes q JOIN pumps pu ON pu.id = q.pump_id JOIN pump_counters pc ON pc.id = q.counter_id JOIN products pr ON pr.id = pc.product_id JOIN stations st ON st.id = q.station_id
      WHERE q.station_id = $1 AND q.status = 'active' AND pu.deleted_at IS NULL AND ($2::bigint[] IS NULL OR q.id = ANY($2::bigint[]))
      ORDER BY pu.number, pc.counter_number`, [sid, ids]);
  return rows.map(x => ({ id: x.id, payload: L.payloadOf(x.token), shortRef: x.short_ref, stationName: x.station_name,
    pumpLabel: 'Pompe ' + String(x.pump_number).padStart(2, '0') + (x.n_counters > 1 ? ' · Compteur ' + x.counter_number : ''), productName: x.product }));
}
async function markPrinted(c, req, labels, kind) {
  if (!labels.length) return;
  await c.query('UPDATE qr_codes SET print_count = print_count + 1, last_printed_at = now() WHERE id = ANY($1::bigint[]) AND station_id = $2', [labels.map(l => l.id), req.sid]);
  await logEvent(c, req, { event: 'print', qr_code_id: labels.length === 1 ? labels[0].id : null, short_ref: labels.length === 1 ? labels[0].shortRef : null, detail: { kind, count: labels.length } });
}
const sendPdf = (res, buf, name) => { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.setHeader('Cache-Control', 'no-store'); res.send(buf); };

// IMPORTANT : /qr-codes/sheet.pdf et /qr-codes/history AVANT les routes /qr-codes/:id/...
r.get('/qr-codes/sheet.pdf', adminOnly, wrap(async (req, res) => {
  const ids = req.query.ids ? String(req.query.ids).split(',').map(x => parseInt(x, 10)).filter(Number.isInteger) : null;
  const { labels, station } = await tx(async c => {
    const labels = await labelsFor(c, req.sid, ids && ids.length ? ids : null);
    if (!labels.length) throw new HttpError(404, 'Aucun QR Code actif à imprimer : générez-les d’abord.');
    await markPrinted(c, req, labels, 'sheet');
    return { labels, station: labels[0].stationName };
  });
  sendPdf(res, sheetPdf(labels, { stationName: station }), 'qr-codes-pompes.pdf');
}));

r.get('/qr-codes/history', adminOnly, wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const ev = /^[a-z_]{3,20}$/.test(String(req.query.event || '')) ? String(req.query.event) : null;
  const { rows } = await pool.query(
    `SELECT e.id, e.at, e.event, e.result, e.reason_code, e.short_ref, e.pump_id, pu.number AS pump_number, e.counter_id, e.shift_id, e.sale_id, e.detail,
            COALESCE(NULLIF(TRIM(COALESCE(u.full_name, '')), ''), u.login) AS user_name, TRIM(COALESCE(em.first_name,'') || ' ' || COALESCE(em.last_name,'')) AS employee
       FROM qr_events e LEFT JOIN users u ON u.id = e.user_id LEFT JOIN employees em ON em.id = e.employee_id LEFT JOIN pumps pu ON pu.id = e.pump_id
      WHERE e.station_id = $1 AND ($2::text IS NULL OR e.event = $2) ORDER BY e.id DESC LIMIT $3`, [req.sid, ev, limit]);
  res.json(rows);
}));

r.get('/qr-codes/:id/label.pdf', adminOnly, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const label = await tx(async c => {
    const labels = await labelsFor(c, req.sid, [id]);
    if (!labels.length) throw new HttpError(404, 'QR Code actif introuvable.');
    await markPrinted(c, req, labels, 'single');
    return labels[0];
  });
  sendPdf(res, singlePdf(label), 'qr-code-' + label.shortRef + '.pdf');
}));

// ---------------------------------------------------------------- Scan (pompiste)
/**
 * Vérifie un scan : contrôles serveur complets puis ouverture d'une « session de scan » qui PRÉPARE une vente (aucune vente créée).
 * L'employé vient de la session authentifiée ; aucun identifiant d'employé n'est lu dans la requête.
 */
r.post('/sales/scan-pump', need('sale.create'), body(z.object({ code: z.string().trim().max(200).optional(), short_ref: z.string().trim().max(20).optional() }).refine(b => b.code || b.short_ref, 'code ou short_ref requis')), wrap(async (req, res) => {
  const token = req.body.code ? L.parsePayload(req.body.code) : null;
  const ref = !token && req.body.short_ref ? L.normalizeShortRef(req.body.short_ref) : null;
  const qr = await D.findQr(pool, { token, shortRef: ref, stationId: req.sid });
  const ctx = await D.loadContext(pool, { stationId: req.sid, userId: req.user.id, qr });
  // Vente au nom d'un employé : seulement si l'utilisateur a la permission ET n'est pas lui-même responsable de la pompe.
  // L'employé visé est alors le responsable unique affecté à la pompe sur le quart (jamais un choix du navigateur).
  const target = L.delegateTarget(ctx, req.user.perms.has('sale.record_for_employee'));
  let verdict;
  if (target && !target.ok) verdict = target;
  else {
    if (target) { ctx.employee = await D.loadEmployee(pool, { stationId: req.sid, employeeId: target.employee_id }); ctx.delegatedBy = req.user.id; }
    verdict = L.evaluateCheckpoint(ctx);   // employé sans compte lié : vente autorisée, alerte e-mail seulement
  }
  const own = qr && Number(qr.station_id) === Number(req.sid);   // aucune donnée d'une autre station n'est journalisée sous cette station
  if (!verdict.ok) {
    await logEvent(pool, req, { event: 'scan_refused', result: 'refused', reason_code: verdict.code, qr_code_id: own ? qr.id : null, short_ref: own ? qr.short_ref : null,
      pump_id: own ? qr.pump_id : null, counter_id: own ? qr.counter_id : null, shift_id: ctx.shift?.id, employee_id: ctx.employee?.id });
    throw refusal(verdict);
  }
  const scan = await tx(async c => {
    const s = await D.openScan(c, { qr, ctx, userId: req.user.id, delegated: !!ctx.delegatedBy });
    await logEvent(c, req, { event: 'scan_ok', qr_code_id: qr.id, short_ref: qr.short_ref, pump_id: ctx.pump.id, counter_id: ctx.counter.id, product_id: ctx.product.id, shift_id: ctx.shift.id, employee_id: ctx.employee.id, scan_id: s.id, detail: ctx.delegatedBy ? { delegated_by_user_id: ctx.delegatedBy } : null });
    return s;
  });
  // Réponse minimale : uniquement ce dont l'interface a besoin pour préremplir le formulaire.
  res.json({ success: true, message: 'Pompe identifiée avec succès', scan_id: scan.id, scanned_at: scan.scanned_at, expires_at: scan.expires_at,
    pump: { id: ctx.pump.id, number: ctx.pump.number, name: ctx.pump.name },
    counter: { id: ctx.counter.id, counter_number: ctx.counter.counter_number },
    product: { id: ctx.product.id, name: ctx.product.name },
    employee: { id: ctx.employee.id, name: fullName(ctx.employee) },
    delegated: !!ctx.delegatedBy,
    shift: { id: ctx.shift.id, number: ctx.shift.number, status: 'open' },
    can_record_sale: true });
}));

/** Journalise le refus d'une vente par scan (appelé hors transaction). */
async function logSaleRefused(req, scanId, err) {
  const { rows: [s] } = await pool.query('SELECT qs.*, q.short_ref FROM qr_scans qs JOIN qr_codes q ON q.id = qs.qr_code_id WHERE qs.id = $1 AND qs.station_id = $2', [scanId, req.sid]).catch(swallow('qr:logSaleRefused-scan', { rows: [] }));
  await logEvent(pool, req, { event: 'sale_refused', result: 'refused', reason_code: err.details?.code || 'SALE_REFUSED', qr_code_id: s?.qr_code_id, short_ref: s?.short_ref, pump_id: s?.pump_id,
    counter_id: s?.counter_id, product_id: s?.product_id, shift_id: s?.shift_id, employee_id: s?.employee_id, scan_id: s?.id || null, detail: { message: String(err.message).slice(0, 200) } });
}

module.exports = r;
module.exports.logSaleRefused = logSaleRefused;
module.exports.logEvent = logEvent;
module.exports.refusal = refusal;
/** Intergiciel d'erreur de /sales/fuel : trace le refus d'une vente par scan (hors transaction) puis laisse l'erreur continuer. La demande de confirmation
 *  (409 + liste d'avertissements) n'est pas un refus. Une panne du journal ne masque jamais l'erreur d'origine. */
module.exports.saleRefusalLogger = async function saleRefusalLogger(err, req, res, next) {
  try {
    const id = req.body && req.body.qr_scan_id;
    if (id && err instanceof HttpError && !(err.status === 409 && Array.isArray(err.details))) await logSaleRefused(req, id, err);
  } catch (e) { console.warn('[qr] journal du refus de vente indisponible :', e && e.message); }
  next(err);
};
