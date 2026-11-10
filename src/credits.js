'use strict';
// Imputation automatique des avoirs (client et fournisseur).
// Ce module était vide dans la livraison d'origine : les routes /credits/apply et la facturation fournisseur plantaient.
// Les deux fonctions doivent être appelées DANS une transaction (db = client pg de tx()).
const { ledger, HttpError } = require('./core');

const fl2 = n => Math.round(Number(n) * 100) / 100;

// Avoirs client : imputés sur la créance globale du client (hors factures liées à une vente ou à la flotte,
// qui se règlent par l'imputation manuelle /credits/impute). Écrit customer_ledger (kind='avoir') et l'historique.
async function applyCustomerCredits(db, { station, customerId, by }) {
  const { rows: [cu] } = await db.query(
    'SELECT id, balance FROM customers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [customerId, station]);
  if (!cu) throw new HttpError(404, 'Client introuvable');
  const { rows: [cov] } = await db.query(
    `SELECT COALESCE(SUM(total_ttc - amount_paid),0) AS v FROM invoices
      WHERE station_id=$1 AND customer_id=$2 AND status IN ('emise','partielle') AND total_ttc - amount_paid > 0.004
        AND (sale_id IS NOT NULL OR source = 'fleet')`, [station, customerId]);
  const globalDebt = Math.max(0, fl2(Number(cu.balance) - Number(cov.v)));
  const { rows: credits } = await db.query(
    `SELECT id, remaining FROM customer_credits
      WHERE station_id=$1 AND customer_id=$2 AND status='ouvert' AND remaining > 0 ORDER BY id FOR UPDATE`, [station, customerId]);
  const available = fl2(credits.reduce((a, c) => a + Number(c.remaining), 0));
  let left = Math.min(available, globalDebt), applied = 0;
  for (const cr of credits) {
    if (left <= 0.004) break;
    const y = fl2(Math.min(Number(cr.remaining), left));
    const rem = fl2(Number(cr.remaining) - y);
    await db.query('UPDATE customer_credits SET remaining=$2, status=$3 WHERE id=$1 AND station_id=$4',
      [cr.id, rem, rem <= 0.004 ? 'utilise' : 'ouvert', station]);
    await db.query(
      `INSERT INTO customer_credit_applications(station_id, customer_id, credit_id, invoice_id, amount, reason, created_by)
       VALUES ($1,$2,$3,NULL,$4,'Imputation automatique',$5)`, [station, customerId, cr.id, y, by || null]);
    await ledger(db, { customer: customerId, station, kind: 'avoir', amount: -y, ref: ['customer_credits', cr.id], by: by || null });
    left = fl2(left - y); applied = fl2(applied + y);
  }
  if (applied > 0) await db.query('UPDATE customers SET balance = balance - $2 WHERE id=$1 AND station_id=$3', [customerId, applied, station]);
  return { applied, credits_left: fl2(available - applied) };
}

// Avoirs fournisseur : imputés sur les achats facturés non soldés (du plus ancien au plus récent),
// tracés dans supplier_payments (method='avoir'). Aucun mouvement de caisse.
async function applySupplierCredits(db, { station, supplierId, by }) {
  const { rows: [sp] } = await db.query(
    'SELECT id FROM suppliers WHERE id=$1 AND station_id=$2 AND deleted_at IS NULL FOR UPDATE', [supplierId, station]);
  if (!sp) throw new HttpError(404, 'Fournisseur introuvable');
  const { rows: credits } = await db.query(
    `SELECT id, remaining FROM supplier_credits
      WHERE station_id=$1 AND supplier_id=$2 AND status='ouvert' AND remaining > 0 ORDER BY id FOR UPDATE`, [station, supplierId]);
  const available = fl2(credits.reduce((a, c) => a + Number(c.remaining), 0));
  if (available <= 0.004) return { applied: 0, credits_left: 0 };
  const { rows: invs } = await db.query(
    `SELECT id, invoice_total, paid FROM purchases
      WHERE station_id=$1 AND supplier_id=$2 AND status='facture' AND invoice_total - paid > 0.004
      ORDER BY COALESCE(invoice_date, ordered_at::date), id FOR UPDATE`, [station, supplierId]);
  let applied = 0, ci = 0, crLeft = credits.length ? Number(credits[0].remaining) : 0;
  const used = new Map();   // credit id -> montant consommé
  for (const inv of invs) {
    let due = fl2(Number(inv.invoice_total) - Number(inv.paid)), take = 0;
    while (due > 0.004 && ci < credits.length) {
      const y = fl2(Math.min(crLeft, due));
      used.set(credits[ci].id, fl2((used.get(credits[ci].id) || 0) + y));
      take = fl2(take + y); due = fl2(due - y); crLeft = fl2(crLeft - y);
      if (crLeft <= 0.004) { ci++; crLeft = ci < credits.length ? Number(credits[ci].remaining) : 0; }
    }
    if (take > 0) {
      await db.query('INSERT INTO supplier_payments(supplier_id, purchase_id, amount, method, created_by) VALUES ($1,$2,$3,$4,$5)',
        [supplierId, inv.id, take, 'avoir', by || null]);
      const paid = fl2(Number(inv.paid) + take);
      await db.query('UPDATE purchases SET paid=$2, status=$3 WHERE id=$1 AND station_id=$4',
        [inv.id, paid, paid >= Number(inv.invoice_total) - 0.004 ? 'paye' : 'facture', station]);
      applied = fl2(applied + take);
    }
    if (ci >= credits.length) break;
  }
  for (const cr of credits) {
    const y = used.get(cr.id) || 0;
    if (!y) continue;
    const rem = fl2(Number(cr.remaining) - y);
    await db.query('UPDATE supplier_credits SET remaining=$2, status=$3 WHERE id=$1 AND station_id=$4',
      [cr.id, rem, rem <= 0.004 ? 'utilise' : 'ouvert', station]);
  }
  if (applied > 0) await db.query('UPDATE suppliers SET balance_due = balance_due - $2 WHERE id=$1 AND station_id=$3', [supplierId, applied, station]);
  return { applied, credits_left: fl2(available - applied) };
}

module.exports = { applyCustomerCredits, applySupplierCredits };
