// Agrégats complémentaires des tableaux de bord (tableau de bord, Vue consolidée, Vue par station) — lecture seule.
// RÈGLE : chaque indicateur du CATALOGUE porte sa formule et la liste des tables/colonnes d'où il provient ;
// la réponse renvoie ce catalogue, l'interface l'affiche sous chaque valeur (« Source ») et dans les PDF.
// Aucune valeur n'est posée sans origine : tout vient des requêtes SQL ci-dessous (une par domaine).
// Périmètre : stations accessibles (user_stations ∩ actives ∩ même client), droits et plafonds de station respectés
// (mêmes « domaines » que la Vue consolidée : sales, customers, suppliers, stock, finance, ops).
const express = require('express');
const { pool, wrap, need, HttpError } = require('./core');
const mv = require('./multistation_views');
const L = require('./station_views_logic');

const r = express.Router();
const ENTRY = ['user.manage', 'report.view', 'finance.view'];
const num = v => Number(v) || 0;
const div = (a, b) => (num(b) > 0 ? num(a) / num(b) : null);

/* ------------------------------------------------------------------------------------------------
 * CATALOGUE : key, domaine (droit requis), groupe, libellé, unité, flow (variable dans le temps → comparée à la
 * période précédente ; sinon situation « à ce jour »), good (sens favorable de la variation), formule, sources, calcul.
 * D = valeurs brutes du domaine (sommées sur les stations visibles) ; ctx.days = durée de la période en jours.
 * ---------------------------------------------------------------------------------------------- */
const S_CA = ['sales.total (kind = produits, status = valide)', 'meter_readings.amount (quarts clos : shifts.closed_at)', 'sales.total carburant (quarts encore ouverts)'];
const S_PAY = ['payments.amount (method), rattachés à des ventes valides ou à la clôture de quart'];
const CATALOG = [
  // ---- Ventes & encaissements (sales)
  { key: 'ca_ttc', domain: 'sales', group: 'Ventes et encaissements', label: 'CA TTC de la période', unit: 'money', flow: true, good: 'up', formula: 'Boutique + carburant + factures libres hors vente (même définition que le tableau de bord)', sources: [...S_CA, 'invoices.unlinked_amount (source = libre, status émise/partielle/payée)'], get: D => D.shop_total + D.fuel_total + D.inv_revenue },
  { key: 'inv_revenue', domain: 'sales', group: 'Ventes et encaissements', label: 'Factures libres comptées au CA', unit: 'money', flow: true, good: 'up', formula: 'Part des factures libres émises non portée par une vente (services, factures hors quart)', sources: ['invoices.unlinked_amount (source = libre, status émise/partielle/payée ; issued_on)'], get: D => D.inv_revenue },
  { key: 'shop_ttc', domain: 'sales', group: 'Ventes et encaissements', label: 'Ventes boutique / produits', unit: 'money', flow: true, good: 'up', formula: 'Somme des ventes valides de type « produits »', sources: ['sales.total (kind = produits, status = valide)'], get: D => D.shop_total },
  { key: 'fuel_ttc', domain: 'sales', group: 'Ventes et encaissements', label: 'Ventes carburant', unit: 'money', flow: true, good: 'up', formula: 'Compteurs des quarts clos + carburant déclaré des quarts ouverts', sources: S_CA.slice(1), get: D => D.fuel_total },
  { key: 'shop_share_pct', domain: 'sales', group: 'Ventes et encaissements', label: 'Part boutique dans le CA', unit: 'pct', flow: true, good: null, formula: 'Ventes boutique ÷ CA TTC × 100', sources: S_CA, get: D => { const t = D.shop_total + D.fuel_total; return t > 0 ? (D.shop_total / t) * 100 : null; } },
  { key: 'tx_n', domain: 'sales', group: 'Ventes et encaissements', label: 'Nombre de transactions', unit: 'count', flow: true, good: 'up', formula: 'Nombre de ventes valides de la période', sources: ['sales.id (status = valide, sold_at)'], get: D => D.tx_n },
  { key: 'avg_basket', domain: 'sales', group: 'Ventes et encaissements', label: 'Panier moyen', unit: 'money', flow: true, good: 'up', formula: 'Total des ventes valides ÷ nombre de transactions', sources: ['sales.total', 'sales.id (status = valide)'], get: D => div(D.sales_total, D.tx_n) },
  { key: 'avg_daily_ca', domain: 'sales', group: 'Ventes et encaissements', label: 'CA TTC moyen par jour', unit: 'money', flow: true, good: 'up', formula: 'CA TTC ÷ nombre de jours de la période', sources: S_CA, get: (D, c) => div(D.shop_total + D.fuel_total, c.days) },
  { key: 'liters', domain: 'sales', group: 'Ventes et encaissements', label: 'Litres vendus (compteurs)', unit: 'liters', flow: true, good: 'up', formula: 'Somme des litres des compteurs des quarts clos', sources: ['meter_readings.liters (= index_end − index_start), quarts clos'], get: D => D.liters },
  { key: 'liters_day', domain: 'sales', group: 'Ventes et encaissements', label: 'Litres moyens par jour', unit: 'liters', flow: true, good: 'up', formula: 'Litres vendus ÷ nombre de jours', sources: ['meter_readings.liters'], get: (D, c) => div(D.liters, c.days) },
  { key: 'cancel_n', domain: 'sales', group: 'Ventes et encaissements', label: 'Ventes annulées', unit: 'count', flow: true, good: 'down', formula: 'Nombre de ventes au statut « annulé »', sources: ['sales.id (status = annule, sold_at)'], get: D => D.cancel_n },
  { key: 'cancel_total', domain: 'sales', group: 'Ventes et encaissements', label: 'Montant des ventes annulées', unit: 'money', flow: true, good: 'down', formula: 'Somme des ventes au statut « annulé »', sources: ['sales.total (status = annule)'], get: D => D.cancel_total },
  { key: 'cancel_rate_pct', domain: 'sales', group: 'Ventes et encaissements', label: "Taux d'annulation", unit: 'pct', flow: true, good: 'down', formula: 'Ventes annulées ÷ (ventes valides + annulées) × 100', sources: ['sales.id (status = valide | annule)'], get: D => (D.tx_n + D.cancel_n > 0 ? (D.cancel_n / (D.tx_n + D.cancel_n)) * 100 : null) },
  { key: 'pay_especes', domain: 'sales', group: 'Modes de paiement', label: 'Encaissé en espèces', unit: 'money', flow: true, good: null, formula: 'Paiements au mode « espèces »', sources: S_PAY, get: D => D.pay_especes },
  { key: 'pay_carte', domain: 'sales', group: 'Modes de paiement', label: 'Encaissé par carte', unit: 'money', flow: true, good: null, formula: 'Paiements au mode « carte »', sources: S_PAY, get: D => D.pay_carte },
  { key: 'pay_mobile_money', domain: 'sales', group: 'Modes de paiement', label: 'Encaissé en mobile money', unit: 'money', flow: true, good: null, formula: 'Paiements au mode « mobile_money »', sources: S_PAY, get: D => D.pay_mobile_money },
  { key: 'pay_credit', domain: 'sales', group: 'Modes de paiement', label: 'Ventes à crédit', unit: 'money', flow: true, good: null, formula: 'Paiements au mode « crédit » (créances générées)', sources: S_PAY, get: D => D.pay_credit },
  { key: 'pay_autre', domain: 'sales', group: 'Modes de paiement', label: 'Autres modes de paiement', unit: 'money', flow: true, good: null, formula: 'Paiements au mode « autre »', sources: S_PAY, get: D => D.pay_autre },
  { key: 'credit_share_pct', domain: 'sales', group: 'Modes de paiement', label: 'Part des ventes à crédit', unit: 'pct', flow: true, good: 'down', formula: 'Crédit ÷ total des paiements × 100', sources: S_PAY, get: D => { const t = D.pay_especes + D.pay_carte + D.pay_mobile_money + D.pay_credit + D.pay_autre; return t > 0 ? (D.pay_credit / t) * 100 : null; } },
  { key: 'margin_ht', domain: 'sales', group: 'Marge', label: 'Marge brute (lignes avec coût)', unit: 'money', flow: true, good: 'up', formula: 'Σ (montant HT − coût unitaire × quantité) des lignes dont le coût est renseigné', sources: ['sale_details.amount, tax_rate, unit_cost, quantity (unit_cost > 0)', 'sales.status = valide'], get: D => (D.cost_lines > 0 ? D.margin_ht : null) },
  { key: 'margin_pct', domain: 'sales', group: 'Marge', label: 'Taux de marge brute', unit: 'pct', flow: true, good: 'up', formula: 'Marge brute ÷ montant HT des mêmes lignes × 100', sources: ['sale_details.amount, tax_rate, unit_cost, quantity (unit_cost > 0)'], get: D => (D.cost_lines > 0 && D.margin_base_ht > 0 ? (D.margin_ht / D.margin_base_ht) * 100 : null) },
  { key: 'cost_coverage_pct', domain: 'sales', group: 'Marge', label: 'Lignes de vente avec coût renseigné', unit: 'pct', flow: true, good: 'up', formula: 'Lignes avec unit_cost > 0 ÷ lignes de vente × 100 (fiabilité de la marge)', sources: ['sale_details.unit_cost'], get: D => (D.lines > 0 ? (D.cost_lines / D.lines) * 100 : null) },
  // ---- Exploitation (ops)
  { key: 'shifts_closed', domain: 'ops', group: 'Exploitation', label: 'Quarts clos', unit: 'count', flow: true, good: null, formula: 'Quarts au statut « fermé » par date de quart', sources: ['shifts.id (status = ferme, shift_date)'], get: D => D.shifts_closed },
  { key: 'shifts_open', domain: 'ops', group: 'Exploitation', label: 'Quarts ouverts', unit: 'count', flow: true, good: null, formula: 'Quarts au statut « ouvert » par date de quart', sources: ['shifts.id (status = ouvert, shift_date)'], get: D => D.shifts_open },
  { key: 'shift_avg_h', domain: 'ops', group: 'Exploitation', label: 'Durée moyenne des quarts', unit: 'hours', flow: true, good: null, formula: 'Moyenne de (clôture − ouverture) des quarts clos', sources: ['shifts.opened_at, shifts.closed_at'], get: D => div(D.shift_hours, D.shift_hours_n) },
  { key: 'cash_gap_net', domain: 'ops', group: 'Exploitation', label: 'Écart de caisse net', unit: 'money', flow: true, good: null, formula: 'Σ des écarts de caisse des quarts clos (signé)', sources: ['shifts.cash_gap (status = ferme)'], get: D => D.cash_gap_net },
  { key: 'cash_gap_abs', domain: 'ops', group: 'Exploitation', label: 'Écarts de caisse cumulés (valeur absolue)', unit: 'money', flow: true, good: 'down', formula: 'Σ |écart de caisse| des quarts clos', sources: ['shifts.cash_gap (status = ferme)'], get: D => D.cash_gap_abs },
  { key: 'anomalies_n', domain: 'ops', group: 'Exploitation', label: 'Anomalies de quart', unit: 'count', flow: true, good: 'down', formula: 'Nombre d’anomalies (écart caisse, stock, compteur, autre)', sources: ['shift_anomalies.id (via shifts.shift_date)'], get: D => D.anomalies_n },
  // ---- Dépenses & flux (finance)
  { key: 'expenses_total', domain: 'finance', group: 'Dépenses et flux', label: 'Dépenses de la période', unit: 'money', flow: true, good: 'down', formula: 'Somme des dépenses non supprimées', sources: ['expenses.amount (deleted_at IS NULL, spent_on)'], get: D => D.expenses_total },
  { key: 'expenses_n', domain: 'finance', group: 'Dépenses et flux', label: 'Nombre de dépenses', unit: 'count', flow: true, good: null, formula: 'Nombre de dépenses non supprimées', sources: ['expenses.id (spent_on)'], get: D => D.expenses_n },
  { key: 'expenses_avg_day', domain: 'finance', group: 'Dépenses et flux', label: 'Dépenses moyennes par jour', unit: 'money', flow: true, good: 'down', formula: 'Dépenses ÷ nombre de jours', sources: ['expenses.amount'], get: (D, c) => div(D.expenses_total, c.days) },
  { key: 'supplier_paid', domain: 'finance', group: 'Dépenses et flux', label: 'Règlements fournisseurs', unit: 'money', flow: true, good: null, formula: 'Somme des règlements fournisseurs de la période', sources: ['supplier_payments.amount (paid_at) ⨝ suppliers.station_id'], get: D => D.supplier_paid },
  { key: 'customer_collected', domain: 'finance', group: 'Dépenses et flux', label: 'Créances clients encaissées', unit: 'money', flow: true, good: 'up', formula: 'Somme des règlements de clients de la période', sources: ['customer_payments.amount (paid_at) ⨝ customers.station_id'], get: D => D.customer_collected },
  // ---- Achats & fournisseurs (suppliers)
  { key: 'purchases_total', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Achats commandés', unit: 'money', flow: true, good: null, formula: 'Somme des commandes non annulées', sources: ['purchases.total (status ≠ annule, ordered_at)'], get: D => D.purchases_total },
  { key: 'purchases_n', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Nombre de commandes', unit: 'count', flow: true, good: null, formula: 'Commandes non annulées', sources: ['purchases.id (status ≠ annule, ordered_at)'], get: D => D.purchases_n },
  { key: 'purchases_avg', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Commande moyenne', unit: 'money', flow: true, good: null, formula: 'Achats commandés ÷ nombre de commandes', sources: ['purchases.total', 'purchases.id'], get: D => div(D.purchases_total, D.purchases_n) },
  { key: 'purchases_received_n', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Commandes reçues', unit: 'count', flow: true, good: 'up', formula: 'Statuts « reçu », « facturé » ou « payé »', sources: ['purchases.status IN (recu, facture, paye)'], get: D => D.purchases_received_n },
  { key: 'purchases_pending_n', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Commandes à réceptionner', unit: 'count', flow: true, good: 'down', formula: 'Statuts « commandé » ou « partiel »', sources: ['purchases.status IN (commande, partiel)'], get: D => D.purchases_pending_n },
  { key: 'reception_rate_pct', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Taux de réception', unit: 'pct', flow: true, good: 'up', formula: 'Commandes reçues ÷ commandes × 100', sources: ['purchases.status'], get: D => (D.purchases_n > 0 ? (D.purchases_received_n / D.purchases_n) * 100 : null) },
  { key: 'payables', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Dettes fournisseurs (à ce jour)', unit: 'money', flow: false, good: 'down', formula: 'Somme des soldes fournisseurs positifs', sources: ['suppliers.balance_due > 0 (deleted_at IS NULL)'], get: D => D.payables },
  { key: 'overdue_amount', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Factures fournisseurs échues (à ce jour)', unit: 'money', flow: false, good: 'down', formula: 'Σ (facturé − payé) des achats dont l’échéance est dépassée', sources: ['purchases.invoice_total, purchases.paid, purchases.due_date < aujourd’hui (status ≠ annule)'], get: D => D.overdue_amount },
  { key: 'overdue_n', domain: 'suppliers', group: 'Achats et fournisseurs', label: 'Nombre de factures échues (à ce jour)', unit: 'count', flow: false, good: 'down', formula: 'Achats avec reste à payer et échéance dépassée', sources: ['purchases.id (invoice_total − paid > 0, due_date < aujourd’hui)'], get: D => D.overdue_n },
  // ---- Clients (customers)
  { key: 'receivables', domain: 'customers', group: 'Clients', label: 'Créances clients (à ce jour)', unit: 'money', flow: false, good: 'down', formula: 'Somme des soldes clients positifs', sources: ['customers.balance > 0 (deleted_at IS NULL)'], get: D => D.receivables },
  { key: 'receivables_n', domain: 'customers', group: 'Clients', label: 'Clients débiteurs (à ce jour)', unit: 'count', flow: false, good: 'down', formula: 'Clients au solde positif', sources: ['customers.id (balance > 0)'], get: D => D.receivables_n },
  { key: 'over_limit_n', domain: 'customers', group: 'Clients', label: 'Clients au-delà de leur plafond (à ce jour)', unit: 'count', flow: false, good: 'down', formula: 'Clients dont le solde dépasse le plafond de crédit', sources: ['customers.balance > customers.credit_limit (credit_limit > 0)'], get: D => D.over_limit_n },
  // ---- Facturation clients (module Facturation : table invoices / invoice_payments) — rattaché au domaine « clients »
  { key: 'inv_issued_n', domain: 'customers', group: 'Facturation clients', label: 'Factures émises (période)', unit: 'count', flow: true, good: 'up', formula: 'Factures aux statuts émise, partielle ou payée, par date d’émission (annulées et brouillons exclus)', sources: ['invoices.id (status IN emise, partielle, payee ; COALESCE(issued_on, created_at))'], get: D => D.inv_issued_n },
  { key: 'inv_issued_total', domain: 'customers', group: 'Facturation clients', label: 'Montant facturé TTC (période)', unit: 'money', flow: true, good: 'up', formula: 'Σ total TTC des factures émises de la période (inclut les factures issues d’une vente : à ne pas additionner au CA)', sources: ['invoices.total_ttc (status IN emise, partielle, payee)'], get: D => D.inv_issued_total },
  { key: 'inv_collected', domain: 'customers', group: 'Facturation clients', label: 'Encaissé sur factures (période)', unit: 'money', flow: true, good: 'up', formula: 'Σ des paiements de factures de la période (entrés en caisse / sur compte)', sources: ['invoice_payments.amount (paid_at)'], get: D => D.inv_collected },
  { key: 'inv_open_n', domain: 'customers', group: 'Facturation clients', label: 'Factures à encaisser (à ce jour)', unit: 'count', flow: false, good: 'down', formula: 'Factures émises ou partiellement payées', sources: ['invoices.id (status IN emise, partielle)'], get: D => D.inv_open_n },
  { key: 'inv_due', domain: 'customers', group: 'Facturation clients', label: 'Reste à encaisser sur factures (à ce jour)', unit: 'money', flow: false, good: 'down', formula: 'Σ (total TTC − payé) des factures émises ou partielles', sources: ['invoices.total_ttc, invoices.amount_paid (status IN emise, partielle)'], get: D => D.inv_due },
  { key: 'inv_overdue_n', domain: 'customers', group: 'Facturation clients', label: 'Factures clients échues (à ce jour)', unit: 'count', flow: false, good: 'down', formula: 'Factures à encaisser dont l’échéance est dépassée', sources: ['invoices.id (status IN emise, partielle ; due_date < aujourd’hui)'], get: D => D.inv_overdue_n },
  { key: 'inv_overdue_total', domain: 'customers', group: 'Facturation clients', label: 'Montant des factures échues (à ce jour)', unit: 'money', flow: false, good: 'down', formula: 'Σ (total TTC − payé) des factures échues', sources: ['invoices.total_ttc, invoices.amount_paid, invoices.due_date'], get: D => D.inv_overdue_total },
  { key: 'inv_draft_n', domain: 'customers', group: 'Facturation clients', label: 'Factures en brouillon (à ce jour)', unit: 'count', flow: false, good: null, formula: 'Factures créées mais non émises', sources: ['invoices.id (status = brouillon)'], get: D => D.inv_draft_n },
  // ---- Stock (stock)
  { key: 'low_stock_n', domain: 'stock', group: 'Stock', label: 'Produits sous leur seuil mini (à ce jour)', unit: 'count', flow: false, good: 'down', formula: 'Produits actifs dont le stock ≤ seuil mini (> 0)', sources: ['stock.quantity', 'products.min_stock (active, deleted_at IS NULL)'], get: D => D.low_stock_n },
  { key: 'stock_value', domain: 'stock', group: 'Stock', label: 'Valeur du stock au prix d’achat (à ce jour)', unit: 'money', flow: false, good: null, formula: 'Σ quantité en stock × prix d’achat', sources: ['stock.quantity', 'products.buy_price (active, deleted_at IS NULL)'], get: D => D.stock_value }
];
const CATALOG_META = CATALOG.map(({ get, ...m }) => m);

/* ------------------------------------------------------------------------------------------------
 * REQUÊTES (une par domaine, regroupées par station) — bornes : $2 = début, $3 = fin (dates validées AAAA-MM-JJ)
 * ---------------------------------------------------------------------------------------------- */
const by = rows => { const m = new Map(); for (const x of rows) m.set(String(x.station_id), x); return m; };
const Q = (tag, sql, p) => pool.query(`/*agg:${tag}*/ ${sql}`, p).then(x => x.rows);

async function loadFlows(ids, a, b) {
  const p = [ids, a, b];
  const [sales, fuel, pay, margin, ops, anom, exp, sp, cp, pur, inv, invpay, invrev] = await Promise.all([
    Q('sales', `SELECT sa.station_id,
        COUNT(*) FILTER (WHERE sa.status = 'valide')::int AS tx_n,
        COALESCE(SUM(sa.total) FILTER (WHERE sa.status = 'valide'), 0)::float AS sales_total,
        COALESCE(SUM(sa.total) FILTER (WHERE sa.status = 'valide' AND sa.kind = 'produits'), 0)::float AS shop_total,
        COUNT(*) FILTER (WHERE sa.status = 'annule')::int AS cancel_n,
        COALESCE(SUM(sa.total) FILTER (WHERE sa.status = 'annule'), 0)::float AS cancel_total
       FROM sales sa WHERE sa.station_id = ANY($1::bigint[]) AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
      GROUP BY sa.station_id`, p),
    Q('fuel', `WITH f AS (
        SELECT sh.station_id, m.amount AS amt, m.liters AS lit FROM meter_readings m JOIN shifts sh ON sh.id = m.shift_id
         WHERE sh.station_id = ANY($1::bigint[]) AND sh.status = 'ferme' AND m.amount IS NOT NULL
           AND sh.closed_at >= $2::date AND sh.closed_at < $3::date + 1
        UNION ALL
        SELECT sa.station_id, sa.total, NULL::numeric FROM sales sa JOIN shifts sh ON sh.id = sa.shift_id
         WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.kind = 'carburant' AND sh.status = 'ouvert'
           AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1)
      SELECT station_id, COALESCE(SUM(amt), 0)::float AS fuel_total, COALESCE(SUM(lit), 0)::float AS liters FROM f GROUP BY station_id`, p),
    Q('pay', `SELECT pm.station_id,
        COALESCE(SUM(pm.amount) FILTER (WHERE pm.method = 'especes'), 0)::float AS pay_especes,
        COALESCE(SUM(pm.amount) FILTER (WHERE pm.method = 'carte'), 0)::float AS pay_carte,
        COALESCE(SUM(pm.amount) FILTER (WHERE pm.method = 'mobile_money'), 0)::float AS pay_mobile_money,
        COALESCE(SUM(pm.amount) FILTER (WHERE pm.method = 'credit'), 0)::float AS pay_credit,
        COALESCE(SUM(pm.amount) FILTER (WHERE pm.method = 'autre'), 0)::float AS pay_autre
       FROM payments pm LEFT JOIN sales sa ON sa.id = pm.sale_id
      WHERE pm.station_id = ANY($1::bigint[]) AND (pm.sale_id IS NULL OR sa.status = 'valide')
        AND pm.paid_at >= $2::date AND pm.paid_at < $3::date + 1
      GROUP BY pm.station_id`, p),
    Q('margin', `SELECT sa.station_id,
        COALESCE(SUM(d.amount / (1 + d.tax_rate / 100.0) - d.unit_cost * d.quantity) FILTER (WHERE d.unit_cost > 0), 0)::float AS margin_ht,
        COALESCE(SUM(d.amount / (1 + d.tax_rate / 100.0)) FILTER (WHERE d.unit_cost > 0), 0)::float AS margin_base_ht,
        COUNT(*) FILTER (WHERE d.unit_cost > 0)::int AS cost_lines, COUNT(*)::int AS lines
       FROM sales sa JOIN sale_details d ON d.sale_id = sa.id
      WHERE sa.station_id = ANY($1::bigint[]) AND sa.status = 'valide' AND sa.sold_at >= $2::date AND sa.sold_at < $3::date + 1
      GROUP BY sa.station_id`, p),
    Q('ops', `SELECT sh.station_id,
        COUNT(*) FILTER (WHERE sh.status = 'ferme')::int AS shifts_closed,
        COUNT(*) FILTER (WHERE sh.status = 'ouvert')::int AS shifts_open,
        COALESCE(SUM(sh.cash_gap) FILTER (WHERE sh.status = 'ferme'), 0)::float AS cash_gap_net,
        COALESCE(SUM(ABS(sh.cash_gap)) FILTER (WHERE sh.status = 'ferme'), 0)::float AS cash_gap_abs,
        COALESCE(SUM(EXTRACT(EPOCH FROM (sh.closed_at - sh.opened_at)) / 3600.0) FILTER (WHERE sh.status = 'ferme' AND sh.opened_at IS NOT NULL AND sh.closed_at IS NOT NULL), 0)::float AS shift_hours,
        COUNT(*) FILTER (WHERE sh.status = 'ferme' AND sh.opened_at IS NOT NULL AND sh.closed_at IS NOT NULL)::int AS shift_hours_n
       FROM shifts sh
      WHERE sh.station_id = ANY($1::bigint[]) AND sh.status IN ('ouvert', 'ferme') AND sh.shift_date >= $2::date AND sh.shift_date <= $3::date
      GROUP BY sh.station_id`, p),
    Q('anomalies', `SELECT sh.station_id, COUNT(*)::int AS anomalies_n
       FROM shift_anomalies an JOIN shifts sh ON sh.id = an.shift_id
      WHERE sh.station_id = ANY($1::bigint[]) AND sh.shift_date >= $2::date AND sh.shift_date <= $3::date
      GROUP BY sh.station_id`, p),
    Q('expenses', `SELECT station_id, COALESCE(SUM(amount), 0)::float AS expenses_total, COUNT(*)::int AS expenses_n
       FROM expenses WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL AND spent_on >= $2::date AND spent_on <= $3::date
      GROUP BY station_id`, p),
    Q('supplier_paid', `SELECT s.station_id, COALESCE(SUM(sp.amount), 0)::float AS supplier_paid
       FROM supplier_payments sp JOIN suppliers s ON s.id = sp.supplier_id
      WHERE s.station_id = ANY($1::bigint[]) AND sp.paid_at >= $2::date AND sp.paid_at < $3::date + 1
      GROUP BY s.station_id`, p),
    Q('customer_collected', `SELECT c.station_id, COALESCE(SUM(cp.amount), 0)::float AS customer_collected
       FROM customer_payments cp JOIN customers c ON c.id = cp.customer_id
      WHERE c.station_id = ANY($1::bigint[]) AND cp.paid_at >= $2::date AND cp.paid_at < $3::date + 1
      GROUP BY c.station_id`, p),
    Q('purchases', `SELECT pu.station_id,
        COALESCE(SUM(pu.total) FILTER (WHERE pu.status <> 'annule'), 0)::float AS purchases_total,
        COUNT(*) FILTER (WHERE pu.status <> 'annule')::int AS purchases_n,
        COUNT(*) FILTER (WHERE pu.status IN ('recu', 'facture', 'paye'))::int AS purchases_received_n,
        COUNT(*) FILTER (WHERE pu.status IN ('commande', 'partiel'))::int AS purchases_pending_n
       FROM purchases pu WHERE pu.station_id = ANY($1::bigint[]) AND pu.ordered_at >= $2::date AND pu.ordered_at < $3::date + 1
      GROUP BY pu.station_id`, p),
    // Facturation clients : tolérant (module/table absents → 0, le reste du tableau de bord n'est pas bloqué)
    Q('invoices', `SELECT i.station_id,
        COUNT(*) FILTER (WHERE i.status IN ('emise', 'partielle', 'payee'))::int AS inv_issued_n,
        COALESCE(SUM(i.total_ttc) FILTER (WHERE i.status IN ('emise', 'partielle', 'payee')), 0)::float AS inv_issued_total
       FROM invoices i WHERE i.station_id = ANY($1::bigint[])
        AND COALESCE(i.issued_on, i.created_at::date) >= $2::date AND COALESCE(i.issued_on, i.created_at::date) <= $3::date
      GROUP BY i.station_id`, p).catch(() => []),
    Q('invoice_payments', `SELECT ip.station_id, COALESCE(SUM(ip.amount), 0)::float AS inv_collected
       FROM invoice_payments ip WHERE ip.station_id = ANY($1::bigint[]) AND ip.paid_at >= $2::date AND ip.paid_at < $3::date + 1
      GROUP BY ip.station_id`, p).catch(() => []),
    Q('invoice_revenue', `SELECT station_id, COALESCE(SUM(unlinked_amount), 0)::float AS inv_revenue FROM invoices
       WHERE station_id = ANY($1::bigint[]) AND source = 'libre' AND status IN ('emise', 'partielle', 'payee')
         AND COALESCE(issued_on, created_at::date) >= $2::date AND COALESCE(issued_on, created_at::date) <= $3::date GROUP BY station_id`, p).catch(() => [])
  ]);
  return { sales: by(sales), fuel: by(fuel), pay: by(pay), margin: by(margin), ops: by(ops), anomalies: by(anom), expenses: by(exp), sp: by(sp), cp: by(cp), purchases: by(pur), inv: by(inv), invpay: by(invpay), invrev: by(invrev) };
}

/** Situation « à ce jour » (indépendante de la période). */
async function loadPoints(ids) {
  const p = [ids];
  const [pay, over, cust, low, invd] = await Promise.all([
    Q('payables', `SELECT station_id, COALESCE(SUM(balance_due) FILTER (WHERE balance_due > 0), 0)::float AS payables
       FROM suppliers WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL GROUP BY station_id`, p),
    Q('overdue', `SELECT station_id,
        COALESCE(SUM(invoice_total - paid) FILTER (WHERE invoice_total IS NOT NULL AND invoice_total - paid > 0 AND due_date < CURRENT_DATE), 0)::float AS overdue_amount,
        COUNT(*) FILTER (WHERE invoice_total IS NOT NULL AND invoice_total - paid > 0 AND due_date < CURRENT_DATE)::int AS overdue_n
       FROM purchases WHERE station_id = ANY($1::bigint[]) AND status <> 'annule' GROUP BY station_id`, p),
    Q('customers', `SELECT station_id,
        COALESCE(SUM(balance) FILTER (WHERE balance > 0), 0)::float AS receivables,
        COUNT(*) FILTER (WHERE balance > 0)::int AS receivables_n,
        COUNT(*) FILTER (WHERE credit_limit > 0 AND balance > credit_limit)::int AS over_limit_n
       FROM customers WHERE station_id = ANY($1::bigint[]) AND deleted_at IS NULL GROUP BY station_id`, p),
    Q('stock', `SELECT p.station_id,
        COUNT(*) FILTER (WHERE p.min_stock > 0 AND COALESCE(st.quantity, 0) <= p.min_stock)::int AS low_stock_n,
        COALESCE(SUM(COALESCE(st.quantity, 0) * p.buy_price), 0)::float AS stock_value
       FROM products p LEFT JOIN stock st ON st.product_id = p.id
      WHERE p.station_id = ANY($1::bigint[]) AND p.deleted_at IS NULL AND p.active GROUP BY p.station_id`, p),
    Q('invoices_due', `SELECT station_id,
        COUNT(*) FILTER (WHERE status IN ('emise', 'partielle'))::int AS inv_open_n,
        COALESCE(SUM(total_ttc - amount_paid) FILTER (WHERE status IN ('emise', 'partielle')), 0)::float AS inv_due,
        COUNT(*) FILTER (WHERE status IN ('emise', 'partielle') AND due_date < CURRENT_DATE)::int AS inv_overdue_n,
        COALESCE(SUM(total_ttc - amount_paid) FILTER (WHERE status IN ('emise', 'partielle') AND due_date < CURRENT_DATE), 0)::float AS inv_overdue_total,
        COUNT(*) FILTER (WHERE status = 'brouillon')::int AS inv_draft_n
       FROM invoices WHERE station_id = ANY($1::bigint[]) GROUP BY station_id`, p).catch(() => [])
  ]);
  return { payables: by(pay), overdue: by(over), customers: by(cust), stock: by(low), invdue: by(invd) };
}

const DOMAIN_FIELDS = {
  sales: [['sales', ['tx_n', 'sales_total', 'shop_total', 'cancel_n', 'cancel_total']], ['fuel', ['fuel_total', 'liters']], ['pay', ['pay_especes', 'pay_carte', 'pay_mobile_money', 'pay_credit', 'pay_autre']], ['margin', ['margin_ht', 'margin_base_ht', 'cost_lines', 'lines']], ['invrev', ['inv_revenue']]],
  ops: [['ops', ['shifts_closed', 'shifts_open', 'cash_gap_net', 'cash_gap_abs', 'shift_hours', 'shift_hours_n']], ['anomalies', ['anomalies_n']]],
  finance: [['expenses', ['expenses_total', 'expenses_n']], ['sp', ['supplier_paid']], ['cp', ['customer_collected']]],
  suppliers: [['purchases', ['purchases_total', 'purchases_n', 'purchases_received_n', 'purchases_pending_n']], ['__p', ['payables']], ['__o', ['overdue_amount', 'overdue_n']]],
  customers: [['__c', ['receivables', 'receivables_n', 'over_limit_n']], ['inv', ['inv_issued_n', 'inv_issued_total']], ['invpay', ['inv_collected']], ['__i', ['inv_open_n', 'inv_due', 'inv_overdue_n', 'inv_overdue_total', 'inv_draft_n']]],
  stock: [['__s', ['low_stock_n', 'stock_value']]]
};

/** Valeurs brutes d'une station pour un domaine : { champ: nombre }. */
function rawFor(domain, sid, F, P) {
  const src = { ...F, __p: P.payables, __o: P.overdue, __c: P.customers, __s: P.stock, __i: P.invdue };
  const out = {};
  for (const [name, fields] of DOMAIN_FIELDS[domain]) { const row = src[name].get(String(sid)) || {}; for (const f of fields) out[f] = num(row[f]); }
  return out;
}
const addRaw = (acc, raw) => { for (const k of Object.keys(raw)) acc[k] = (acc[k] || 0) + raw[k]; return acc; };

/** Évalue le catalogue : domains = { domaine: valeurs brutes sommées } (domaine absent = masqué). */
function evaluate(domains, ctx) {
  const out = {};
  for (const e of CATALOG) { if (!domains[e.domain]) continue; const v = e.get(domains[e.domain], ctx); out[e.key] = v == null || !Number.isFinite(v) ? null : v; }
  return out;
}
function compare(cur, prev) {
  const out = {};
  for (const e of CATALOG) {
    if (!(e.key in cur)) continue;
    const c = cur[e.key], p = e.flow && prev ? prev[e.key] : undefined;
    let variation = null;
    if (e.flow && c != null && p != null) variation = e.unit === 'pct' ? { kind: 'pts', value: Math.round((c - p) * 10) / 10 } : (L.variation(c, p) == null ? null : { kind: 'pct', value: L.variation(c, p) });
    out[e.key] = { value: c, previous: e.flow ? (p == null ? null : p) : undefined, variation };
  }
  return out;
}

function periodOf(q, today, monthStart) {
  const from = q && q.from ? String(q.from) : '', to = q && q.to ? String(q.to) : '';
  if (!from && !to) return { from: monthStart, to: today };
  if (!from || !to) throw new HttpError(400, 'Indiquez les deux dates de la période (du … au …).');
  if (!L.isYmd(from) || !L.isYmd(to)) throw new HttpError(400, 'Dates invalides (format AAAA-MM-JJ attendu).');
  if (from > to) throw new HttpError(400, 'La date de début doit précéder la date de fin.');
  return { from, to };
}

/** GET /aggregates?scope=current|all&from=&to=&by_station=1 — agrégats + catalogue (formules et sources). */
r.get('/aggregates', need(...ENTRY), wrap(async (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'current';
  let stations;
  if (scope === 'all') {
    if (req.user.is_global) throw new HttpError(403, 'Réservé aux comptes clients.');
    stations = await mv.accessibleStations(req);
  } else {
    const { rows } = await pool.query('SELECT id, name, currency FROM stations WHERE id = $1', [req.sid]);
    if (!rows[0]) throw new HttpError(400, 'Aucune station sélectionnée');
    stations = [{ ...rows[0], currency: String(rows[0].currency || 'FCFA').trim() }];
  }
  const { rows: [dt] } = await pool.query("SELECT CURRENT_DATE::text AS d, date_trunc('month', CURRENT_DATE)::date::text AS m");
  const { from, to } = periodOf(req.query, dt.d, dt.m);
  const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
  if (days > L.MAX_RANGE_DAYS) throw new HttpError(400, `La période ne peut pas dépasser ${L.MAX_RANGE_DAYS} jours.`);
  const prevFrom = L.addDays(from, -days), prevTo = L.addDays(from, -1), ctx = { days };
  const period = { from, to, days, prev_from: prevFrom, prev_to: prevTo };
  if (!stations.length) return res.json({ period, scope, stations: [], total: {}, catalog: CATALOG_META, hidden: {}, currencies: [], mixed_currency: false });

  const ids = stations.map(s => s.id);
  const caps = await mv.capabilitiesByStation(req, stations);
  const [F, Fp, P] = await Promise.all([loadFlows(ids, from, to), loadFlows(ids, prevFrom, prevTo), loadPoints(ids)]);

  const sumDomains = (Fx) => {
    const d = {};
    for (const dom of Object.keys(DOMAIN_FIELDS)) for (const s of stations) if (caps.get(String(s.id))[dom]) d[dom] = addRaw(d[dom] || {}, rawFor(dom, s.id, Fx, P));
    return d;
  };
  const total = compare(evaluate(sumDomains(F), ctx), evaluate(sumDomains(Fp), ctx));
  const hidden = {};
  for (const dom of Object.keys(DOMAIN_FIELDS)) { const n = stations.filter(s => !caps.get(String(s.id))[dom]).length; if (n) hidden[dom] = n; }
  const currencies = [...new Set(stations.map(s => s.currency))];
  const body = { period, scope, currencies, mixed_currency: currencies.length > 1, hidden, catalog: CATALOG_META, total };
  if (req.query.by_station === '1' || scope === 'current') {
    body.stations = stations.map(s => {
      const d = {}; for (const dom of Object.keys(DOMAIN_FIELDS)) if (caps.get(String(s.id))[dom]) d[dom] = rawFor(dom, s.id, F, P);
      return { id: s.id, name: s.name, currency: s.currency, values: evaluate(d, ctx) };
    });
  }
  res.set('Cache-Control', 'no-store').json(body);
}));

module.exports = { r, CATALOG, CATALOG_META, evaluate, compare, DOMAIN_FIELDS };
