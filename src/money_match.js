'use strict';
/** Rapprochement ligne à ligne des relevés Mobile Money / banque avec les mouvements comptables.
 *  - POST /money/statement-lines/import      : colle un relevé (texte) ou envoie des lignes ; doublons ignorés ; rapprochement auto
 *  - GET  /money/reconcile-lines?account_id  : lignes, mouvements non rapprochés, synthèse d'écarts
 *  - POST /money/statement-lines/:id/match   : rapprochement manuel d'une ligne avec un mouvement
 *  - POST /money/statement-lines/:id/unmatch : annule un rapprochement
 *  - POST /money/statement-lines/:id/ignore  : ignore une ligne (motif obligatoire)
 *  Aucune écriture comptable : le rapprochement ne crée ni ne modifie de mouvement. */
const express = require('express');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, need, audit } = require('./core');
const { matchLines, lineHash, parseStatementText, fl2 } = require('./money_match_logic');

const r = express.Router();
const VIEW = ['money.manage', 'finance.view', 'finance.report'];
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function account(db, sid, id) {
  const { rows: [a] } = await db.query('SELECT id, name, kind FROM money_accounts WHERE id=$1 AND station_id=$2', [id, sid]);
  if (!a) throw new HttpError(404, 'Compte introuvable');
  return a;
}

// Rapproche automatiquement les lignes « à rapprocher » d'un compte avec ses mouvements libres. Retourne le nombre de rapprochements.
async function autoMatch(db, sid, accountId) {
  const { rows: lines } = await db.query(
    `SELECT id, to_char(line_date,'YYYY-MM-DD') AS line_date, amount, reference FROM money_statement_lines
      WHERE station_id=$1 AND account_id=$2 AND status='a_rapprocher' ORDER BY line_date, id FOR UPDATE`, [sid, accountId]);
  if (!lines.length) return 0;
  const { rows: mv } = await db.query(
    `SELECT m.id, to_char(m.moved_on,'YYYY-MM-DD') AS moved_on, m.amount, m.reference FROM money_movements m
      WHERE m.station_id=$1 AND m.account_id=$2
        AND NOT EXISTS (SELECT 1 FROM money_statement_lines l WHERE l.movement_id = m.id)`, [sid, accountId]);
  const res = matchLines(lines.map(l => ({ ...l, amount: Number(l.amount) })), mv.map(m => ({ ...m, amount: Number(m.amount) })));
  for (const m of res.matches)
    await db.query(`UPDATE money_statement_lines SET status='rapprochee_auto', movement_id=$2 WHERE id=$1 AND station_id=$3`, [m.line_id, m.movement_id, sid]);
  return res.matches.length;
}

r.post('/money/statement-lines/import', need('money.manage'), body(z.object({
  account_id: z.number().int().positive(),
  text: z.string().max(400000).optional(),
  lines: z.array(z.object({ line_date: ymd, amount: z.number().refine(v => v !== 0, 'Montant nul'), reference: z.string().max(120).nullable().optional(), label: z.string().max(200).nullable().optional() })).max(2000).optional()
}).refine(b => b.text || (b.lines && b.lines.length), { message: 'Fournissez le relevé (text) ou des lignes' })), wrap(async (req, res) => {
  const b = req.body;
  const parsed = b.text ? parseStatementText(b.text) : { lines: [], errors: [] };
  const all = [...parsed.lines, ...(b.lines || []).map(l => ({ line_date: l.line_date, amount: fl2(l.amount), reference: l.reference || null, label: l.label || null }))];
  if (all.length > 2000) throw new HttpError(400, 'Maximum 2000 lignes par import');
  if (!all.length) throw new HttpError(400, 'Aucune ligne valide', { errors: parsed.errors });
  const out = await tx(async db => {
    await account(db, req.sid, b.account_id);
    let inserted = 0, duplicates = 0;
    const seen = new Map();   // deux lignes identiques dans le même relevé sont légitimes (ex. 2 paiements de 5 000 le même jour) : suffixe d'ordre
    for (const l of all) {
      const base = lineHash(l); const k = (seen.get(base) || 0) + 1; seen.set(base, k);
      const { rowCount } = await db.query(
        `INSERT INTO money_statement_lines(station_id, account_id, line_date, amount, reference, label, line_hash, created_by)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8) ON CONFLICT (account_id, line_hash) DO NOTHING`,
        [req.sid, b.account_id, l.line_date, l.amount, l.reference || null, l.label || null, base + '#' + k, req.user.id]);
      if (rowCount) inserted++; else duplicates++;
    }
    const matched = await autoMatch(db, req.sid, b.account_id);
    await audit(db, req, 'finance', `Import de ${inserted} ligne(s) de relevé, ${matched} rapprochée(s)`, 'money_accounts', b.account_id, null, { inserted, duplicates, matched });
    return { inserted, duplicates, matched, rejected: parsed.errors };
  });
  res.status(201).json(out);
}));

r.get('/money/reconcile-lines', need(...VIEW), wrap(async (req, res) => {
  const accountId = Number(req.query.account_id);
  if (!Number.isInteger(accountId) || accountId <= 0) throw new HttpError(400, 'account_id requis');
  const a = await account(pool, req.sid, accountId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
  const [{ rows: lines }, { rows: moves }, { rows: [tot] }] = await Promise.all([
    pool.query(
      `SELECT l.id, to_char(l.line_date,'YYYY-MM-DD') AS line_date, l.amount, l.reference, l.label, l.status, l.movement_id, l.note
         FROM money_statement_lines l WHERE l.station_id=$1 AND l.account_id=$2
          AND ($3::date IS NULL OR l.line_date >= $3::date) AND ($4::date IS NULL OR l.line_date <= $4::date)
        ORDER BY l.line_date DESC, l.id DESC LIMIT 1000`, [req.sid, accountId, from, to]),
    pool.query(
      `SELECT m.id, to_char(m.moved_on,'YYYY-MM-DD') AS moved_on, m.kind, m.amount, m.label, m.reference FROM money_movements m
        WHERE m.station_id=$1 AND m.account_id=$2 AND NOT EXISTS (SELECT 1 FROM money_statement_lines l WHERE l.movement_id = m.id)
          AND ($3::date IS NULL OR m.moved_on >= $3::date) AND ($4::date IS NULL OR m.moved_on <= $4::date)
        ORDER BY m.moved_on DESC, m.id DESC LIMIT 1000`, [req.sid, accountId, from, to]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='a_rapprocher')::int AS pending,
              COALESCE(SUM(amount) FILTER (WHERE status='a_rapprocher'),0) AS pending_amount,
              COUNT(*) FILTER (WHERE status LIKE 'rapprochee%')::int AS matched,
              COUNT(*) FILTER (WHERE status='ignoree')::int AS ignored
         FROM money_statement_lines WHERE station_id=$1 AND account_id=$2`, [req.sid, accountId])
  ]);
  res.json({
    account: a, lines,
    unmatched_movements: moves,   // écrits chez nous mais absents du relevé : à vérifier auprès de l'opérateur
    summary: { pending_lines: tot.pending, pending_amount: fl2(tot.pending_amount), matched_lines: tot.matched, ignored_lines: tot.ignored,
      unmatched_movements: moves.length, unmatched_movements_amount: fl2(moves.reduce((s, m) => s + Number(m.amount), 0)) }
  });
}));

r.post('/money/statement-lines/:id/match', need('money.manage'), body(z.object({ movement_id: z.number().int().positive() })), wrap(async (req, res) => {
  const out = await tx(async db => {
    const { rows: [l] } = await db.query('SELECT * FROM money_statement_lines WHERE id=$1 AND station_id=$2 FOR UPDATE', [req.params.id, req.sid]);
    if (!l) throw new HttpError(404, 'Ligne introuvable');
    if (l.status !== 'a_rapprocher') throw new HttpError(409, 'Cette ligne est déjà traitée');
    const { rows: [m] } = await db.query('SELECT id, amount FROM money_movements WHERE id=$1 AND station_id=$2 AND account_id=$3 FOR UPDATE', [req.body.movement_id, req.sid, l.account_id]);
    if (!m) throw new HttpError(404, 'Mouvement introuvable sur ce compte');
    if (fl2(m.amount) !== fl2(l.amount)) throw new HttpError(409, `Montants différents : relevé ${l.amount}, comptabilité ${m.amount}. Corrigez d'abord l'écriture ou ignorez la ligne avec un motif.`);
    const { rows: [used] } = await db.query('SELECT id FROM money_statement_lines WHERE movement_id=$1', [m.id]);
    if (used) throw new HttpError(409, 'Ce mouvement est déjà rapproché avec une autre ligne');
    await db.query(`UPDATE money_statement_lines SET status='rapprochee_manuelle', movement_id=$2 WHERE id=$1 AND station_id=$3`, [l.id, m.id, req.sid]);
    await audit(db, req, 'finance', `Rapprochement manuel ligne ${l.id} ↔ mouvement ${m.id}`, 'money_statement_lines', l.id, null, req.body);
    return { ok: true, line_id: l.id, movement_id: m.id };
  });
  res.json(out);
}));

r.post('/money/statement-lines/:id/unmatch', need('money.manage'), wrap(async (req, res) => {
  const out = await tx(async db => {
    const { rows: [l] } = await db.query('SELECT * FROM money_statement_lines WHERE id=$1 AND station_id=$2 FOR UPDATE', [req.params.id, req.sid]);
    if (!l) throw new HttpError(404, 'Ligne introuvable');
    if (l.status === 'a_rapprocher') throw new HttpError(409, 'Cette ligne n’est pas rapprochée');
    await db.query(`UPDATE money_statement_lines SET status='a_rapprocher', movement_id=NULL, note=NULL WHERE id=$1 AND station_id=$2`, [l.id, req.sid]);
    await audit(db, req, 'finance', `Rapprochement annulé, ligne ${l.id}`, 'money_statement_lines', l.id, { statut: l.status, mouvement: l.movement_id }, { statut: 'a_rapprocher' });
    return { ok: true };
  });
  res.json(out);
}));

r.post('/money/statement-lines/:id/ignore', need('money.manage'), body(z.object({ reason: z.string().trim().min(3, 'Motif obligatoire (3 caractères minimum)').max(300) })), wrap(async (req, res) => {
  const out = await tx(async db => {
    const { rows: [l] } = await db.query('SELECT * FROM money_statement_lines WHERE id=$1 AND station_id=$2 FOR UPDATE', [req.params.id, req.sid]);
    if (!l) throw new HttpError(404, 'Ligne introuvable');
    if (l.status !== 'a_rapprocher') throw new HttpError(409, 'Cette ligne est déjà traitée');
    await db.query(`UPDATE money_statement_lines SET status='ignoree', note=$2 WHERE id=$1 AND station_id=$3`, [l.id, req.body.reason, req.sid]);
    await audit(db, req, 'finance', `Ligne de relevé ${l.id} ignorée : ${req.body.reason}`, 'money_statement_lines', l.id, null, req.body);
    return { ok: true };
  });
  res.json(out);
}));

module.exports = { r, autoMatch };
