// Module d'archivage mensuel : archive ZIP (100 % PDF) de tous les documents d'un mois pour la station courante.
// Les PDF réutilisent le moteur des rapports existants : docs.buildPdf, jeux de données du hub d'exports (exports.loadDataset)
// et rendu de facture de billing.js ; seuls les justificatifs de dépenses déjà stockés (images/PDF) sont joints tels quels.
// GET /exports/archive/monthly/summary?month=AAAA-MM  → contenu prévu (nombre d'éléments par dossier, dossiers autorisés)
// GET /exports/archive/monthly?month=AAAA-MM          → archive ZIP
// Chemin sous /exports : le contrôle de contrat « exports » de server.js s'applique ; le Super Admin n'a aucun accès (données de station).
// SOURCES : chaque fichier est une lecture des tables de la station (station_id = station courante) ; l'INDEX_ARCHIVE.csv
// de l'archive indique, pour chaque fichier, ses tables sources, son nombre de lignes et son empreinte SHA-256.
const express = require('express');
const { pool, wrap, need, HttpError, audit } = require('./core');
const { swallow } = require('./safe');
const docs = require('./docs');
const files = require('./files');
const { createZip } = require('./zip_writer');
const A = require('./archive_logic');
const { moduleOn } = require('./multistation_views');
const exp = require('./exports');         // jeux de données et droits des exports PDF existants
const billing = require('./billing');     // rendu PDF de facture client existant

const r = express.Router();
const RUNNING = new Set();                  // une génération à la fois par utilisateur (coûteuse en CPU/mémoire)
const BUDGET_MS = 90 * 1000;                // au-delà, les PDF individuels restants sont omis (les tableaux récapitulatifs PDF restent complets)

const n = v => Number(v) || 0;
const METHOD = { especes: 'Espèces', carte: 'Carte bancaire', mobile_money: 'Mobile Money', credit: 'Crédit client', autre: 'Autre', banque: 'Virement / banque', orange_money: 'Orange Money', wave: 'Wave' };
const mLabel = c => METHOD[c] || c || '';
const INV_STATUS = { brouillon: 'Brouillon', emise: 'Émise', partielle: 'Partiellement payée', payee: 'Payée', annulee: 'Annulée' };
const PU_STATUS = { commande: 'Commandé', partiel: 'Reçu partiellement', recu: 'Reçu', facture: 'Facturé', paye: 'Payé', archive: 'Archivé', annule: 'Annulé' };

function folderAccess(req) {
  const has = (...c) => c.some(x => req.user.perms.has(x));
  return {
    days: has('report.view', 'finance.view', 'shift.close') && moduleOn(req, 'module:sales', 'can_view_reports', 'module:reports'),
    purchases: has('purchase.manage', 'supplier.view', 'finance.view') && moduleOn(req, 'module:stock', 'module:purchases', 'module:suppliers'),
    customers: has('sale.create', 'finance.view', 'report.view', 'customer.view', 'customer.edit') && moduleOn(req, 'can_use_billing', 'module:billing'),
    expenses: has('expense.create', 'finance.view') && moduleOn(req, 'can_access_finance', 'module:finance'),
    thirds: has('finance.view') && moduleOn(req, 'can_access_finance', 'module:finance'),
    misc: has('report.view', 'finance.view') && moduleOn(req, 'can_view_reports', 'module:reports', 'module:sales')
  };
}


/** Un tableau (ou plusieurs) → PDF, avec le même moteur et la même mise en page que les exports PDF existants. */
function sheetsPdf({ b, title, subtitle, ref, sheets }) {
  const sections = [];
  for (const sh of sheets) {
    sections.push({ type: 'table', title: sh.name, head: sh.head, rows: sh.rows, sumCols: sh.sumCols || [] });
    for (const t of sh.notes || []) sections.push({ type: 'text', text: t });
  }
  return docs.buildPdf({ b, title: String(title).toUpperCase(), subtitle, ref, sections, landscape: sheets.some(sh => sh.head.length > 5) });
}

/** PDF d'un jeu de données du hub d'exports (mêmes colonnes, totaux et droits que GET /exports/:kind?format=pdf). */
async function datasetPdf(ctx, kind, filePath, description) {
  const meta = exp.KINDS[kind];
  if (!meta || !exp.allowed(ctx.req, meta)) return null;
  const data = await exp.loadDataset(kind, ctx.sid, ctx.R.from, ctx.R.to, ctx.req);
  const subtitle = data.count_label ? `Total : ${data.rows.length} ${data.count_label}` : `${ctx.R.from} → ${ctx.R.to} · ${data.rows.length} ligne(s)`;
  return {
    path: filePath, rows: data.rows.length, description, sources: `jeu de données « ${meta.label} » du hub d'exports`,
    data: await docs.buildPdf({ b: ctx.b, title: meta.label.toUpperCase(), subtitle, ref: `EXP-${kind}-${ctx.month}`,
      sections: [{ type: 'table', title: meta.label, head: data.head, rows: data.rows, sumCols: data.sumCols }], landscape: data.head.length > 6, signatures: [{ label: 'Responsable' }] })
  };
}

const q = (sql, params) => pool.query(sql, params).then(x => x.rows);
const keyBy = (rows, k) => { const m = new Map(); for (const x of rows) { if (!m.has(x[k])) m.set(x[k], []); m.get(x[k]).push(x); } return m; };

/** Définition du CA du tableau de bord, par jour et par source (produits / carburant compteurs / carburant déclaré en quart ouvert). */
const REVENUE_BY_DAY = `
  WITH ev AS (
    SELECT sa.sold_at::date AS d, 'produits' AS src, sa.total AS amt FROM sales sa
     WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
    UNION ALL
    SELECT sh.closed_at::date, 'carburant', m.amount FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
     WHERE sh.station_id = $1 AND sh.status = 'ferme' AND m.amount IS NOT NULL AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
    UNION ALL
    SELECT sa.sold_at::date, 'carburant_ouvert', sa.total FROM sales sa JOIN shifts sh ON sh.id = sa.shift_id
     WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.kind = 'carburant' AND sh.status = 'ouvert' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1)
  SELECT d::text AS d, src, SUM(amt)::float AS amt FROM ev GROUP BY 1, 2 ORDER BY 1, 2`;

/* ------------------------------------------------------------------ */
/* 01 — Rapports des journées                                          */
/* ------------------------------------------------------------------ */
async function buildDays(ctx) {
  const { sid, R, b, deadline } = ctx, P = [sid, R.from, R.to];
  const [rev, shifts, fuel, prods, pays, anoms, canc] = await Promise.all([
    q(REVENUE_BY_DAY, P),
    q(`SELECT id, number, kind, status, shift_date::text AS d, opened_at, closed_at, opening_cash::float AS opening_cash,
              theoretical_cash::float AS theoretical_cash, counted_cash::float AS counted_cash, cash_gap::float AS cash_gap
         FROM shifts WHERE station_id = $1 AND status IN ('ouvert', 'ferme') AND shift_date >= $2::date AND shift_date <= $3::date ORDER BY shift_date, number`, P),
    q(`SELECT sh.closed_at::date::text AS d, p.name, SUM(m.liters)::float AS liters, SUM(m.amount)::float AS amount
         FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id JOIN products p ON p.id = m.product_id
        WHERE sh.station_id = $1 AND sh.status = 'ferme' AND m.amount IS NOT NULL AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
        GROUP BY 1, 2 ORDER BY 1, amount DESC`, P),
    q(`SELECT sa.sold_at::date::text AS d, p.name, SUM(sd.quantity)::float AS qty, SUM(sd.amount)::float AS amount
         FROM sale_details sd JOIN sales sa ON sa.id = sd.sale_id JOIN products p ON p.id = sd.product_id
        WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
        GROUP BY 1, 2 ORDER BY 1, amount DESC`, P),
    q(`SELECT pm.paid_at::date::text AS d, pm.method, SUM(pm.amount)::float AS amount
         FROM payments pm LEFT JOIN sales sa ON sa.id = pm.sale_id
        WHERE pm.station_id = $1 AND (pm.sale_id IS NULL OR sa.status = 'valide') AND pm.paid_at >= $2::date AND pm.paid_at < $3::date + 1
        GROUP BY 1, 2 ORDER BY 1, 2`, P),
    q(`SELECT sh.shift_date::text AS d, sh.number, an.kind, an.description, an.amount::float AS amount
         FROM shift_anomalies an JOIN shifts sh ON sh.id = an.shift_id
        WHERE sh.station_id = $1 AND sh.shift_date >= $2::date AND sh.shift_date <= $3::date ORDER BY sh.shift_date, sh.number, an.id`, P),
    q(`SELECT sold_at::date::text AS d, COUNT(*)::int AS n FROM sales
        WHERE station_id = $1 AND status = 'annule' AND sold_at >= $2::date AND sold_at < $3::date + 1 GROUP BY 1`, P)
  ]);
  const revBy = keyBy(rev, 'd'), shBy = keyBy(shifts, 'd'), fuelBy = keyBy(fuel, 'd'), prodBy = keyBy(prods, 'd'),
    payBy = keyBy(pays, 'd'), anBy = keyBy(anoms, 'd'), cancBy = new Map(canc.map(x => [x.d, x.n]));
  const days = [...new Set([...revBy.keys(), ...shBy.keys(), ...payBy.keys()])].sort();
  const sumSrc = (d, s) => (revBy.get(d) || []).filter(x => x.src === s).reduce((a, x) => a + n(x.amt), 0);

  const out = [], notes = [];
  const summaryRows = days.map(d => {
    const prod = sumSrc(d, 'produits'), fu = sumSrc(d, 'carburant') + sumSrc(d, 'carburant_ouvert');
    const esp = (payBy.get(d) || []).filter(x => x.method === 'especes').reduce((a, x) => a + n(x.amount), 0);
    const gap = (shBy.get(d) || []).reduce((a, x) => a + n(x.cash_gap), 0);
    return [d, (shBy.get(d) || []).length, prod, fu, prod + fu, esp, gap, cancBy.get(d) || 0];
  });
  out.push({
    path: `${A.FOLDERS.days}/Synthese_des_journees_${ctx.month}.pdf`, rows: summaryRows.length,
    description: 'Synthèse jour par jour : quarts, CA produits, CA carburant, CA TTC, espèces encaissées, écarts de caisse',
    sources: 'sales, meter_readings, shifts, payments',
    data: await sheetsPdf({ b, title: 'Synthèse des journées', subtitle: A.monthLabel(ctx.month), ref: ctx.month, sheets: [{
      name: 'Journées', head: ['Date', 'Quarts', 'CA produits', 'CA carburant', 'CA TTC', 'Espèces encaissées', 'Écart de caisse', 'Ventes annulées'],
      rows: summaryRows, sumCols: [1, 2, 3, 4, 5, 6, 7],
      notes: ['CA = définition du tableau de bord : ventes produits + carburant des compteurs (quarts clos, rattaché au jour de clôture) + carburant déclaré des quarts ouverts.'] }] })
  });

  let done = 0;
  for (const d of days) {
    if (done >= A.MAX_DOCS_PER_FOLDER || Date.now() > deadline) { notes.push(`${days.length - done} rapport(s) de journée non générés en PDF (limite de temps ou de nombre) : leurs chiffres figurent dans la synthèse PDF.`); break; }
    const prod = sumSrc(d, 'produits'), fu = sumSrc(d, 'carburant') + sumSrc(d, 'carburant_ouvert');
    const esp = (payBy.get(d) || []).filter(x => x.method === 'especes').reduce((a, x) => a + n(x.amount), 0);
    const sections = [
      { type: 'kpis', title: 'Synthèse', items: [
        { label: 'CA TTC', value: prod + fu }, { label: 'dont produits', value: prod }, { label: 'dont carburant', value: fu },
        { label: 'Espèces encaissées', value: esp }, { label: 'Quarts', value: (shBy.get(d) || []).length }, { label: 'Ventes annulées', value: cancBy.get(d) || 0 }] },
      { type: 'table', title: 'Quarts de la journée', head: ['N°', 'Type', 'Statut', 'Ouverture', 'Clôture', 'Caisse initiale', 'Caisse théorique', 'Caisse comptée', 'Écart'],
        rows: (shBy.get(d) || []).map(x => [x.number, x.kind, x.status, x.opened_at, x.closed_at, n(x.opening_cash), x.theoretical_cash == null ? '' : n(x.theoretical_cash), x.counted_cash == null ? '' : n(x.counted_cash), x.cash_gap == null ? '' : n(x.cash_gap)]), sumCols: [8] }
    ];
    if ((fuelBy.get(d) || []).length) sections.push({ type: 'table', title: 'Carburant (compteurs, quarts clos)', head: ['Produit', 'Litres', 'Montant TTC'], rows: fuelBy.get(d).map(x => [x.name, n(x.liters), n(x.amount)]), sumCols: [1, 2] });
    if ((prodBy.get(d) || []).length) sections.push({ type: 'table', title: 'Ventes de produits', head: ['Produit', 'Quantité', 'Montant TTC'], rows: prodBy.get(d).map(x => [x.name, n(x.qty), n(x.amount)]), sumCols: [2] });
    if ((payBy.get(d) || []).length) sections.push({ type: 'table', title: 'Encaissements par mode de paiement', head: ['Mode', 'Montant'], rows: payBy.get(d).map(x => [mLabel(x.method), n(x.amount)]), sumCols: [1] });
    if ((anBy.get(d) || []).length) sections.push({ type: 'table', title: 'Anomalies de quart', head: ['Quart', 'Type', 'Description', 'Montant'], rows: anBy.get(d).map(x => [x.number, x.kind, x.description, x.amount == null ? '' : n(x.amount)]) });
    sections.push({ type: 'text', text: 'Chiffres extraits de la base (sales, meter_readings, shifts, payments, shift_anomalies). Carburant des compteurs rattaché au jour de clôture du quart.' });
    out.push({
      path: `${A.FOLDERS.days}/Rapport_${d}.pdf`, rows: (shBy.get(d) || []).length,
      description: `Rapport de la journée du ${d}`, sources: 'sales, meter_readings, shifts, payments, shift_anomalies',
      data: await docs.buildPdf({ b, title: 'RAPPORT DE JOURNÉE', subtitle: d.split('-').reverse().join('/'), ref: `${ctx.month}-${d.slice(8)}`, sections })
    });
    done++;
  }
  return { files: out, notes };
}

/* ------------------------------------------------------------------ */
/* 02 — Factures des achats                                            */
/* ------------------------------------------------------------------ */
async function buildPurchases(ctx) {
  const { sid, R, b, deadline } = ctx, P = [sid, R.from, R.to];
  const pur = await q(
    `SELECT pu.id, pu.order_no, pu.invoice_no, pu.status, pu.ordered_at, pu.received_at, pu.invoice_date::text AS invoice_date, pu.due_date::text AS due_date,
            pu.total::float AS total, pu.invoice_total::float AS invoice_total, pu.paid::float AS paid, su.name AS supplier
       FROM purchases pu JOIN suppliers su ON su.id = pu.supplier_id
      WHERE pu.station_id = $1 AND pu.status <> 'annule'
        AND ((pu.ordered_at >= $2::date AND pu.ordered_at < $3::date + 1) OR (pu.invoice_date >= $2::date AND pu.invoice_date <= $3::date)
          OR (pu.received_at >= $2::date AND pu.received_at < $3::date + 1))
      ORDER BY COALESCE(pu.invoice_date, pu.ordered_at::date), pu.id`, P);
  const ids = pur.map(x => x.id);
  const [lines, pays] = ids.length ? await Promise.all([
    q(`SELECT pd.purchase_id, p.name, pd.qty_ordered::float AS qo, pd.qty_received::float AS qr, pd.unit_cost::float AS cost, COALESCE(pd.tax_rate, 0)::float AS tax
         FROM purchase_details pd JOIN products p ON p.id = pd.product_id WHERE pd.purchase_id = ANY($1::bigint[]) ORDER BY pd.purchase_id, pd.id`, [ids]),
    q(`SELECT purchase_id, paid_at, method, amount::float AS amount FROM supplier_payments WHERE purchase_id = ANY($1::bigint[]) ORDER BY paid_at, id`, [ids])
  ]) : [[], []];
  const lineBy = keyBy(lines, 'purchase_id'), payBy = keyBy(pays, 'purchase_id');
  const out = [], notes = [];
  out.push({
    path: `${A.FOLDERS.purchases}/Achats_${ctx.month}.pdf`, rows: pur.length,
    description: 'Liste des commandes et factures fournisseurs du mois, avec leurs lignes',
    sources: 'purchases, purchase_details, suppliers, supplier_payments',
    data: await sheetsPdf({ b, title: 'Achats et factures fournisseurs', subtitle: A.monthLabel(ctx.month), ref: ctx.month, sheets: [
      { name: 'Achats', head: ['N° commande', 'N° facture', 'Fournisseur', 'Statut', 'Commande', 'Réception', 'Date facture', 'Échéance', 'Total commandé', 'Total facturé', 'Payé', 'Reste à payer'],
        rows: pur.map(x => [x.order_no || x.id, x.invoice_no || '', x.supplier, PU_STATUS[x.status] || x.status, x.ordered_at, x.received_at || '', x.invoice_date || '', x.due_date || '', x.total, x.invoice_total == null ? '' : x.invoice_total, x.paid, Math.round(((x.invoice_total == null ? x.total : x.invoice_total) - x.paid) * 100) / 100]),
        sumCols: [8, 9, 10, 11] },
      { name: 'Lignes', head: ['N° commande', 'Produit', 'Qté commandée', 'Qté reçue', 'Coût unitaire', 'TVA %', 'Montant reçu'],
        rows: lines.map(l => { const pu = pur.find(x => x.id === l.purchase_id); return [pu ? (pu.order_no || pu.id) : l.purchase_id, l.name, l.qo, l.qr, l.cost, l.tax, Math.round(l.qr * l.cost * 100) / 100]; }), sumCols: [6] }] })
  });
  let done = 0;
  for (const pu of pur) {
    if (done >= A.MAX_DOCS_PER_FOLDER || Date.now() > deadline) { notes.push(`${pur.length - done} facture(s) d'achat non générées en PDF (limite) : elles figurent dans le tableau récapitulatif PDF.`); break; }
    const ls = lineBy.get(pu.id) || [], recv = ls.reduce((a, l) => a + l.qr * l.cost, 0);
    const billed = pu.invoice_total == null ? recv : pu.invoice_total;
    const sections = [
      { type: 'kv', title: 'Document', rows: [['Fournisseur', pu.supplier], ['N° de commande', pu.order_no || pu.id], ['N° de facture', pu.invoice_no || '—'], ['Statut', PU_STATUS[pu.status] || pu.status],
        ['Commande', pu.ordered_at], ['Réception', pu.received_at || '—'], ['Date de facture', pu.invoice_date || '—'], ['Échéance', pu.due_date || '—']] },
      { type: 'table', title: 'Lignes', head: ['Produit', 'Qté commandée', 'Qté reçue', 'Coût unitaire', 'TVA %', 'Montant reçu'], rows: ls.map(l => [l.name, l.qo, l.qr, l.cost, l.tax, Math.round(l.qr * l.cost * 100) / 100]), sumCols: [5] },
      { type: 'kv', title: 'Règlement', rows: [['Total facturé', pu.invoice_total == null ? '— (non facturé)' : pu.invoice_total], ['Payé', pu.paid], ['Reste à payer', Math.round((billed - pu.paid) * 100) / 100]] }
    ];
    if ((payBy.get(pu.id) || []).length) sections.push({ type: 'table', title: 'Règlements enregistrés', head: ['Date', 'Mode', 'Montant'], rows: payBy.get(pu.id).map(x => [x.paid_at, mLabel(x.method), x.amount]), sumCols: [2] });
    out.push({
      path: `${A.FOLDERS.purchases}/${pu.invoice_no ? 'Facture' : 'Commande'}_${A.slug(pu.invoice_no || pu.order_no || pu.id)}_${A.slug(pu.supplier)}.pdf`, rows: ls.length,
      description: `${pu.invoice_no ? 'Facture' : 'Commande'} fournisseur ${pu.invoice_no || pu.order_no || pu.id} — ${pu.supplier}`, sources: 'purchases, purchase_details, supplier_payments',
      data: await docs.buildPdf({ b, title: pu.invoice_no ? 'FACTURE D\'ACHAT' : 'BON DE COMMANDE', subtitle: pu.supplier, ref: pu.invoice_no || pu.order_no || String(pu.id), sections })
    });
    done++;
  }
  return { files: out, notes };
}

/* ------------------------------------------------------------------ */
/* 03 — Factures clients                                               */
/* ------------------------------------------------------------------ */
async function buildCustomerInvoices(ctx) {
  const { sid, R, b, deadline } = ctx, P = [sid, R.from, R.to];
  const inv = await q(
    `SELECT i.id, i.invoice_no, i.status, i.issued_on::text AS issued_on, i.due_date::text AS due_date, i.tax_rate::float AS tax_rate,
            i.total_ht::float AS total_ht, i.total_tax::float AS total_tax, i.total_ttc::float AS total_ttc, i.amount_paid::float AS amount_paid, c.name AS customer
       FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.station_id = $1 AND i.status <> 'brouillon' AND i.issued_on >= $2::date AND i.issued_on <= $3::date ORDER BY i.issued_on, i.id`, P);
  const ids = inv.map(x => x.id);
  const lines = ids.length ? await q(`SELECT invoice_id, description, quantity::float AS qty, unit_price::float AS price, amount::float AS amount FROM invoice_lines WHERE invoice_id = ANY($1::bigint[]) ORDER BY invoice_id, id`, [ids]) : [];
  const lineBy = keyBy(lines, 'invoice_id');
  const out = [], notes = [];
  out.push({
    path: `${A.FOLDERS.customers}/Factures_clients_${ctx.month}.pdf`, rows: inv.length,
    description: 'Liste des factures clients émises dans le mois (annulées incluses, signalées)', sources: 'invoices, invoice_lines, customers',
    data: await sheetsPdf({ b, title: 'Factures clients', subtitle: A.monthLabel(ctx.month), ref: ctx.month, sheets: [
      { name: 'Factures', head: ['N° facture', 'Client', 'Statut', 'Émise le', 'Échéance', 'Total HT', 'TVA', 'Total TTC', 'Payé', 'Reste'],
        rows: inv.map(x => [x.invoice_no, x.customer || '', INV_STATUS[x.status] || x.status, x.issued_on, x.due_date || '', x.total_ht, x.total_tax, x.total_ttc, x.amount_paid, x.status === 'annulee' ? 0 : Math.round((x.total_ttc - x.amount_paid) * 100) / 100]), sumCols: [5, 6, 7, 8, 9] },
      { name: 'Lignes', head: ['N° facture', 'Désignation', 'Quantité', 'Prix unitaire', 'Montant'],
        rows: lines.map(l => [(inv.find(x => x.id === l.invoice_id) || {}).invoice_no || l.invoice_id, l.description, l.qty, l.price, l.amount]), sumCols: [4] }] })
  });
  let done = 0;
  for (const x of inv) {
    if (done >= A.MAX_DOCS_PER_FOLDER || Date.now() > deadline) { notes.push(`${inv.length - done} facture(s) client non générées en PDF (limite) : elles figurent dans le tableau récapitulatif PDF.`); break; }
    out.push({
      path: `${A.FOLDERS.customers}/Facture_${A.slug(x.invoice_no)}.pdf`, rows: (lineBy.get(x.id) || []).length,
      description: `Facture client ${x.invoice_no}${x.customer ? ' — ' + x.customer : ''}${x.status === 'annulee' ? ' (ANNULÉE)' : ''}`, sources: 'invoices, invoice_lines, customers',
      data: await billing.buildInvoicePdf(b, { ...x, customer_name: x.customer, lines: (lineBy.get(x.id) || []).map(l => ({ description: l.description, quantity: l.qty, unit_price: l.price, amount: l.amount })) })
    });
    done++;
  }
  return { files: out, notes };
}

/* ------------------------------------------------------------------ */
/* 04 — Factures des dépenses                                          */
/* ------------------------------------------------------------------ */
async function buildExpenses(ctx) {
  const { sid, R } = ctx, P = [sid, R.from, R.to];
  const out = [], notes = [];
  const journal = await datasetPdf(ctx, 'expenses', `${A.FOLDERS.expenses}/Journal_des_depenses_${ctx.month}.pdf`, 'Journal des dépenses du mois (mêmes colonnes que l\'export PDF Dépenses)');
  if (journal) out.push(journal); else notes.push('journal des dépenses non inclus (droit d\'export dépenses requis).');
  const exp2 = await q(`SELECT e.id, e.spent_on::text AS d, e.category, e.receipt_url FROM expenses e
      WHERE e.station_id = $1 AND e.deleted_at IS NULL AND e.spent_on >= $2::date AND e.spent_on <= $3::date ORDER BY e.spent_on, e.id`, P);
  for (const e of exp2) {
    const ref = String(e.receipt_url || '');
    if (!/^stored_files:/.test(ref)) continue;              // justificatif stocké par l'application : joint à l'archive
    const buf = await files.read(ref).catch(swallow('monthly_archive:lecture-fichier', null));
    if (buf && buf.length) {
      const ext = (ref.split('.').pop() || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
      out.push({ path: `${A.FOLDERS.expenses}/Justificatifs/Depense_${e.d}_${A.slug(e.category)}_${e.id}.${ext}`, rows: 1, description: `Justificatif de la dépense n° ${e.id} (${e.category}, ${e.d})`, sources: 'expenses.receipt_url, stored_files', data: buf });
    }
  }
  const missing = exp2.filter(e => !e.receipt_url).length;
  if (missing) notes.push(`${missing} dépense(s) sans justificatif enregistré dans l'application.`);
  return { files: out, notes };
}

/* ------------------------------------------------------------------ */
/* 05 — Rapports transactions tiers                                    */
/* ------------------------------------------------------------------ */
async function buildThirds(ctx) {
  const { sid, R, b } = ctx, P = [sid, R.from, R.to];
  const [cust, inv, sup, balC, balS] = await Promise.all([
    q(`SELECT cp.paid_at, c.name AS customer, cp.amount::float AS amount, cp.method, cp.sale_id, cp.due_date::text AS due_date, COALESCE(u.login, '') AS login
         FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id LEFT JOIN users u ON u.id = cp.created_by
        WHERE c.station_id = $1 AND cp.paid_at >= $2::date AND cp.paid_at < $3::date + 1 ORDER BY cp.paid_at, cp.id`, P),
    q(`SELECT ip.paid_at, i.invoice_no, c.name AS customer, ip.amount::float AS amount, ip.method, COALESCE(ip.reference, '') AS reference
         FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
        WHERE ip.station_id = $1 AND ip.paid_at >= $2::date AND ip.paid_at < $3::date + 1 ORDER BY ip.paid_at, ip.id`, P),
    q(`SELECT sp.paid_at, su.name AS supplier, pu.order_no, pu.invoice_no, sp.amount::float AS amount, sp.method
         FROM supplier_payments sp JOIN suppliers su ON su.id = sp.supplier_id LEFT JOIN purchases pu ON pu.id = sp.purchase_id
        WHERE su.station_id = $1 AND sp.paid_at >= $2::date AND sp.paid_at < $3::date + 1 ORDER BY sp.paid_at, sp.id`, P),
    q(`SELECT c.name, c.balance::float AS balance,
              COALESCE((SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.paid_at >= $2::date AND cp.paid_at < $3::date + 1), 0)::float AS collected
         FROM customers c WHERE c.station_id = $1 AND c.deleted_at IS NULL AND (c.balance <> 0 OR EXISTS (SELECT 1 FROM customer_payments cp WHERE cp.customer_id = c.id AND cp.paid_at >= $2::date AND cp.paid_at < $3::date + 1))
        ORDER BY c.balance DESC, c.name`, P),
    q(`SELECT s.name, s.balance_due::float AS balance,
              COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.supplier_id = s.id AND sp.paid_at >= $2::date AND sp.paid_at < $3::date + 1), 0)::float AS paid
         FROM suppliers s WHERE s.station_id = $1 AND s.deleted_at IS NULL AND (s.balance_due <> 0 OR EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.supplier_id = s.id AND sp.paid_at >= $2::date AND sp.paid_at < $3::date + 1))
        ORDER BY s.balance_due DESC, s.name`, P)
  ]);
  const rows = cust.length + inv.length + sup.length;
  return { notes: [], files: [{
    path: `${A.FOLDERS.thirds}/Transactions_tiers_${ctx.month}.pdf`, rows, description: 'Encaissements clients, règlements de factures clients, règlements fournisseurs et soldes des tiers',
    sources: 'customer_payments, invoice_payments, supplier_payments, customers, suppliers, invoices, purchases',
    data: await sheetsPdf({ b, title: 'Transactions avec les tiers', subtitle: A.monthLabel(ctx.month), ref: ctx.month, sheets: [
      { name: 'Encaissements clients', head: ['Date', 'Client', 'Montant', 'Mode', 'Vente liée', 'Échéance', 'Saisi par'], rows: cust.map(x => [x.paid_at, x.customer, x.amount, mLabel(x.method), x.sale_id || '', x.due_date || '', x.login]), sumCols: [2] },
      { name: 'Paiements factures clients', head: ['Date', 'N° facture', 'Client', 'Montant', 'Mode', 'Référence'], rows: inv.map(x => [x.paid_at, x.invoice_no, x.customer || '', x.amount, mLabel(x.method), x.reference]), sumCols: [3] },
      { name: 'Règlements fournisseurs', head: ['Date', 'Fournisseur', 'N° commande', 'N° facture', 'Montant', 'Mode'], rows: sup.map(x => [x.paid_at, x.supplier, x.order_no || '', x.invoice_no || '', x.amount, mLabel(x.method)]), sumCols: [4] },
      { name: 'Soldes clients', head: ['Client', 'Encaissé dans le mois', 'Solde dû (à la génération)'], rows: balC.map(x => [x.name, x.collected, x.balance]), sumCols: [1, 2], notes: ['Solde = customers.balance à la date de génération de l\'archive.'] },
      { name: 'Soldes fournisseurs', head: ['Fournisseur', 'Réglé dans le mois', 'Dette (à la génération)'], rows: balS.map(x => [x.name, x.paid, x.balance]), sumCols: [1, 2], notes: ['Dette = suppliers.balance_due à la date de génération de l\'archive.'] }] })
  }] };
}

/* ------------------------------------------------------------------ */
/* 06 — Rapports divers (CA, ventes, stock)                            */
/* ------------------------------------------------------------------ */
async function buildMisc(ctx) {
  const { sid, R, b } = ctx, P = [sid, R.from, R.to];
  const [rev, canc, prods, fuel, methods, moves, gauging] = await Promise.all([
    q(REVENUE_BY_DAY, P),
    q(`SELECT sold_at::date::text AS d, COUNT(*)::int AS n FROM sales WHERE station_id = $1 AND status = 'annule' AND sold_at >= $2::date AND sold_at < $3::date + 1 GROUP BY 1`, P),
    q(`SELECT p.name, cat.label AS category, SUM(d.quantity)::float AS qty, SUM(d.amount)::float AS ttc,
              SUM(CASE WHEN d.tax_rate > 0 THEN d.amount / (1 + d.tax_rate / 100.0) ELSE d.amount END)::float AS ht
         FROM sale_details d JOIN sales sa ON sa.id = d.sale_id JOIN products p ON p.id = d.product_id JOIN categories cat ON cat.id = p.category_id
        WHERE sa.station_id = $1 AND sa.status = 'valide' AND sa.kind = 'produits' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
        GROUP BY p.name, cat.label ORDER BY ttc DESC`, P),
    q(`SELECT p.name, SUM(m.liters)::float AS liters, SUM(m.amount)::float AS ttc,
              SUM(CASE WHEN COALESCE(p.tax_rate, 0) > 0 THEN m.amount / (1 + p.tax_rate / 100.0) ELSE m.amount END)::float AS ht
         FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id JOIN products p ON p.id = m.product_id
        WHERE sh.station_id = $1 AND sh.status = 'ferme' AND m.amount IS NOT NULL AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
        GROUP BY p.name ORDER BY ttc DESC`, P),
    q(`SELECT pm.method, SUM(pm.amount)::float AS amount, COUNT(*)::int AS n FROM payments pm LEFT JOIN sales sa ON sa.id = pm.sale_id
        WHERE pm.station_id = $1 AND (pm.sale_id IS NULL OR sa.status = 'valide') AND pm.paid_at >= $2::date AND pm.paid_at < $3::date + 1 GROUP BY pm.method ORDER BY amount DESC`, P),
    q(`SELECT p.name, sm.kind, SUM(sm.quantity)::float AS qty, COUNT(*)::int AS n FROM stock_movements sm JOIN products p ON p.id = sm.product_id
        WHERE sm.station_id = $1 AND sm.created_at >= $2::date AND sm.created_at < $3::date + 1 GROUP BY p.name, sm.kind ORDER BY p.name, sm.kind`, P),
    q(`SELECT sh.number, sh.closed_at, p.name, sc.opening_stock::float AS opening, sc.theoretical::float AS theo, sc.physical::float AS phys, sc.gap::float AS gap
         FROM shift_stock_counts sc JOIN shifts sh ON sh.id = sc.shift_id JOIN products p ON p.id = sc.product_id JOIN categories cat ON cat.id = p.category_id
        WHERE sh.station_id = $1 AND sh.status = 'ferme' AND cat.code = 'CARBURANT' AND sc.gap IS NOT NULL AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
        ORDER BY sh.closed_at, p.name`, P)
  ]);
  const revBy = keyBy(rev, 'd'), cancBy = new Map(canc.map(x => [x.d, x.n]));
  const src = (d, s) => (revBy.get(d) || []).filter(x => x.src === s).reduce((a, x) => a + n(x.amt), 0);
  const dayRows = [...revBy.keys()].sort().map(d => [d, src(d, 'produits'), src(d, 'carburant'), src(d, 'carburant_ouvert'), src(d, 'produits') + src(d, 'carburant') + src(d, 'carburant_ouvert'), cancBy.get(d) || 0]);
  const extra = (await Promise.all([
    datasetPdf(ctx, 'sales', `${A.FOLDERS.misc}/Ventes_${ctx.month}.pdf`, 'Liste des ventes du mois (export PDF Ventes)'),
    datasetPdf(ctx, 'shifts', `${A.FOLDERS.misc}/Quarts_${ctx.month}.pdf`, 'Quarts du mois et écarts de caisse (export PDF Quarts)'),
    datasetPdf(ctx, 'cash', `${A.FOLDERS.misc}/Caisse_${ctx.month}.pdf`, 'Mouvements de caisse du mois (export PDF Caisse)'),
    datasetPdf(ctx, 'stock', `${A.FOLDERS.misc}/Stock_a_la_generation_${ctx.month}.pdf`, 'État du stock à la date de génération de l\'archive (export PDF Stocks)')
  ])).filter(Boolean);
  return { notes: [], files: [...extra,
    { path: `${A.FOLDERS.misc}/CA_et_ventes_${ctx.month}.pdf`, rows: dayRows.length + prods.length + fuel.length + methods.length,
      description: 'Chiffre d\'affaires par jour, ventes par produit, carburant par produit, encaissements par mode de paiement',
      sources: 'sales, sale_details, meter_readings, payments, products, categories',
      data: await sheetsPdf({ b, title: 'Chiffre d\'affaires et ventes', subtitle: A.monthLabel(ctx.month), ref: ctx.month, sheets: [
        { name: 'CA par jour', head: ['Date', 'Ventes produits', 'Carburant (compteurs)', 'Carburant (quart ouvert)', 'CA TTC', 'Ventes annulées'], rows: dayRows, sumCols: [1, 2, 3, 4, 5], notes: ['Définition du tableau de bord ; carburant des compteurs rattaché au jour de clôture du quart.'] },
        { name: 'Ventes produits', head: ['Produit', 'Catégorie', 'Quantité', 'CA TTC', 'CA HT'], rows: prods.map(x => [x.name, x.category, x.qty, x.ttc, Math.round(x.ht * 100) / 100]), sumCols: [3, 4] },
        { name: 'Carburant', head: ['Produit', 'Litres', 'CA TTC', 'CA HT'], rows: fuel.map(x => [x.name, x.liters, x.ttc, Math.round(x.ht * 100) / 100]), sumCols: [1, 2, 3], notes: ['HT calculé avec le taux de TVA actuel du produit (les compteurs ne figent pas le taux).'] },
        { name: 'Modes de paiement', head: ['Mode', 'Opérations', 'Montant'], rows: methods.map(x => [mLabel(x.method), x.n, x.amount]), sumCols: [1, 2] }] }) },
    { path: `${A.FOLDERS.misc}/Mouvements_stock_et_jaugeage_${ctx.month}.pdf`, rows: moves.length + gauging.length,
      description: 'Mouvements de stock du mois et écarts de jaugeage des quarts clos',
      sources: 'products, stock, stock_movements, shift_stock_counts, shifts',
      data: await sheetsPdf({ b, title: 'Stock', subtitle: A.monthLabel(ctx.month), ref: ctx.month, sheets: [
        { name: 'Mouvements du mois', head: ['Produit', 'Type', 'Quantité (signée)', 'Mouvements'], rows: moves.map(x => [x.name, x.kind, x.qty, x.n]) },
        { name: 'Jaugeage', head: ['Quart', 'Clôture', 'Carburant', 'Stock ouverture', 'Théorique', 'Physique', 'Écart (L)'], rows: gauging.map(x => [x.number, x.closed_at, x.name, x.opening, x.theo, x.phys, x.gap]), sumCols: [6], notes: ['Écart = stock physique − stock théorique (positif = gain, négatif = perte).'] }] }) }
  ] };
}

const BUILDERS = { days: buildDays, purchases: buildPurchases, customers: buildCustomerInvoices, expenses: buildExpenses, thirds: buildThirds, misc: buildMisc };

function parseMonth(req) {
  const month = String(req.query.month || '');
  if (!A.isMonth(month)) throw new HttpError(400, 'Mois invalide : format AAAA-MM attendu.');
  return month;
}

r.get('/exports/archive/monthly/summary', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const month = parseMonth(req), R = A.monthRange(month), access = folderAccess(req), P = [req.sid, R.from, R.to];
  const one = async sql => (await q(sql, P))[0].n;
  const counts = {
    days: access.days ? await one(`SELECT COUNT(DISTINCT d)::int AS n FROM (SELECT shift_date AS d FROM shifts WHERE station_id = $1 AND status IN ('ouvert','ferme') AND shift_date >= $2::date AND shift_date <= $3::date UNION SELECT sold_at::date FROM sales WHERE station_id = $1 AND sold_at >= $2::date AND sold_at < $3::date + 1) x`) : null,
    purchases: access.purchases ? await one(`SELECT COUNT(*)::int AS n FROM purchases WHERE station_id = $1 AND status <> 'annule' AND ((ordered_at >= $2::date AND ordered_at < $3::date + 1) OR (invoice_date >= $2::date AND invoice_date <= $3::date) OR (received_at >= $2::date AND received_at < $3::date + 1))`) : null,
    customers: access.customers ? await one(`SELECT COUNT(*)::int AS n FROM invoices WHERE station_id = $1 AND status <> 'brouillon' AND issued_on >= $2::date AND issued_on <= $3::date`) : null,
    expenses: access.expenses ? await one(`SELECT COUNT(*)::int AS n FROM expenses WHERE station_id = $1 AND deleted_at IS NULL AND spent_on >= $2::date AND spent_on <= $3::date`) : null,
    thirds: access.thirds ? await one(`SELECT ((SELECT COUNT(*) FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id WHERE c.station_id = $1 AND cp.paid_at >= $2::date AND cp.paid_at < $3::date + 1)
        + (SELECT COUNT(*) FROM invoice_payments WHERE station_id = $1 AND paid_at >= $2::date AND paid_at < $3::date + 1)
        + (SELECT COUNT(*) FROM supplier_payments sp JOIN suppliers su ON su.id = sp.supplier_id WHERE su.station_id = $1 AND sp.paid_at >= $2::date AND sp.paid_at < $3::date + 1))::int AS n`) : null,
    misc: access.misc ? 2 + ['sales', 'shifts', 'cash', 'stock'].filter(k => exp.allowed(req, exp.KINDS[k])).length : null
  };
  const unit = { days: 'journée(s)', purchases: 'achat(s)', customers: 'facture(s)', expenses: 'dépense(s)', thirds: 'transaction(s)', misc: 'fichier(s) PDF' };
  const { rows: [st] } = await pool.query('SELECT name FROM stations WHERE id = $1', [req.sid]);
  res.set('Cache-Control', 'no-store').json({
    month, label: A.monthLabel(month), station: st ? st.name : null,
    folders: Object.keys(A.FOLDERS).map(k => ({ key: k, folder: A.FOLDERS[k], label: A.FOLDER_LABELS[k], available: !!access[k], count: counts[k], unit: unit[k] }))
  });
}));

r.get('/exports/archive/monthly', need('report.view', 'finance.view'), wrap(async (req, res) => {
  const month = parseMonth(req), R = A.monthRange(month), access = folderAccess(req);
  const allowed = Object.keys(A.FOLDERS).filter(k => access[k]);
  if (!allowed.length) throw new HttpError(403, 'Aucun dossier d\'archive n\'est accessible avec vos droits.');
  const lock = String(req.user.id);
  if (RUNNING.has(lock)) throw new HttpError(429, 'Une archive est déjà en cours de génération pour votre compte.');
  RUNNING.add(lock);
  try {
    const b = await docs.branding(req.sid);
    const ctx = { req, sid: req.sid, month, R, b, deadline: Date.now() + BUDGET_MS };
    const entries = [], folderInfo = [], truncated = [];
    for (const k of allowed) {
      const built = await BUILDERS[k](ctx);
      entries.push(...built.files);
      folderInfo.push({ folder: A.FOLDERS[k], label: A.FOLDER_LABELS[k], files: built.files.length, note: built.notes.length ? 'voir limites' : '' });
      truncated.push(...built.notes.map(t => `${A.FOLDER_LABELS[k]} : ${t}`));
    }
    const skipped = Object.keys(A.FOLDERS).filter(k => !access[k]).map(k => `${A.FOLDER_LABELS[k]} : non inclus (droits ou module du contrat).`);
    const readme = A.readme({ station: b.name, currency: b.currency, month, generatedAt: new Date().toLocaleString('fr-FR'), by: req.user.login || String(req.user.id), folders: folderInfo, truncated: [...truncated, ...skipped] });
    const all = [
      { name: 'LISEZ-MOI.txt', data: Buffer.from(readme, 'utf8') },
      { name: 'INDEX_ARCHIVE.csv', data: Buffer.from(A.manifestCsv(entries), 'utf8') },
      ...entries.map(e => ({ name: e.path, data: e.data }))
    ];
    const zip = createZip(all);
    await audit(pool, req, 'exports', `Archive mensuelle ${month} téléchargée`, 'stations', req.sid, null, { month, fichiers: all.length, dossiers: allowed, octets: zip.length }).catch(() => {});
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Archive_${A.slug(b.name)}_${month}.zip"`,
      'Cache-Control': 'no-store'
    }).send(zip);
  } finally { RUNNING.delete(lock); }
}));

module.exports = { r, folderAccess };
