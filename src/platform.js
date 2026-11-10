// Finance et rapports de la PLATEFORME (Superadmin) : licences, abonnements clients, dépenses du projet.
// Strictement séparé de la finance des stations : aucune table de station (ventes, caisse, stocks...) n'est lue ici.
const express = require('express');
const { swallow, ignored } = require('./safe');
const { z } = require('zod');
const { pool, tx, HttpError, wrap, body, audit } = require('./core');

const r = express.Router();

const needPrincipal = (req, res, next) =>
  req.user && req.user.is_global ? next() : next(new HttpError(403, 'Réservé à l\'Administrateur Principal'));

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ');
const MONEY = z.number().positive().max(1e12);
const CATEGORIES = ['hebergement', 'base_de_donnees', 'stockage', 'domaine', 'licences_logicielles', 'api_paiement', 'maintenance', 'developpement', 'support', 'communication', 'autre'];
const KINDS = ['licence', 'abonnement', 'mise_en_service', 'autre'];
const DEFAULT_REPORT_COLORS = { primary: '#0A6B5C', secondary: '#E8F3F0', text: '#111827' };
const platformReportColorsSchema = z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/), text: z.string().regex(/^#[0-9a-fA-F]{6}$/) }).strict();
async function getPlatformReportColors() {
  const { rows: [row] } = await pool.query('SELECT colors FROM platform_report_preferences WHERE singleton = TRUE');
  const parsed = platformReportColorsSchema.safeParse(row?.colors || DEFAULT_REPORT_COLORS);
  return parsed.success ? parsed.data : DEFAULT_REPORT_COLORS;
}

const { payState } = require('./platform_utils');

const invoiceSql = `
  SELECT i.id, i.client_id, c.name AS client_name, i.kind, i.label, i.amount, i.currency, i.issued_on, i.due_on,
         i.period_start, i.period_end, i.reference, i.notes, i.status,
         COALESCE((SELECT SUM(p.amount) FROM platform_invoice_payments p WHERE p.invoice_id = i.id), 0) AS paid
    FROM platform_invoices i LEFT JOIN clients c ON c.id = i.client_id`;
const expenseSql = `
  SELECT e.id, e.category, e.label, e.supplier, e.amount, e.currency, e.expense_date, e.due_on, e.reference, e.notes, e.status,
         COALESCE((SELECT SUM(p.amount) FROM platform_expense_payments p WHERE p.expense_id = e.id), 0) AS paid
    FROM platform_expenses e`;
const withState = (x, extra = {}) => ({ ...x, balance: Math.round((x.amount - x.paid) * 100) / 100, pay_state: payState({ amount: x.amount, paid: x.paid, due_on: x.due_on, cancelled: x.status === 'annulee' }), ...extra });

function period(q) {
  const from = DATE.safeParse(q.from).success ? q.from : '1970-01-01';
  const to = DATE.safeParse(q.to).success ? q.to : '2999-12-31';
  return [from, to];
}

// ---------- Apparence des rapports de la plateforme (indépendante des clients) ----------
r.get('/admin/platform/report-colors', needPrincipal, wrap(async (req, res) => {
  res.json(await getPlatformReportColors());
}));
r.put('/admin/platform/report-colors', needPrincipal, body(z.object({ colors: platformReportColorsSchema }).strict()), wrap(async (req, res) => {
  const colors = req.body.colors;
  const { rows: [old] } = await pool.query('SELECT colors FROM platform_report_preferences WHERE singleton = TRUE');
  await pool.query(`INSERT INTO platform_report_preferences(singleton, colors, updated_by, updated_at)
    VALUES (TRUE, $1::jsonb, $2, now())
    ON CONFLICT (singleton) DO UPDATE SET colors=EXCLUDED.colors, updated_by=EXCLUDED.updated_by, updated_at=now()`, [JSON.stringify(colors), req.user.id]);
  await audit(pool, req, 'platform', 'Couleurs des rapports de plateforme modifiées', 'platform_report_preferences', 1, old?.colors || DEFAULT_REPORT_COLORS, colors);
  res.json({ ok: true, colors });
}));

// ---------- Carte des clients : positions GPS des stations + comptes utilisateurs actifs ----------
// Données d'identification et de localisation uniquement (aucune table métier de station : ventes, caisse, stocks...).
// « Connecté » = au moins une session ouverte (non révoquée et non expirée).
r.get('/admin/platform/clients-map', needPrincipal, wrap(async (req, res) => {
  const accounts = `
    WITH live AS (
      SELECT DISTINCT user_id FROM user_sessions WHERE revoked_at IS NULL AND expires_at > now()
    ), acc AS (
      SELECT u.id, u.login, u.full_name, u.client_id, r.label AS role_label, u.last_login_at,
             (l.user_id IS NOT NULL) AS online
        FROM users u
        JOIN roles r ON r.id = u.role_id
        LEFT JOIN live l ON l.user_id = u.id
       WHERE u.active = TRUE AND u.deleted_at IS NULL AND COALESCE(u.is_global, FALSE) = FALSE AND u.client_id IS NOT NULL
    )`;
  const [st, cl, us] = await Promise.all([
    pool.query(`${accounts}
      SELECT s.id, s.name, s.address, s.phone, s.latitude::float AS latitude, s.longitude::float AS longitude,
             s.client_id, c.name AS client_name,
             (SELECT count(DISTINCT a.id)::int FROM user_stations us JOIN acc a ON a.id = us.user_id WHERE us.station_id = s.id) AS active_users,
             (SELECT count(DISTINCT a.id)::int FROM user_stations us JOIN acc a ON a.id = us.user_id WHERE us.station_id = s.id AND a.online) AS online_users
        FROM stations s LEFT JOIN clients c ON c.id = s.client_id
       WHERE s.active = TRUE
       ORDER BY c.name NULLS LAST, s.name, s.id`),
    pool.query(`${accounts}
      SELECT c.id, c.name, c.status,
             (SELECT count(*)::int FROM stations s WHERE s.client_id = c.id AND s.active = TRUE) AS stations,
             (SELECT count(*)::int FROM stations s WHERE s.client_id = c.id AND s.active = TRUE AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL) AS located_stations,
             (SELECT count(*)::int FROM acc a WHERE a.client_id = c.id) AS active_users,
             (SELECT count(*)::int FROM acc a WHERE a.client_id = c.id AND a.online) AS online_users
        FROM clients c
       WHERE c.status <> 'archive'
       ORDER BY c.name, c.id`),
    pool.query(`${accounts}
      SELECT a.id, a.login, a.full_name, a.role_label, a.client_id, c.name AS client_name, a.last_login_at, a.online,
             (SELECT string_agg(s.name, ', ' ORDER BY s.name) FROM user_stations us JOIN stations s ON s.id = us.station_id
               WHERE us.user_id = a.id AND s.active = TRUE) AS station_names
        FROM acc a LEFT JOIN clients c ON c.id = a.client_id
       ORDER BY a.online DESC, c.name NULLS LAST, a.login
       LIMIT 2000`)
  ]);
  const stations = st.rows.map(x => ({ ...x, located: x.latitude != null && x.longitude != null }));
  res.json({
    scope: 'all',
    stations,
    clients: cl.rows,
    users: us.rows,
    totals: {
      clients: cl.rows.length,
      stations: stations.length,
      located_stations: stations.filter(x => x.located).length,
      active_users: cl.rows.reduce((n, x) => n + x.active_users, 0),
      online_users: cl.rows.reduce((n, x) => n + x.online_users, 0)
    }
  });
}));

// ---------- Synthèse ----------
r.get('/admin/platform/summary', needPrincipal, wrap(async (req, res) => {
  const [from, to] = period(req.query);
  const one = async (sql, p) => (await pool.query(sql, p)).rows[0];
  const inv = await one(`SELECT COALESCE(SUM(amount),0) AS invoiced FROM platform_invoices WHERE status='emise' AND issued_on BETWEEN $1 AND $2`, [from, to]);
  const col = await one(`SELECT COALESCE(SUM(p.amount),0) AS collected FROM platform_invoice_payments p JOIN platform_invoices i ON i.id=p.invoice_id WHERE i.status='emise' AND p.paid_on BETWEEN $1 AND $2`, [from, to]);
  const exp = await one(`SELECT COALESCE(SUM(amount),0) AS committed FROM platform_expenses WHERE status='engagee' AND expense_date BETWEEN $1 AND $2`, [from, to]);
  const pay = await one(`SELECT COALESCE(SUM(p.amount),0) AS paid FROM platform_expense_payments p JOIN platform_expenses e ON e.id=p.expense_id WHERE e.status='engagee' AND p.paid_on BETWEEN $1 AND $2`, [from, to]);
  const rec = await one(`SELECT COALESCE(SUM(x.amount - x.paid),0) AS receivables,
        COALESCE(SUM(x.amount - x.paid) FILTER (WHERE x.due_on < CURRENT_DATE),0) AS overdue
      FROM (SELECT i.amount, i.due_on, COALESCE((SELECT SUM(p.amount) FROM platform_invoice_payments p WHERE p.invoice_id=i.id),0) AS paid FROM platform_invoices i WHERE i.status='emise') x
     WHERE x.amount > x.paid`);
  const debt = await one(`SELECT COALESCE(SUM(x.amount - x.paid),0) AS payables
      FROM (SELECT e.amount, COALESCE((SELECT SUM(p.amount) FROM platform_expense_payments p WHERE p.expense_id=e.id),0) AS paid FROM platform_expenses e WHERE e.status='engagee') x
     WHERE x.amount > x.paid`);
  const cash = await one(`SELECT
        (SELECT COALESCE(SUM(p.amount),0) FROM platform_invoice_payments p JOIN platform_invoices i ON i.id=p.invoice_id WHERE i.status='emise') -
        (SELECT COALESCE(SUM(p.amount),0) FROM platform_expense_payments p JOIN platform_expenses e ON e.id=p.expense_id WHERE e.status='engagee') AS treasury`);
  const cats = (await pool.query(`SELECT category, COALESCE(SUM(amount),0) AS committed FROM platform_expenses WHERE status='engagee' AND expense_date BETWEEN $1 AND $2 GROUP BY category ORDER BY 2 DESC`, [from, to])).rows;
  const n = x => Math.round(+x * 100) / 100;
  res.json({
    period: { from: from === '1970-01-01' ? null : from, to: to === '2999-12-31' ? null : to },
    invoiced: n(inv.invoiced), collected: n(col.collected),
    expenses_committed: n(exp.committed), expenses_paid: n(pay.paid),
    receivables: n(rec.receivables), receivables_overdue: n(rec.overdue), payables: n(debt.payables),
    treasury: n(cash.treasury),
    result_accrual: n(inv.invoiced - exp.committed),      // facturé - dépenses engagées (méthode d'engagement)
    result_cash: n(col.collected - pay.paid),             // encaissé - payé (méthode de trésorerie)
    expenses_by_category: cats.map(c => ({ category: c.category, committed: n(c.committed) })),
    method: "Résultat d'engagement = recettes facturées - dépenses engagées sur la période ; résultat de trésorerie = encaissements - paiements sur la période ; trésorerie = tous encaissements - tous paiements enregistrés."
  });
}));

// ---------- Factures (recettes) ----------
r.get('/admin/platform/invoices', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(invoiceSql + ' ORDER BY i.issued_on DESC, i.id DESC LIMIT 500');
  res.json(rows.map(x => withState(x)));
}));
r.post('/admin/platform/invoices', needPrincipal, body(z.object({
  client_id: z.number().int().positive().nullable().optional(), kind: z.enum(KINDS).default('licence'),
  label: z.string().trim().min(2).max(200), amount: MONEY, currency: z.string().trim().min(1).max(6).default('FCFA'),
  issued_on: DATE.optional(), due_on: DATE.nullable().optional(), period_start: DATE.nullable().optional(), period_end: DATE.nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(), notes: z.string().trim().max(1000).nullable().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  if (b.client_id) { const { rowCount } = await pool.query('SELECT 1 FROM clients WHERE id=$1', [b.client_id]); if (!rowCount) throw new HttpError(404, 'Client introuvable'); }
  const { rows: [x] } = await pool.query(
    `INSERT INTO platform_invoices(client_id,kind,label,amount,currency,issued_on,due_on,period_start,period_end,reference,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10,$11,$12) RETURNING id`,
    [b.client_id || null, b.kind, b.label, b.amount, b.currency, b.issued_on || null, b.due_on || null, b.period_start || null, b.period_end || null, b.reference || null, b.notes || null, req.user.id]);
  await audit(pool, req, 'platform', 'Facture plateforme créée', 'platform_invoices', x.id, null, b);
  res.status(201).json({ id: x.id });
}));
r.post('/admin/platform/invoices/:id/payments', needPrincipal, body(z.object({
  amount: MONEY, paid_on: DATE.optional(), method: z.string().trim().max(60).nullable().optional(), reference: z.string().trim().max(120).nullable().optional()
})), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), b = req.body;
  const out = await tx(async c => {
    const { rows: [i] } = await c.query('SELECT id, amount, status FROM platform_invoices WHERE id=$1 FOR UPDATE', [id]);
    if (!i) throw new HttpError(404, 'Facture introuvable');
    if (i.status === 'annulee') throw new HttpError(409, 'Facture annulée : encaissement impossible');
    const { rows: [s] } = await c.query('SELECT COALESCE(SUM(amount),0) AS paid FROM platform_invoice_payments WHERE invoice_id=$1', [id]);
    const left = Math.round((i.amount - s.paid) * 100) / 100;
    if (b.amount > left + 1e-9) throw new HttpError(409, 'Montant supérieur au solde restant (' + left + ')');
    const { rows: [p] } = await c.query('INSERT INTO platform_invoice_payments(invoice_id,amount,paid_on,method,reference,created_by) VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6) RETURNING id',
      [id, b.amount, b.paid_on || null, b.method || null, b.reference || null, req.user.id]);
    await audit(c, req, 'platform', 'Encaissement plateforme', 'platform_invoice_payments', p.id, null, { invoice_id: id, ...b });
    return { id: p.id, balance: Math.round((left - b.amount) * 100) / 100 };
  });
  res.status(201).json(out);
}));
r.post('/admin/platform/invoices/:id/cancel', needPrincipal, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await tx(async c => {
    const { rows: [i] } = await c.query('SELECT status FROM platform_invoices WHERE id=$1 FOR UPDATE', [id]);
    if (!i) throw new HttpError(404, 'Facture introuvable');
    const { rows: [s] } = await c.query('SELECT COUNT(*)::int AS n FROM platform_invoice_payments WHERE invoice_id=$1', [id]);
    if (s.n) throw new HttpError(409, 'Une facture avec encaissement ne peut pas être annulée');
    await c.query("UPDATE platform_invoices SET status='annulee' WHERE id=$1", [id]);
    await audit(c, req, 'platform', 'Facture plateforme annulée', 'platform_invoices', id, { status: i.status }, { status: 'annulee' });
  });
  res.json({ ok: true });
}));

// ---------- Dépenses du projet ----------
r.get('/admin/platform/expenses', needPrincipal, wrap(async (req, res) => {
  const { rows } = await pool.query(expenseSql + ' ORDER BY e.expense_date DESC, e.id DESC LIMIT 500');
  res.json(rows.map(x => withState(x)));
}));
r.post('/admin/platform/expenses', needPrincipal, body(z.object({
  category: z.enum(CATEGORIES), label: z.string().trim().min(2).max(200), supplier: z.string().trim().max(120).nullable().optional(),
  amount: MONEY, currency: z.string().trim().min(1).max(6).default('FCFA'), expense_date: DATE.optional(), due_on: DATE.nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(), notes: z.string().trim().max(1000).nullable().optional()
})), wrap(async (req, res) => {
  const b = req.body;
  const { rows: [x] } = await pool.query(
    `INSERT INTO platform_expenses(category,label,supplier,amount,currency,expense_date,due_on,reference,notes,created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9,$10) RETURNING id`,
    [b.category, b.label, b.supplier || null, b.amount, b.currency, b.expense_date || null, b.due_on || null, b.reference || null, b.notes || null, req.user.id]);
  await audit(pool, req, 'platform', 'Dépense plateforme créée', 'platform_expenses', x.id, null, b);
  res.status(201).json({ id: x.id });
}));
r.post('/admin/platform/expenses/:id/payments', needPrincipal, body(z.object({
  amount: MONEY, paid_on: DATE.optional(), method: z.string().trim().max(60).nullable().optional(), reference: z.string().trim().max(120).nullable().optional()
})), wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), b = req.body;
  const out = await tx(async c => {
    const { rows: [e] } = await c.query('SELECT id, amount, status FROM platform_expenses WHERE id=$1 FOR UPDATE', [id]);
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    if (e.status === 'annulee') throw new HttpError(409, 'Dépense annulée : règlement impossible');
    const { rows: [s] } = await c.query('SELECT COALESCE(SUM(amount),0) AS paid FROM platform_expense_payments WHERE expense_id=$1', [id]);
    const left = Math.round((e.amount - s.paid) * 100) / 100;
    if (b.amount > left + 1e-9) throw new HttpError(409, 'Montant supérieur au solde restant (' + left + ')');
    const { rows: [p] } = await c.query('INSERT INTO platform_expense_payments(expense_id,amount,paid_on,method,reference,created_by) VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6) RETURNING id',
      [id, b.amount, b.paid_on || null, b.method || null, b.reference || null, req.user.id]);
    await audit(c, req, 'platform', 'Règlement dépense plateforme', 'platform_expense_payments', p.id, null, { expense_id: id, ...b });
    return { id: p.id, balance: Math.round((left - b.amount) * 100) / 100 };
  });
  res.status(201).json(out);
}));
r.post('/admin/platform/expenses/:id/cancel', needPrincipal, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await tx(async c => {
    const { rows: [e] } = await c.query('SELECT status FROM platform_expenses WHERE id=$1 FOR UPDATE', [id]);
    if (!e) throw new HttpError(404, 'Dépense introuvable');
    const { rows: [s] } = await c.query('SELECT COUNT(*)::int AS n FROM platform_expense_payments WHERE expense_id=$1', [id]);
    if (s.n) throw new HttpError(409, 'Une dépense avec règlement ne peut pas être annulée');
    await c.query("UPDATE platform_expenses SET status='annulee' WHERE id=$1", [id]);
    await audit(c, req, 'platform', 'Dépense plateforme annulée', 'platform_expenses', id, { status: e.status }, { status: 'annulee' });
  });
  res.json({ ok: true });
}));

// ---------- Rapports (plateforme uniquement) ----------
const { reportTotals, round } = require('./report_totals');
const REPORTS = {
  licences: { title: 'Licences et abonnements', columns: ['Client', 'Statut client', 'Statut contrat', 'Début', 'Expiration', 'Durée indéfinie'],
    sql: `SELECT c.name, c.status, ct.status, COALESCE(ct.starts_at::date, ct.start_date), COALESCE(ct.expires_at::date, ct.end_date), CASE WHEN ct.is_indefinite THEN 'oui' ELSE 'non' END
            FROM clients c LEFT JOIN client_contracts ct ON ct.client_id=c.id ORDER BY c.name` },
  paiements: { title: 'Paiements, impayés et échéances', columns: ['Facture', 'Client', 'Montant', 'Encaissé', 'Solde', 'Échéance', 'État'], sumCols: [2, 3, 4],
    custom: async () => (await pool.query(invoiceSql + ' ORDER BY i.due_on NULLS LAST, i.id DESC LIMIT 1000')).rows.map(x => { const w = withState(x); return [w.label, w.client_name || '', w.amount, w.paid, w.balance, w.due_on ? String(w.due_on).slice(0, 10) : '', w.pay_state]; }) },
  recettes_depenses: { title: 'Recettes et dépenses par mois', columns: ['Mois', 'Facturé', 'Encaissé', 'Dépenses engagées', 'Dépenses payées'], sumCols: [1, 2, 3, 4],
    sql: `WITH m AS (
            SELECT to_char(issued_on,'YYYY-MM') AS mois, amount AS fact, 0::numeric AS enc, 0::numeric AS dep, 0::numeric AS pay FROM platform_invoices WHERE status='emise'
            UNION ALL SELECT to_char(p.paid_on,'YYYY-MM'), 0, p.amount, 0, 0 FROM platform_invoice_payments p JOIN platform_invoices i ON i.id=p.invoice_id WHERE i.status='emise'
            UNION ALL SELECT to_char(expense_date,'YYYY-MM'), 0, 0, amount, 0 FROM platform_expenses WHERE status='engagee'
            UNION ALL SELECT to_char(p.paid_on,'YYYY-MM'), 0, 0, 0, p.amount FROM platform_expense_payments p JOIN platform_expenses e ON e.id=p.expense_id WHERE e.status='engagee')
          SELECT mois, SUM(fact), SUM(enc), SUM(dep), SUM(pay) FROM m GROUP BY mois ORDER BY mois DESC` },
  charges_techniques: { title: "Charges d'hébergement, de stockage et services techniques", columns: ['Catégorie', 'Engagé', 'Payé', 'Reste à payer'], sumCols: [1, 2, 3],
    sql: `SELECT e.category, SUM(e.amount), COALESCE(SUM((SELECT SUM(p.amount) FROM platform_expense_payments p WHERE p.expense_id=e.id)),0), SUM(e.amount) - COALESCE(SUM((SELECT SUM(p.amount) FROM platform_expense_payments p WHERE p.expense_id=e.id)),0)
            FROM platform_expenses e WHERE e.status='engagee' AND e.category IN ('hebergement','base_de_donnees','stockage','domaine','licences_logicielles','api_paiement') GROUP BY e.category ORDER BY 2 DESC` },
  creances_dettes: { title: 'Créances et dettes de la plateforme', columns: ['Nature', 'Libellé', 'Tiers', 'Solde', 'Échéance'],
    totals: rows => {
      const sum = n => round(rows.filter(r => r[0] === n).reduce((a, r) => a + (+r[3] || 0), 0));
      const c = sum('Créance'), d = sum('Dette');
      return [['TOTAL CRÉANCES', '', '', c, ''], ['TOTAL DETTES', '', '', d, ''], ['SOLDE NET (créances − dettes)', '', '', round(c - d), '']];
    },
    custom: async () => {
      const a = (await pool.query(invoiceSql + " WHERE i.status='emise'")).rows.map(x => withState(x)).filter(x => x.balance > 0).map(x => ['Créance', x.label, x.client_name || '', x.balance, x.due_on ? String(x.due_on).slice(0, 10) : '']);
      const d = (await pool.query(expenseSql + " WHERE e.status='engagee'")).rows.map(x => withState(x)).filter(x => x.balance > 0).map(x => ['Dette', x.label, x.supplier || '', x.balance, x.due_on ? String(x.due_on).slice(0, 10) : '']);
      return [...a, ...d];
    } },
  tresorerie: { title: 'Trésorerie : évolution mensuelle', columns: ['Mois', 'Encaissements', 'Paiements', 'Flux net'], sumCols: [1, 2, 3],
    sql: `WITH f AS (
            SELECT to_char(p.paid_on,'YYYY-MM') AS mois, p.amount AS entree, 0::numeric AS sortie FROM platform_invoice_payments p JOIN platform_invoices i ON i.id=p.invoice_id WHERE i.status='emise'
            UNION ALL SELECT to_char(p.paid_on,'YYYY-MM'), 0, p.amount FROM platform_expense_payments p JOIN platform_expenses e ON e.id=p.expense_id WHERE e.status='engagee')
          SELECT mois, SUM(entree), SUM(sortie), SUM(entree) - SUM(sortie) FROM f GROUP BY mois ORDER BY mois DESC` },
  comptes: { title: 'Comptes clients par statut', columns: ['Statut', 'Nombre'], sumCols: [1], sql: `SELECT status, COUNT(*)::int FROM clients GROUP BY status ORDER BY status` },
  contrats: { title: 'Contrats et renouvellements', columns: ['Client', 'Statut contrat', 'Expiration', 'Dernier renouvellement', 'Demandes en attente'],
    sql: `SELECT c.name, ct.status, COALESCE(ct.expires_at::date, ct.end_date), ct.last_renewed_at::date,
                 (SELECT COUNT(*)::int FROM license_renewal_requests rr WHERE rr.client_id=c.id AND rr.status='pending')
            FROM clients c LEFT JOIN client_contracts ct ON ct.client_id=c.id ORDER BY c.name` }
};
r.get('/admin/platform/reports', needPrincipal, (req, res) => res.json(Object.entries(REPORTS).map(([key, d]) => ({ key, title: d.title }))));
r.get('/admin/platform/reports/:type', needPrincipal, wrap(async (req, res) => {
  const d = Object.prototype.hasOwnProperty.call(REPORTS, req.params.type) ? REPORTS[req.params.type] : null;
  if (!d) throw new HttpError(404, 'Rapport inconnu');
  const rows = d.custom ? await d.custom() : (await pool.query({ text: d.sql, rowMode: 'array' })).rows;
  if (req.query.format === 'csv') throw new HttpError(400, 'Export CSV retiré de la plateforme. Utilisez PDF ou Excel.');
  if (req.query.format === 'xlsx') {
    const colors = await getPlatformReportColors();
    const argb = hex => 'FF' + hex.slice(1).toUpperCase();
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook(); wb.creator = 'Manager PRO'; wb.created = new Date();
    const ws = wb.addWorksheet('Rapport plateforme');
    ws.addRow(['Manager PRO — Plateforme']).font = { bold: true, size: 14, color: { argb: argb(colors.primary) } };
    ws.addRow([d.title]).font = { bold: true, size: 12 };
    ws.addRow(['Généré le ' + new Date().toLocaleString('fr-FR')]).font = { italic: true, color: { argb: 'FF5B6675' } };
    ws.addRow([]);
    const header = ws.addRow(d.columns); header.font = { bold: true, color: { argb: argb(colors.text) } };
    header.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(colors.secondary) } }; c.border = { bottom: { style: 'thin' } }; });
    rows.forEach(row => ws.addRow(row.map(v => v == null ? '' : v)));
    reportTotals(d, rows).forEach(t => { const tr = ws.addRow(t); tr.font = { bold: true }; tr.eachCell(c => { c.border = { top: { style: 'thin' } }; }); });
    if (!rows.length) ws.addRow(['Aucune donnée sur la période.']).font = { italic: true, color: { argb: 'FF5B6675' } };
    d.columns.forEach((col, i) => {
      const c = ws.getColumn(i + 1); c.width = Math.min(42, Math.max(12, String(col).length + 3, ...rows.slice(0, 100).map(r => String(r[i] ?? '').length + 2)));
      if (rows.some(r => typeof r[i] === 'number')) { c.numFmt = '#,##0.00'; c.alignment = { horizontal: 'right' }; }   // colonnes montants : alignées à droite
    });
    ws.views = [{ state: 'frozen', ySplit: header.number }];
    if (rows.length) ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: header.number, column: d.columns.length } };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="plateforme-${req.params.type}.xlsx"`);
    return res.send(buf);
  }
  if (req.query.format === 'pdf') {
    const colors = await getPlatformReportColors();
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', layout: d.columns.length > 5 ? 'landscape' : 'portrait', margin: 32, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise((resolve, reject) => { doc.on('end', resolve); doc.on('error', reject); });
    doc.font('Helvetica-Bold').fontSize(15).fillColor(colors.primary).text('Manager PRO — Plateforme');
    doc.moveDown(0.3).fontSize(11).fillColor(colors.text).text(d.title);
    doc.moveDown(0.5).font('Helvetica').fontSize(7.5).fillColor('#5B6675').text('Généré le ' + new Date().toLocaleString('fr-FR'));
    doc.moveDown(0.8);
    const widths = d.columns.map(c => Math.max(45, Math.min(150, String(c).length * 5 + 18)));
    const pageWidth = doc.page.width - 64;
    const scale = Math.min(1, pageWidth / widths.reduce((a, b) => a + b, 0));
    const ws = widths.map(w => w * scale);
    const drawRow = (cells, header = false, total = false) => {
      const h = Math.max(18, ...cells.map((v, i) => doc.heightOfString(String(v ?? ''), { width: ws[i] - 6, fontSize: 7 }) + 8));
      if (doc.y + h > doc.page.height - 36) doc.addPage();
      const y = doc.y; let x = 32;
      if (header) doc.rect(x, y, ws.reduce((a,b)=>a+b,0), h).fill(colors.secondary);
      if (total) doc.rect(x, y, ws.reduce((a,b)=>a+b,0), h).fill('#EEF1F5');
      doc.font(header || total ? 'Helvetica-Bold' : 'Helvetica').fontSize(7).fillColor(colors.text);
      const fmtN = v => (typeof v === 'number' ? v.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }) : String(v ?? ''));
      cells.forEach((v, i) => { doc.text(fmtN(v), x + 3, y + 4, { width: ws[i] - 6, height: h - 4, align: typeof v === 'number' ? 'right' : 'left' }); x += ws[i]; });
      doc.moveTo(32, y + h).lineTo(32 + ws.reduce((a,b)=>a+b,0), y + h).strokeColor('#D5DBE2').stroke(); doc.y = y + h;
    };
    drawRow(d.columns, true); rows.forEach(row => drawRow(row));
    if (!rows.length) { doc.font('Helvetica-Oblique').fontSize(8).fillColor('#5B6675').text('Aucune donnée sur la période.', 35, doc.y + 4); doc.y += 14; }
    reportTotals(d, rows).forEach(t => drawRow(t, false, true));
    doc.end(); await done;
    const buf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="plateforme-${req.params.type}.pdf"`);
    return res.send(buf);
  }
  res.json({ title: d.title, columns: d.columns, rows, totals: reportTotals(d, rows) });
}));


/** Facture plateforme auto (licence / abonnement) — même transaction que le contrat si `c` fourni. */
async function createLicenseInvoice(c, {
  clientId, amount, kind = 'licence', label, periodStart = null, periodEnd = null,
  reference = null, notes = null, userId = null, markPaid = false, currency = 'FCFA'
}) {
  const amt = Math.round(Number(amount) * 100) / 100;
  if (!(amt > 0)) return null;
  const db = c || pool;
  const { rows: [inv] } = await db.query(
    `INSERT INTO platform_invoices(client_id, kind, label, amount, currency, issued_on, due_on,
        period_start, period_end, reference, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,CURRENT_DATE + 15,$6,$7,$8,$9,'emise',$10)
     RETURNING id, amount, client_id, kind, label, issued_on`,
    [clientId, kind, label, amt, currency, periodStart, periodEnd, reference, notes, userId]
  );
  if (markPaid) {
    await db.query(
      `INSERT INTO platform_invoice_payments(invoice_id, amount, paid_on, method, reference, created_by)
       VALUES ($1,$2,CURRENT_DATE,'auto_licence',$3,$4)`,
      [inv.id, amt, reference || ('INV-' + inv.id), userId]
    );
  }
  return inv;
}

async function resolveDefaultLicenseAmount() {
  try {
    const { rows: [row] } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'platform_default_license_amount' LIMIT 1`
    ).catch(swallow('platform:387', { rows: [] }));
    if (row && row.value != null) {
      const n = Number(typeof row.value === 'object' ? row.value.amount ?? row.value : row.value);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch (_) { /* table absente */ }
  try {
    const { rows: [row] } = await pool.query(
      `SELECT value FROM settings WHERE key = 'platform_default_license_amount' AND station_id IS NULL LIMIT 1`
    ).catch(swallow('platform:396', { rows: [] }));
    if (row && row.value != null) {
      const v = row.value;
      const n = Number(typeof v === 'object' ? v.amount ?? v : v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  } catch (e) { ignored('platform:montant-licence-defaut', e); }
  return null;
}


module.exports = r;
module.exports.createLicenseInvoice = createLicenseInvoice;
module.exports.resolveDefaultLicenseAmount = resolveDefaultLicenseAmount;

