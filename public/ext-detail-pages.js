/* Fiches de gestion dédiées — clients et fournisseurs (sans modale de détail). */
(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof VM === 'undefined') return;

  const escv = v => esc(v == null ? '' : String(v));
  const card = (label, value) => `<div class="card detail-stat"><small>${escv(label)}</small><b>${value}</b></div>`;
  const TICO = { overview: '📊', behavior: '🧭', invoices: '🧾', payments: '💳', credits: '🪙', history: '🕘', orders: '🚚' };
  const tabs = (id, items, active) => `<div class="detail-tabs pp-tabs" role="tablist" aria-label="Sections de la fiche">${items.map(x => `<button type="button" role="tab" aria-selected="${x[0] === active}" class="b2 ${x[0] === active ? 'on' : ''}" data-detail-tab="${id}" data-pane="${x[0]}"><span class="pp-ti" aria-hidden="true">${TICO[x[0]] || '•'}</span><span>${escv(x[1])}</span></button>`).join('')}</div>`;
  const pane = (id, key, active, html) => `<section id="${id}-${key}" class="detail-pane" ${active ? '' : 'hidden'}>${html}</section>`;
  // Délégation d'événements sur document : les onglets fonctionnent même si le HTML est injecté
  // après coup (ex. enveloppe ext-profile-stats qui attend des données avant le rendu).
  function switchDetailTab(btn) {
    const id = btn.dataset.detailTab, key = btn.dataset.pane;
    const root = btn.closest('.detail-page') || document;
    root.querySelectorAll(`[data-detail-tab="${id}"]`).forEach(b => b.classList.toggle('on', b === btn));
    root.querySelectorAll(`.detail-pane[id^="${id}-"]`).forEach(p => { p.hidden = p.id !== `${id}-${key}`; });
  }
  if (!window.__detailTabsBound) {
    window.__detailTabsBound = true;
    document.addEventListener('click', ev => {
      const btn = ev.target && ev.target.closest && ev.target.closest('[data-detail-tab]');
      if (btn) switchDetailTab(btn);
    });
  }
  function bindTabs() { /* conservé pour compatibilité : le clic est géré par délégation */ }
  function detailStyle() {
    if (document.getElementById('detail-pages-style')) return;
    const s = document.createElement('style'); s.id = 'detail-pages-style';
    s.textContent = `.detail-page{max-width:min(1500px,100%);margin:0 auto;width:100%;box-sizing:border-box}.detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}.detail-head h2{margin:0;font-size:clamp(1.15rem,2.5vw,1.55rem);word-break:break-word}.detail-meta{color:var(--m);font-size:13px;margin-top:5px}.detail-tabs{display:flex;flex-direction:row;flex-wrap:nowrap;width:100%;gap:clamp(4px,1vw,8px);overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:thin;border-bottom:1px solid var(--bd);padding:8px 0 12px;margin:12px 0}.detail-tabs::-webkit-scrollbar{height:4px}.detail-tabs button{flex:0 0 auto;min-width:max-content;margin:0;white-space:nowrap;text-align:center;font-size:clamp(11px,1.5vw,14px);padding:clamp(7px,1.2vw,10px) clamp(8px,1.6vw,16px)}.detail-tabs button.on{background:var(--a);color:#fff}.detail-pane[hidden]{display:none!important}.detail-stat{min-width:0}.detail-stat small{display:block;color:var(--m);margin-bottom:6px}.detail-stat b{font-size:clamp(1rem,2vw,1.15rem)}.detail-empty{color:var(--m);padding:18px 4px}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,160px),1fr));gap:10px}.detail-actions{display:flex;gap:8px;flex-wrap:wrap}.detail-chart{height:min(230px,40vw);max-width:100%;margin:14px 0}@media (max-width:640px){.detail-head{flex-direction:column;align-items:stretch}.detail-actions button{flex:1 1 auto;min-width:calc(50% - 4px)}}`;
    document.head.appendChild(s);
  }
  const CLIENT_DASH_KEYS = {
    cards: [['revenue', "Chiffre d'affaires"], ['fuel', 'Ventes carburant'], ['products', 'Ventes produits'], ['expenses', 'Dépenses'], ['net', 'Résultat net (CA − dépenses)'], ['margin', 'Marge brute'], ['margin_pct', 'Taux de marge brute'], ['profit', 'Résultat de gestion'], ['cash', 'Liquidités caisse'], ['receivables', 'Créances clients'], ['payables', 'Dettes fournisseurs'], ['low_stock', 'Stock bas'], ['open_shift', 'Quarts ouverts'], ['alerts', 'Alertes non lues']],
    charts: [['daily_revenue', 'Graphique CA journalier'], ['payments_by_method', 'Répartition paiements']],
    sections: [['profile', 'Profil connecté / date'], ['recent_activity', 'Activité récente'], ['shifts', 'Liste quarts ouverts'], ['low_stock_list', 'Liste stock bas'], ['fuel_by_product', 'Carburant par produit'], ['shortcuts', 'Raccourcis modules']]
  };
  const CLIENT_DASH_SHORTCUTS = ['jour', 'caisse', 'quart', 'ventes', 'cli', 'four', 'prod', 'pompes', 'alert', 'exports', 'audit', 'param', 'emp'];
  function clientDashChecks(clientId, group, values) {
    return CLIENT_DASH_KEYS[group].map(([key, label]) => `<label style="display:flex;align-items:center;gap:8px;margin:5px 0"><input type="checkbox" id="client_dash_${clientId}_${group}_${key}" ${values && values[key] === false ? '' : 'checked'}> ${escv(label)}</label>`).join('');
  }
  window.saveClientDashboardConfig = async function (clientId) {
    try {
      const value = {};
      for (const group of Object.keys(CLIENT_DASH_KEYS)) {
        value[group] = {};
        CLIENT_DASH_KEYS[group].forEach(([key]) => { value[group][key] = !!document.getElementById(`client_dash_${clientId}_${group}_${key}`)?.checked; });
      }
      const shortcuts = (document.getElementById(`client_dash_${clientId}_shortcuts`)?.value || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
      value.shortcuts = shortcuts;
      const existing = await G(`/admin/clients/${clientId}/dashboard-config`);
      value.by_role = existing.config?.by_role || {};
      await api('PUT', `/admin/clients/${clientId}/dashboard-config`, { value });
      toast('Configuration Dashboard de ce client enregistrée.', 'success');
      go('clientdetail', clientId);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  window.resetClientDashboardConfig = async function (clientId) {
    if (!confirm('Réinitialiser la configuration Dashboard de ce client aux valeurs par défaut ?')) return;
    try { await api('DELETE', `/admin/clients/${clientId}/dashboard-config`); toast('Configuration Dashboard réinitialisée.', 'success'); go('clientdetail', clientId); }
    catch (e) { toast(errMsg(e), 'error'); }
  };

  function goBackToList(k) { return `<button class="b2" onclick="go('${k}')">← Retour à la liste</button>`; }

  window.showCli = function (id) { return go('clidet', Number(id)); };
  window.showSup = window.showFour = function (id) { return go('supdet', Number(id)); };

  VM.clidet = async function () {
    detailStyle();
    const id = Number(arg); if (!Number.isInteger(id) || id < 1) return '<p class="warn">Client invalide.</p>';
    const [h, c, imp] = await Promise.all([G('/customers/' + id + '/history'), G('/customers/' + id), can('receivable.view') ? G('/customers/' + id + '/credit-imputations').catch(() => null) : Promise.resolve(null)]);
    const invoiceProducts = can('sale.create') ? (await G('/products').catch(() => [])).filter(p => p.category !== 'CARBURANT' && p.active !== false && p.active !== 0) : [];
    const invoiceEmployees = can('sale.create') ? await G('/employees').catch(() => []) : [];
    const sales = h.sales || [], payments = h.payments || [], credits = h.credits || [], clientInvoices = h.invoices || [], invoicePayments = h.invoice_payments || [];
    const INV_ST = { brouillon: ['Brouillon', 'tag'], emise: ['Émise', 'tag'], partielle: ['Partiellement payée', 'tag'], payee: ['Payée', 'tag ok'], annulee: ['Annulée', 'tag x'] };
    const salesTotal = sales.reduce((a, x) => a + Number(x.total || 0), 0);
    const paidTotal = payments.reduce((a, x) => a + Number(x.amount || 0), 0) + invoicePayments.reduce((a, x) => a + Number(x.amount || 0), 0);
    const due = Number(c.balance || 0);
    const clientTabs = [['overview','Vue d’ensemble'],['behavior','Comportement'],['invoices','Factures / ventes'],['payments','Paiements'], ...(can('receivable.view') ? [['credits','Avoirs / créances']] : []), ['history','Historique']];
    const tabsHtml = tabs('client-detail', clientTabs, 'overview');
    const overview = `<div class="cards">${card('Chiffre cumulé', f(salesTotal))}${can('receivable.view') ? card('Solde / dette', f(due)) : ''}${card('Paiements enregistrés', f(paidTotal))}${can('receivable.view') ? card('Limite de crédit', f(c.credit_limit || 0)) : ''}</div>`;
    const invoiceForm = can('sale.create') ? `<div class="card" style="text-align:left;margin-bottom:12px"><h3>Enregistrer une vente au nom de ce client</h3><p class="detail-meta">La vente est enregistrée par le processus métier existant. Un quart ouvert, un employé valide et un stock disponible peuvent être nécessaires.</p>${invoiceProducts.length && invoiceEmployees.length ? `<form onsubmit="return submitCustomerInvoice(event,${id})"><div class="detail-grid"><label>Produit<select name="product_id" required>${invoiceProducts.map(p=>`<option value="${Number(p.id)}">${escv(p.name)} · ${f(p.sell_price)}</option>`).join('')}</select></label><label>Quantité<input name="quantity" type="number" min="0.001" step="0.001" value="1" required></label><label>Mode de règlement<select name="method" required>${pmOpts().map(x=>`<option value="${escv(x[0])}">${escv(x[1])}</option>`).join('')}</select></label><label>Employé responsable<select name="employee_id" required><option value="">Choisir un employé</option>${invoiceEmployees.map(e=>`<option value="${Number(e.id)}">${escv([e.first_name,e.last_name].filter(Boolean).join(' '))}</option>`).join('')}</select></label></div><div class="detail-actions" style="margin-top:12px"><button type="submit">Enregistrer la facture</button></div></form>` : '<p class="detail-empty">Impossible de proposer la création : aucun produit éligible ou aucun employé disponible. Vérifiez également qu’un quart est ouvert.</p>'}</div>` : '';
    const canNewInvoice = typeof window.billNew === 'function' && can('sale.create|customer.edit|finance.view');
    const invTable = clientInvoices.length ? T(['N° facture','Émise le','Échéance','Total','Payé','Reste','État',''], clientInvoices.map(x => { const st = INV_ST[x.status] || [escv(x.status || '—'), 'tag']; return [escv(x.invoice_no), x.issued_on ? escv(String(x.issued_on).slice(0, 10)) : '—', x.due_date ? escv(String(x.due_date).slice(0, 10)) : '—', f(x.total_ttc), x.amount_paid == null ? '—' : f(x.amount_paid), x.balance == null ? '—' : f(x.balance), `<span class=\"${st[1]}\">${st[0]}</span>`, `<button class=\"b2\" onclick=\"billShow(${Number(x.id)})\">Ouvrir</button>`]; })) : '<p class=\"detail-meta\">Aucune facture n’a encore été établie au nom de ce client.</p>';
    const invMore = (h.summary && h.summary.invoices_total_count > clientInvoices.length) ? `<p class=\"detail-meta\">${clientInvoices.length} factures affichées sur ${h.summary.invoices_total_count}.</p>` : '';
    const salesMore = (h.summary && h.summary.sales_total_count > sales.length) ? `<p class=\"detail-meta\">${sales.length} ventes affichées sur ${h.summary.sales_total_count}.</p>` : '';
    const invoices = `<div class=\"card\" style=\"text-align:left;margin-bottom:12px\"><div style=\"display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center\"><h3 style=\"margin:0\">Factures de ce client</h3>${canNewInvoice ? `<button onclick=\"billNew(${id})\">Nouvelle facture</button>` : ''}</div><p class=\"detail-meta\">Toute facture établie au nom de ce client apparaît ici avec son état (brouillon, émise, partiellement payée, payée, annulée).</p>${invTable}${invMore}</div>${invoiceForm}<h3>Ventes comptoir enregistrées</h3>${T(['Référence','Date','Montant','Statut'], sales.map(x => [escv(x.invoice_no || x.id), dt(x.sold_at), f(x.total), escv(x.status || '—')]))}${salesMore}`;
    const payBtn = can('cash.manage|sale.create') ? `<div class="detail-actions" style="margin-bottom:10px"><button onclick="payCli(${id},${Math.max(0,due)})">Encaisser un paiement</button></div>` : '';
    const payHtml = payBtn + T(['Date','Mode','Montant','Référence'], invoicePayments.map(x => [dt(x.paid_at), escv(x.method || '—'), f(x.amount), 'Facture ' + escv(x.invoice_no)]).concat(payments.map(x => [dt(x.paid_at), escv(x.method || '—'), f(x.amount), x.sale_id ? 'Vente ' + escv(x.sale_id) : '—'])));
    const openCr = credits.some(x => x.status === 'ouvert' && Number(x.remaining) > 0);
    const creditHtml = (can('customer.edit') ? `<div class="detail-actions" style="margin-bottom:10px"><button class="b2" onclick="addCliCredit(${id})">Créer un avoir</button></div>` : '') + (openCr && can('customer.edit') ? `<div class="detail-actions" style="margin-bottom:10px"><button type="button" onclick="applyCredits('customers',${id})">Imputer les avoirs sur la dette</button></div>` : '') + T(['Montant','Restant','Motif','Statut'], credits.map(x => [f(x.amount), f(x.remaining), escv(x.reason || '—'), escv(x.status || '—')]))
      + (imp ? `<h3 style="margin-top:18px">Historique des imputations</h3><p class="detail-meta">Avoirs disponibles : <b>${f(imp.credits_available || 0)}</b></p>` + T(['Date','Dette concernée','Montant imputé','Motif','Avoir d’origine','Par'], (imp.history || []).map(x => [escv(String(x.applied_on || '').slice(0, 10)), x.invoice_id ? 'Facture ' + escv(x.invoice_no || ('#' + x.invoice_id)) : 'Créance globale', f(x.amount), escv(x.reason || '—'), '#' + Number(x.credit_id) + (x.credit_reason ? ' · ' + escv(x.credit_reason) : ''), escv(x.by_login || '—')])) : '');
    const historyHtml = `<p class="detail-meta">Historique dérivé des ventes, paiements et avoirs actuellement retournés par l’API.</p>${T(['Événement','Date / référence','Montant'], clientInvoices.map(x => ['Facture ' + escv(x.invoice_no) + ' · ' + ((INV_ST[x.status] || [x.status])[0]), dt(x.issued_on || x.created_at), f(x.total_ttc)]).concat(sales.map(x => [(x.credit_amount > 0 ? 'Vente à crédit (dette)' : 'Vente') + (x.employee ? ' · par ' + escv(x.employee) : ''), dt(x.sold_at), f(x.total)]).concat(payments.map(x => ['Paiement · ' + escv(x.method || ''), dt(x.paid_at), f(x.amount)]))))}`;
    const html = `<div class="detail-page"><div class="detail-head"><div><h2>${escv(c.name || 'Client')}</h2><div class="detail-meta">Fiche client · ID ${id}</div></div><div class="detail-actions">${goBackToList('cli')}</div></div>${tabsHtml}${pane('client-detail','overview',true,overview)}${pane('client-detail','behavior',false,'<p class="detail-meta">Statistiques de comportement indisponibles.</p>')}${pane('client-detail','invoices',false,invoices)}${pane('client-detail','payments',false,payHtml)}${pane('client-detail','credits',false,creditHtml)}${pane('client-detail','history',false,historyHtml)}</div>`;
    setTimeout(() => { const root = document.getElementById('pg'); if (root) bindTabs(root); }, 0);
    return html;
  };

  VM.supdet = async function () {
    detailStyle();
    const id = Number(arg); if (!Number.isInteger(id) || id < 1) return '<p class="warn">Fournisseur invalide.</p>';
    const [h, s] = await Promise.all([G('/suppliers/' + id + '/history'), G('/suppliers/' + id)]);
    const purchaseProducts = can('purchase.manage') ? await G('/products').catch(() => []) : [];
    const purchases = h.purchases || [], payments = h.payments || [], credits = h.credits || [];
    const total = purchases.reduce((a, x) => a + Number(x.total || 0), 0);
    const paid = payments.reduce((a, x) => a + Number(x.amount || 0), 0);
    const supplierTabs = [['overview','Vue d’ensemble'],['behavior','Comportement'],['orders','Bons de commande'], ...(can('purchase.manage|finance.view|purchase.pay') ? [['invoices','Factures fournisseurs']] : []), ...(can('debt.view|purchase.pay|finance.view') ? [['payments','Paiements']] : []), ...(can('debt.view') ? [['credits','Avoirs / soldes']] : [])];
    const tabsHtml = tabs('supplier-detail', supplierTabs, 'overview');
    const overview = `<div class="cards">${can('debt.view') ? card('Dette fournisseur', f(s.balance_due || 0)) : ''}${card('Achats cumulés', f(total))}${card('Paiements enregistrés', f(paid))}${card('Délai de paiement', s.payment_terms_days != null ? escv(s.payment_terms_days) + ' jours' : '—')}</div><div class="card" style="text-align:left;margin-top:12px"><h3>Informations du fournisseur</h3><div class="detail-grid"><p><b>Nom</b><br>${escv(s.name)}</p><p><b>Entreprise</b><br>${escv(s.company || '—')}</p><p><b>Téléphone</b><br>${escv(s.phone || '—')}</p><p><b>E-mail</b><br>${escv(s.email || '—')}</p><p><b>Contact</b><br>${escv(s.contact || '—')}</p><p><b>Adresse</b><br>${escv(s.address || '—')}</p><p><b>NIF</b><br>${escv(s.tax_id || '—')}</p></div></div><div class="detail-actions" style="margin-top:12px">${can('supplier.edit') ? `<button class="b2" onclick="editSup(${id})">Modifier le fournisseur</button>` : ''}${can('purchase.manage') ? `<button onclick="addPOForSupplier(${id})">Nouveau bon de commande</button>` : ''}${can('supplier.edit') ? `<button class="b2" onclick="addSupCredit(${id})">Créer un avoir</button>` : ''}</div>`;
    const orderOptions = purchaseProducts.map(p => `<option value="${Number(p.id)}">${escv(p.name)}</option>`).join('');
    const orderForm = can('purchase.manage') ? `<div class="card" style="text-align:left;margin-bottom:12px"><h3>Bon de commande</h3><p class="detail-meta">Ajoutez autant de lignes que nécessaire : produit, quantité et coût unitaire.</p>${purchaseProducts.length ? `<div class="detail-actions"><button type="button" onclick="poNew(${id})">+ Nouveau bon de commande</button></div>` : '<p class="detail-empty">Aucun produit disponible pour créer une commande.</p>'}</div>` : '';
    const orders = `${orderForm}<h3>Historique des bons de commande</h3>${T(['N° commande','Date','Total','Statut','Détails / réception'], purchases.map(x => [escv(x.order_no || x.number || x.id), dt(x.ordered_at || x.created_at), f(x.total), escv(x.status || '—'), `<button class=\"b2\" onclick=\"showPO(${Number(x.id)})\">Ouvrir</button>`]))}`;
    const invoices = T(['Commande','Facture','Montant facturé','Payé','Statut'], purchases.map(x => [escv(x.order_no || x.id), escv(x.invoice_no || '—'), f(x.invoice_total || 0), can('debt.view|purchase.pay|finance.view') ? f(x.paid || 0) : '—', escv(x.status || '—')]));
    const payHtml = T(['Date','Montant','Mode'], payments.map(x => [dt(x.paid_at), f(x.amount), escv(x.method || '—')]));
    const openCr = credits.some(x => x.status === 'ouvert' && Number(x.remaining) > 0);
    const creditHtml = (openCr && can('supplier.edit') ? `<div class="detail-actions" style="margin-bottom:10px"><button type="button" onclick="applyCredits('suppliers',${id})">Imputer les avoirs sur les factures</button></div>` : '') + T(['Montant','Restant','Motif','Statut'], credits.map(x => [f(x.amount), f(x.remaining), escv(x.reason || '—'), escv(x.status || '—')]));
    const html = `<div class="detail-page"><div class="detail-head"><div><h2>${escv(s.name || 'Fournisseur')}</h2><div class="detail-meta">Fiche fournisseur · ID ${id}</div></div><div class="detail-actions">${goBackToList('four')}</div></div>${tabsHtml}${pane('supplier-detail','overview',true,overview)}${pane('supplier-detail','behavior',false,'<p class="detail-meta">Statistiques de comportement indisponibles.</p>')}${pane('supplier-detail','orders',false,orders)}${pane('supplier-detail','invoices',false,invoices)}${pane('supplier-detail','payments',false,payHtml)}${pane('supplier-detail','credits',false,creditHtml)}</div>`;
    setTimeout(() => { const root = document.getElementById('pg'); if (root) bindTabs(root); }, 0);
    return html;
  };

  // Imputation manuelle d'un avoir client : date, dette concernée (liste déroulante), montant, motif ; historique visible dans l'onglet.
  async function imputeCustomerCredit(id) {
    const d = await G('/customers/' + Number(id) + '/credit-imputations');
    if (!(d.credits_available > 0)) { toast('Aucun avoir disponible à imputer.', 'info'); return; }
    if (!d.debts.length) { toast('Ce client n’a aucune dette active à réduire.', 'info'); return; }
    const opts = d.debts.map(x => [x.invoice_id == null ? 'global' : String(x.invoice_id), x.label + ' — reste ' + f(x.remaining)]);
    const first = d.debts[0];
    const today = new Date().toISOString().slice(0, 10);
    form('Imputer un avoir sur une dette', [
      ['applied_on', 'Date d’imputation', 'date'],
      ['invoice_id', 'Dette concernée', 's', opts],
      ['amount', 'Montant à imputer', 'number'],
      ['reason', 'Motif']
    ], { applied_on: today, invoice_id: opts[0][0], amount: Math.min(first.remaining, d.credits_available), reason: '' }, async v => {
      if (!v.reason || v.reason.trim().length < 3) throw new Error('Le motif est obligatoire.');
      if (!(v.amount > 0)) throw new Error('Saisissez un montant supérieur à zéro.');
      await Po('/customers/' + Number(id) + '/credits/impute', { applied_on: v.applied_on || today, invoice_id: v.invoice_id === 'global' ? null : Number(v.invoice_id), amount: v.amount, reason: v.reason.trim() });
      closeM(); toast('Avoir imputé : ' + f(v.amount), 'success');
      await go('clidet', Number(id));
      setTimeout(() => { const b = document.querySelector('[data-detail-tab="client-detail"][data-pane="credits"]'); if (b) b.click(); }, 80);
    }, '<p class="detail-meta" style="margin:8px 0 0">Avoirs disponibles : <b>' + f(d.credits_available) + '</b>. L’imputation réduit la dette choisie sans mouvement de caisse.</p>');
  }
  window.applyCredits = async function (kind, id) {
    if (kind === 'customers') { try { return await imputeCustomerCredit(id); } catch (e) { toast(errMsg(e), 'error'); return; } }
    try {
      const r = await Po('/' + (kind === 'customers' ? 'customers' : 'suppliers') + '/' + Number(id) + '/credits/apply', {});
      toast(r && r.applied > 0 ? 'Avoirs imputés : ' + f(r.applied) : 'Aucune dette à réduire pour le moment.', r && r.applied > 0 ? 'success' : 'info');
      go(kind === 'customers' ? 'clidet' : 'supdet', Number(id));
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  window.submitCustomerInvoice = async function (event, customerId) {
    event.preventDefault();
    if (!can('sale.create')) { toast('Permission de vente refusée','error'); return false; }
    const formEl = event.currentTarget, d = Object.fromEntries(new FormData(formEl).entries());
    const productId = Number(d.product_id), quantity = Number(d.quantity), employeeId = Number(d.employee_id);
    if (!Number.isInteger(productId) || productId < 1 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(employeeId) || employeeId < 1 || !d.method) {
      toast('Vérifiez le produit, la quantité, le mode de règlement et l’employé.','error'); return false;
    }
    const submit = formEl.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    try {
      const products = await G('/products');
      const product = products.find(p => Number(p.id) === productId);
      if (!product || product.category === 'CARBURANT' || product.active === false || product.active === 0) throw new Error('Produit indisponible ou non éligible.');
      const total = fl(quantity * Number(product.sell_price));
      if (!(total > 0)) throw new Error('Le montant calculé est invalide.');
      await Po('/sales',{items:[{product_id:productId,quantity}],payments:[{method:d.method,amount:total}],customer_id:Number(customerId),employee_id:employeeId});
      toast('Facture créée et vente enregistrée.','success'); go('clidet',Number(customerId));
    } catch (e) { toast(errMsg(e),'error'); if (submit) submit.disabled = false; }
    return false;
  };
  window.createCustomerInvoice = async function (customerId) { return go('clidet', Number(customerId)); };

  window.submitSupplierOrder = async function (event, supplierId) {
    event.preventDefault();
    if (!can('purchase.manage')) { toast('Permission de commande refusée','error'); return false; }
    const formEl = event.currentTarget, d = Object.fromEntries(new FormData(formEl).entries()), items = [];
    for (let i=1;i<=3;i++) {
      const productId = Number(d['p'+i] || 0), quantity = Number(d['q'+i] || 0), unitCost = Number(d['c'+i] || 0);
      if (!productId && quantity === 0 && unitCost === 0) continue;
      if (!Number.isInteger(productId) || productId < 1 || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost <= 0) {
        toast(`Vérifiez le produit, la quantité et le coût unitaire de la ligne ${i}.`,'error'); return false;
      }
      items.push({product_id:productId,quantity,unit_cost:unitCost});
    }
    if (!items.length) { toast('Ajoutez au moins une ligne de produit.','error'); return false; }
    const submit = formEl.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    try { await Po('/purchases',{supplier_id:Number(supplierId),items}); toast('Bon de commande créé.','success'); go('supdet',Number(supplierId)); }
    catch(e) { toast(errMsg(e),'error'); if(submit)submit.disabled=false; }
    return false;
  };
  window.addPOForSupplier = async function (supplierId) { return go('supdet', Number(supplierId)); };

  const oldCli = VM.cli, oldFour = VM.four;
  // showCli / showSup : profil plein écran (comme fiche fournisseur)
  window.showCli = function (id) { return go('clidet', Number(id)); };
  window.showSup = window.showFour = function (id) { return go('supdet', Number(id)); };
  VM.cli = async function () {
    const ls = await G('/customers' + (typeof archQuery === 'function' ? archQuery('customers') : '')).catch(() => []);
    const showBal = typeof can === 'function' && can('receivable.view');
    const inactiveView = typeof ARCH !== 'undefined' && ARCH.customers;
    const exportBtn = (typeof can === 'function' && can('export.customers'))
      ? `<button class="b2" onclick="exportList('customers','pdf')">📄 Exporter PDF</button><button class="b2" onclick="exportList('customers','xlsx')">Excel</button>` : '';
    const archBtn = typeof archToggleBtn === 'function' ? archToggleBtn('customers') : '';
    const archBan = typeof archBanner === 'function' ? archBanner('customers', ls.length) : '';
    const rows = ls.map(c => {
      const actions =
        (showBal && c.balance > 0 && can('cash.manage|sale.create')
          ? `<button class="b2" onclick="event.stopPropagation();payCli(${c.id},${c.balance})">Encaisser</button> ` : '') +
        (typeof archRowBtn === 'function' ? archRowBtn('customers', c.id, inactiveView, c.name) : '');
      return [
        (typeof av === 'function' ? av('customers', c.id, c.photo_path, c.name) : ''),
        `<a href="#" style="font-weight:600" onclick="event.preventDefault();event.stopPropagation();showCli(${c.id});return false">${esc(c.name)}</a>`,
        esc(c.kind || ''),
        esc(c.phone || ''),
        f(c.credit_limit || 0)
      ].concat(showBal ? [f(c.balance)] : []).concat([actions]);
    });
    const heads = ['', 'Client', 'Type', 'Tél.', 'Limite'].concat(showBal ? ['Solde'] : []).concat(['']);
    return `<div class="bar"><input class="q" id="cli-q" placeholder="Rechercher un client" oninput="flt(this)">${can('customer.edit') && !inactiveView ? '<button onclick="addCli()">Ajouter un client</button>' : ''}${exportBtn}${archBtn}</div>` +
      archBan +
      `<p style="color:var(--m);font-size:13px;margin:0 0 8px">${ls.length} client(s) — cliquez une ligne pour ouvrir le profil</p>` +
      T(heads, rows, i => `showCli(${ls[i].id})`);
  };
  VM.four = async function () { return await oldFour(); };


  window.renderClientAdEditor = async function (clientId) {
    const cfg = await G('/admin/clients/' + clientId + '/advertising').catch(() => null);
    if (!cfg) return '<p class="warn">Impossible de charger la configuration publicitaire.</p>';
    const images = cfg.images || [];
    if (window.__clientAdPreviewUrls) window.__clientAdPreviewUrls.forEach(u => URL.revokeObjectURL(u));
    window.__clientAdPreviewUrls = [];
    const previewImages = await Promise.all(images.map(async im => { try { const r = await fetch(im.url, { headers: { Authorization: 'Bearer ' + TK }, cache: 'no-store' }); if (!r.ok) return null; const u = URL.createObjectURL(await r.blob()); window.__clientAdPreviewUrls.push(u); return { ...im, previewUrl: u }; } catch (_) { return null; } }));
    return `<div class="card" style="text-align:left"><h3>Panneau publicitaire personnalisé</h3><p class="detail-meta">Cette configuration s’applique uniquement au client #${clientId}. Jusqu’à cinq images. À partir de deux images, elles défilent automatiquement en bas du menu de gauche du client.</p>
      <div class="g"><label>Titre (facultatif)<input id="cad-title" maxlength="100" value="${escv(cfg.title || '')}"></label><label>Texte (facultatif)<textarea id="cad-text" rows="3" maxlength="1000">${escv(cfg.text || '')}</textarea></label>
      <label>Délai entre images (secondes)<input id="cad-interval" type="number" min="10" max="3600" step="1" value="${Number(cfg.interval_sec) || 60}" title="Défilement des images dans la zone PUB du menu client (10–3600 s)"></label></div>
      <p class="detail-meta">Les images s’affichent tout en bas du menu de gauche (zone PUB), en ordre aléatoire, et défilent selon le délai ci-dessus (60 secondes par défaut). Un clic sur l’image l’agrandit dans un petit pop-up. Le texte reste en bandeau sur le tableau de bord.</p>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin:10px 0"><input id="cad-enabled" type="checkbox" style="width:auto" ${cfg.enabled ? 'checked' : ''}> Activer le panneau</label>
      <label style="display:flex;align-items:center;gap:8px;flex-direction:row;margin:10px 0"><input id="cad-published" type="checkbox" style="width:auto" ${cfg.published ? 'checked' : ''}> Publier les modifications pour le client</label>
      <div class="detail-actions"><button onclick="saveClientAd(${clientId})">Enregistrer la configuration</button><button class="b2" onclick="uploadClientAdImage(${clientId})" ${images.length >= 5 ? 'disabled' : ''}>Ajouter une image (${images.length}/5)</button></div>
      <div class="detail-grid" style="margin-top:14px">${images.length ? previewImages.map((im,i) => `<div class="card" style="text-align:left"><img src="${escv(im && im.previewUrl || '')}" alt="Image publicitaire ${i+1}" style="width:100%;height:130px;object-fit:contain;background:var(--bg);border-radius:8px"><p><b>Image ${i+1}</b></p><div class="detail-actions"><button class="b2" onclick="moveClientAdImage(${clientId},${i},-1)" ${i===0?'disabled':''}>↑</button><button class="b2" onclick="moveClientAdImage(${clientId},${i},1)" ${i===images.length-1?'disabled':''}>↓</button><button class="b2 bd" onclick="deleteClientAdImage(${clientId},${i})">Supprimer</button></div></div>`).join('') : '<p class="detail-empty">Aucune image configurée.</p>'}</div>
      <div id="cad-preview" class="card" style="text-align:left;margin-top:14px"><b>Aperçu</b><div style="padding:12px 0"><strong>${escv(cfg.title || 'Panneau publicitaire')}</strong><p>${escv(cfg.text || '')}</p><small>${images.length} image(s) · ${cfg.enabled && cfg.published ? 'Publié' : 'Non publié'}</small></div></div>
      <input id="cad-file" type="file" accept="image/png,image/jpeg,image/webp" hidden>
    </div>`;
  };
  window.saveClientAd = async function (id) {
    try {
      await api('PUT','/admin/clients/'+id+'/advertising',{
        title:document.getElementById('cad-title').value,
        text:document.getElementById('cad-text').value,
        enabled:document.getElementById('cad-enabled').checked,
        published:document.getElementById('cad-published').checked,
        interval_sec: Math.max(10, Math.min(3600, parseInt(document.getElementById('cad-interval').value, 10) || 60))
      });
      toast('Configuration publicitaire enregistrée','success'); go('clientdetail',id);
    } catch(e) { toast(errMsg(e),'error'); }
  };
  // Réduit une image trop lourde ou trop grande (photos de téléphone) en JPEG ≤ 1600 px avant l'envoi.
  function adCompress(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        try {
          const max = 1600, k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
          let q = 0.88, out = c.toDataURL('image/jpeg', q);
          while (out.length * 0.75 > 1.8 * 1024 * 1024 && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
          resolve(out);
        } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
      img.src = url;
    });
  }
  window.uploadClientAdImage = function (id) {
    const input=document.getElementById('cad-file'); if(!input) return;
    input.onchange=async()=>{ const file=input.files && input.files[0]; if(!file)return; if(!/^image\/(png|jpeg|webp)$/.test(file.type))return toast('Formats autorisés : PNG, JPEG ou WebP','error');
      try {
        let data;
        if (file.size > 1.5 * 1024 * 1024) data = await adCompress(file);
        else data = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
        await api('POST','/admin/clients/'+id+'/advertising/images',{data_url:data}); toast('Image ajoutée','success'); go('clientdetail',id);
      } catch(e){toast(errMsg(e),'error');} finally {input.value='';}
    }; input.click();
  };
  window.deleteClientAdImage = (id,index) => ask('Supprimer cette image publicitaire ?', async()=>{ try { await api('DELETE','/admin/clients/'+id+'/advertising/images/'+index); toast('Image supprimée','success'); go('clientdetail',id); } catch(e){toast(errMsg(e),'error');} });
  window.moveClientAdImage = async function(id,index,delta) {
    try { const cfg=await G('/admin/clients/'+id+'/advertising'); const order=cfg.images.map((_,i)=>i); const dest=index+delta; if(dest<0||dest>=order.length)return; [order[index],order[dest]]=[order[dest],order[index]]; await api('PUT','/admin/clients/'+id+'/advertising/images/order',{order}); toast('Ordre des images modifié','success'); go('clientdetail',id); } catch(e){toast(errMsg(e),'error');}
  };

  // Le tableau de bord client remplace le panneau global par le panneau propre au client connecté.
  if (typeof VM.dash === 'function') {
    const previousDashboard = VM.dash;
    VM.dash = async function () {
      let html = await previousDashboard();
      const globalPanel = typeof adPanelHtml === 'function' ? adPanelHtml() : '';
      if (globalPanel) html = html.replace(globalPanel, '');
      let ad = null; try { ad = await G('/me/advertising'); } catch (_) {}
      if (!ad || !ad.enabled) return html;
      if (window.__clientAdPreviewUrls) window.__clientAdPreviewUrls.forEach(u => URL.revokeObjectURL(u));
      window.__clientAdPreviewUrls = [];
      const imagePaths = Array.isArray(ad.images) ? ad.images : [];
      const imgs = await Promise.all(imagePaths.map(async url => { try { const r=await fetch(url,{headers:{Authorization:'Bearer '+TK,...(typeof SID!=='undefined'&&SID?{'X-Station-Id':SID}:{})},cache:'no-store'}); if(!r.ok)return ''; const blobUrl=URL.createObjectURL(await r.blob()); (window.__clientAdPreviewUrls||(window.__clientAdPreviewUrls=[])).push(blobUrl); return blobUrl; } catch (_) { return ''; } }));
      const imageHtml = imgs.length ? `<div class="client-ad-images" data-count="${imgs.length}">${imgs.map((url,i)=>`<img src="${escv(url)}" alt="Publicité ${i+1}" class="client-ad-image${i===0?' active':''}" ${i===0?'':'hidden'}>`).join('')}${imgs.length>1?'<div class="client-ad-controls"><button class="b2" onclick="clientAdMove(-1)" aria-label="Image précédente">‹</button><span id="client-ad-index">1 / '+imgs.length+'</span><button class="b2" onclick="clientAdMove(1)" aria-label="Image suivante">›</button></div>':''}</div>` : '';
      const panel = `<div class="client-ad-overlay" id="client-ad-overlay" role="dialog" aria-modal="true" aria-label="Publicité du compte client"><section class="ad-panel client-ad-panel"><button class="client-ad-close" type="button" onclick="closeClientAd()" aria-label="Fermer la publicité">×</button><div class="ad-panel-inner">${ad.title?`<b>${escv(ad.title)}</b>`:''}${ad.text?`<p>${escv(ad.text)}</p>`:''}${imageHtml}</div></section></div>`;
      if (window.__clientAdTimer) clearInterval(window.__clientAdTimer);
      if (imgs.length>1) { window.__clientAdIndex=0; window.__clientAdTimer=setInterval(()=>window.clientAdMove(1),60000); }
      window.__clientAdPopupTimer=setInterval(()=>{ if(!document.getElementById('client-ad-overlay')) { const wrap=document.createElement('div'); wrap.innerHTML=panel; document.body.appendChild(wrap.firstElementChild); } }, imgs.length>1?60000:120000);
      return panel + html;
    };
  }
  window.closeClientAd = function() { const el=document.getElementById('client-ad-overlay'); if(el)el.remove(); };
  window.clientAdMove = function(delta) {
    const box=document.querySelector('.client-ad-images'); if(!box)return; const imgs=[...box.querySelectorAll('.client-ad-image')]; if(imgs.length<2)return;
    window.__clientAdIndex=((Number(window.__clientAdIndex)||0)+delta+imgs.length)%imgs.length;
    imgs.forEach((im,i)=>{im.hidden=i!==window.__clientAdIndex;im.classList.toggle('active',i===window.__clientAdIndex);});
    const label=document.getElementById('client-ad-index');if(label)label.textContent=(window.__clientAdIndex+1)+' / '+imgs.length;
  };
  if (!document.getElementById('client-ad-style')) { const st=document.createElement('style');st.id='client-ad-style';st.textContent='.client-ad-overlay{position:fixed;inset:0;z-index:10000;background:rgba(2,8,23,.68);display:flex;align-items:center;justify-content:center;padding:20px}.client-ad-panel{position:relative;width:min(760px,96vw);max-height:90vh;overflow:auto;background:var(--card,#fff);border-radius:18px;box-shadow:0 24px 80px rgba(0,0,0,.35);padding:24px}.client-ad-close{position:absolute;right:10px;top:8px;border:0;border-radius:50%;font-size:28px;cursor:pointer;background:var(--bg2,#eef2ff);color:var(--tx,#111);width:38px;height:38px}.client-ad-images{margin-top:10px;position:relative}.client-ad-image{width:100%;max-height:60vh;object-fit:contain;border-radius:8px}.client-ad-image[hidden]{display:none}.client-ad-controls{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:8px}.client-ad-panel .ad-panel-inner{max-width:100%}';document.head.appendChild(st); }

  // Fiche administrative complète d'un client dans l'espace Super Admin.

  window.downloadClientSituationPdf = async function (id) {
    try {
      id = Number(id);
      if (!id) return toast('Client invalide', 'error');
      toast('Génération du PDF…', 'info');
      const r = await fetch('/api/admin/clients/' + id + '/situation.pdf', {
        headers: { Authorization: 'Bearer ' + TK }
      });
      if (!r.ok) {
        let msg = 'Échec de génération PDF';
        try { const j = await r.json(); msg = j.error || j.message || msg; } catch (_) {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'situation-client-' + id + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('PDF téléchargé', 'success');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  VM.clientdetail = async function () {
    detailStyle();
    if (!(ME && ME.is_global)) return '<p class="warn">Cette interface est réservée au Super Admin.</p>';
    const id = Number(arg); if (!Number.isInteger(id) || id < 1) return '<p class="warn">Client invalide.</p>';
    const all = await G('/admin/clients');
    const list = Array.isArray(all) ? all : (all.clients || []);
    const c = list.find(x => Number(x.id) === id || Number(x.client_id) === id);
    if (!c) return '<p class="warn">Client introuvable ou inaccessible.</p>';
    const results = await Promise.all([
      G('/admin/clients/' + id + '/contract').catch(() => null),
      G('/admin/clients/' + id + '/license/history').catch(() => []),
      G('/admin/clients/' + id + '/users').catch(() => []),
      G('/admin/clients/' + id + '/quotas').catch(() => null)
    ]);
    const contract = results[0] || c, history = results[1] || [], users = results[2] || [], quotas = results[3] || {};
    const features = contract.features || c.features || {};
    const modules = features.modules || {};
    const date = x => x ? new Date(x).toLocaleDateString() : '—';
    const state = c.license_status || contract.license_status || c.contract_status || '—';
    const tag = `<span class="tag ${/ACTIVE|actif/i.test(state) ? 'g' : /EXPIR|SUSPEND/i.test(state) ? 'x' : ''}">${esc(state)}</span>`;
    // Modules booléens + flags fiscaux / can_*
    const flags = [];
    Object.keys(modules).forEach(k => { if (modules[k] === true) flags.push(k); });
    Object.keys(features).forEach(k => {
      if (k === 'modules') return;
      if (features[k] === true) flags.push(k);
    });
    const enabledModules = flags.length
      ? flags.map(k => `<span class="tag">${esc(k)}</span>`).join(' ')
      : 'Aucun module déclaré';
    const overview = `<div class="cards">${card('Statut de licence', tag)}${card('Début du contrat', esc(date(contract.starts_at || contract.start_date || c.starts_at || c.start_date)))}${card('Fin du contrat', contract.is_indefinite || c.is_indefinite ? 'Sans expiration' : esc(date(contract.expires_at || contract.end_date || c.expires_at || c.end_date)))}${card('Stations actives', esc(c.stations_count ?? '—'))}${card('Utilisateurs', esc(c.users_count ?? users.length))}</div><div class="card" style="text-align:left;margin-top:12px"><h3>Informations administratives</h3><div class="detail-grid"><p><b>Client</b><br>${esc(c.name || '—')}</p><p><b>Code</b><br>${esc(c.code || '—')}</p><p><b>Contact / responsable déclaré</b><br>${esc(c.manager_name || '—')}</p><p><b>Administrateur local (identifiant)</b><br>${esc(c.owner_login || '—')}</p><p><b>E-mail</b><br>${esc(c.contact_email || '—')}</p><p><b>Téléphone</b><br>${esc(c.contact_phone || '—')}</p><p><b>Statut organisation</b><br>${esc(c.status || '—')}</p><p><b>Type de contrat</b><br>${esc(contract.contract_type || c.contract_type || '—')}</p></div><h3>Modules déclarés</h3><div>${enabledModules}</div></div><div class="detail-actions" style="margin-top:12px"><button class="b2" onclick="downloadClientSituationPdf(${id})">Exporter PDF situation</button><button onclick="clEdit(${id})">Modifier le contrat</button><button class="b2" onclick="clRenew(${id})">Renouveler</button><button class="b2" onclick="clExtend(${id})">Prolonger</button><button class="b2" onclick="clSetExpiry(${id})">Modifier l’échéance</button><button class="b2" onclick="clApplyPack(${id})">Gérer le pack</button><button class="b2" onclick="go('clients')">Retour aux clients</button></div>`;
    const contractHtml = `<div class="card" style="text-align:left"><h3>Contrat et abonnement</h3><div class="detail-grid"><p><b>Statut</b><br>${tag}</p><p><b>Début</b><br>${esc(date(contract.starts_at || contract.start_date || c.starts_at || c.start_date))}</p><p><b>Fin</b><br>${contract.is_indefinite || c.is_indefinite ? 'Sans expiration' : esc(date(contract.expires_at || contract.end_date || c.expires_at || c.end_date))}</p><p><b>Durée</b><br>${esc([contract.duration_value || c.duration_value, contract.duration_unit || c.duration_unit].filter(Boolean).join(' ') || '—')}</p><p><b>Limite utilisateurs</b><br>${esc(contract.max_users ?? c.max_users ?? quotas.users?.max ?? '—')}</p><p><b>Limite stations</b><br>${esc(contract.max_stations ?? c.max_stations ?? quotas.stations?.max ?? '—')}</p></div><div class="detail-actions"><button onclick="clEdit(${id})">Modifier le contrat</button><button class="b2" onclick="clRenew(${id})">Renouveler</button><button class="b2" onclick="clExtend(${id})">Prolonger</button><button class="b2" onclick="clSetExpiry(${id})">Modifier l’échéance</button></div></div><h3>Historique des abonnements et licences</h3>${T(['Date','Opération','Administrateur','Note'], history.map(x => [dt(x.performed_at), esc(x.operation || x.action || '—'), esc(x.admin_login || '—'), esc(x.note || x.reason || '')]))}`;
    const usersHtml = '<p class="detail-meta">Seuls les administrateurs locaux du client sont affichés. Les autres comptes (gérant, comptable, caissier, pompiste…) sont gérés par l’administrateur local.</p>' + `<div class="detail-actions" style="margin:8px 0"><button class="b2" onclick="clientRescueAdmin(${id})">Créer un administrateur local de secours</button></div><p class="detail-meta">À utiliser si le compte administrateur local est perdu ou inutilisable : un nouveau compte est créé (aucun compte existant n’est promu).</p>` + T(['Nom','Identifiant','Rôle / fonction','Statut','Dernière connexion','Session active'], users.map(u => [`<a href="#" onclick="event.stopPropagation();go('clientuserdetail','${id}:${Number(u.id)}');return false"><strong>${esc(u.full_name || u.login)}</strong></a>`, esc(u.login), esc([u.job_title, u.role_label || u.role].filter(Boolean).join(' · ') || '—'), u.active ? '<span class="tag g">Actif</span>' : '<span class="tag x">Inactif</span>', dt(u.last_login_at) || 'Jamais', u.session_active ? '<span class="tag g">Oui</span>' : 'Non']), i => `go('clientuserdetail','${id}:${Number(users[i].id)}')`);
    const modsHtml = `<div class="card" style="text-align:left"><h3>Modules et fonctionnalités du contrat</h3><p>Cette vue reflète les fonctionnalités retournées par le contrat. Les changements doivent passer par les actions contractuelles autorisées.</p><div>${enabledModules}</div><div class="detail-actions" style="margin-top:12px"><button onclick="clEdit(${id})">Modifier les fonctionnalités du contrat</button></div></div>`;
    const historyHtml = T(['Date','Opération','Administrateur','Note'], history.map(x => [dt(x.performed_at), esc(x.operation || x.action || '—'), esc(x.admin_login || '—'), esc(x.note || x.reason || '')]));
    const [backupStatus, backupFeature] = await Promise.all([
      G('/admin/maintenance/backup-status').catch(() => ({ restore_enabled: false, global_reset_enabled: false, client_restore_enabled:false, client_reset_enabled:false })),
      G('/admin/clients/' + id + '/isolated-backup-history').catch(() => ({ backups: [], logs: [] }))
    ]);
    const backupRows = (backupFeature.logs || []).map(x => [dt(x.finished_at || x.started_at), `<span class="tag ${x.status === 'ok' ? '' : 'x'}">${esc(x.status === 'ok' ? 'Réussie' : x.status === 'failed' ? 'Échec' : 'En cours')}</span>`, esc(x.kind || ''), esc(x.file_name || '—'), x.error_message ? esc(x.error_message) : '—']);
    const backupFiles = (backupFeature.backups || []).map(x => [dt(x.created_at), esc(x.name), Math.round(x.size/1024)+' Ko', `<button class="b2" onclick="downloadClientBackup(${Number(id)},${jsArg(x.name)})">Télécharger</button>`]);
    const maintenanceHtml = `<div class="card" style="text-align:left"><h3>Sauvegarde isolée — ${esc(c.name || 'Client')}</h3><p>Cette archive ne contient que les données rattachées à ce client. Les utilisateurs, stations et contrat sont conservés lors d’une restauration afin de préserver l’accès à la fiche. Toute restauration nécessite le mot de passe du Super Admin.</p><div class="detail-actions"><button onclick="createClientBackup(${id})">Créer une sauvegarde de ce client</button><button class="b2" onclick="refreshClientBackups(${id})">Actualiser l’historique</button></div><h4>Historique des opérations</h4>${T(['Date','Résultat','Opération','Fichier','Détail'], backupRows)}<h4>Fichiers de sauvegarde disponibles</h4>${T(['Date','Fichier','Taille',''], backupFiles)}
      <div class="card"><h4>Restaurer ce client</h4>${backupStatus.client_restore_enabled ? `<label>Archive de sauvegarde (.json.gz)<input type="file" id="client_restore_file_${id}" accept=".json,.json.gz,.gz,application/json,application/gzip"></label><label>Mot de passe Super Admin<input type="password" id="client_restore_password_${id}" autocomplete="current-password"></label><button class="b2" onclick="restoreClientBackup(${id})">Confirmer la restauration de ce client</button>` : '<p>Restauration désactivée par sécurité. Activez CLIENT_RESTORE_ENABLED=1 après validation sur une base de test.</p>'}</div>
      <div class="card"><h4>Réinitialiser les données opérationnelles de ce client</h4><p class="warn err">Cette action supprime les données métier de ce client uniquement. Elle conserve la fiche client, le contrat, les stations et les comptes utilisateurs. Une sauvegarde isolée préalable est créée automatiquement.</p>${backupStatus.client_reset_enabled ? `<label>Saisir exactement REINITIALISER CE CLIENT<input id="client_reset_confirmation_${id}" autocomplete="off"></label><label>Mot de passe Super Admin<input type="password" id="client_reset_password_${id}" autocomplete="current-password"></label><button class="danger" onclick="resetClientData(${id})">Réinitialiser ce client</button>` : '<p>Réinitialisation désactivée par sécurité. Activez CLIENT_RESET_ENABLED=1 après validation sur une base de test.</p>'}</div><button class="b2" onclick="go('param')">Paramètres de sauvegarde de la plateforme</button></div>`;
    const dashResponse = await G('/admin/clients/' + id + '/dashboard-config').catch(() => null);
    const dashCfg = dashResponse?.config || {};
    const dashboardHtml = dashResponse ? `<div class="card" style="text-align:left"><h3>Configuration Dashboard · ${esc(c.name || 'Client')}</h3><p class="detail-meta">Ces réglages sont propres à ce client et partagés par ses stations. Modifier le client sélectionné ne modifie pas les autres comptes clients.</p><h4>Cartes KPI</h4>${clientDashChecks(id, 'cards', dashCfg.cards)}<h4>Graphiques</h4>${clientDashChecks(id, 'charts', dashCfg.charts)}<h4>Sections</h4>${clientDashChecks(id, 'sections', dashCfg.sections)}<h4>Raccourcis</h4><p class="detail-meta">Codes autorisés : ${CLIENT_DASH_SHORTCUTS.join(', ')}</p><input id="client_dash_${id}_shortcuts" class="q" style="width:100%" value="${escv((dashCfg.shortcuts || []).join(', '))}"><div class="detail-actions" style="margin-top:12px"><button onclick="saveClientDashboardConfig(${id})">Enregistrer la configuration</button><button class="b2" onclick="resetClientDashboardConfig(${id})">Réinitialiser</button></div></div>` : '<p class="warn">Impossible de charger la configuration Dashboard. Vérifiez la migration 055 et les droits Super Admin.</p>';
    const tabsHtml = tabs('admin-client-detail', [['overview','Vue d’ensemble'],['contract','Contrat / abonnement'],['users','Utilisateurs'],['modules','Modules'],['dashboard','Config Dashboard'],['history','Historique'],['maintenance','Sauvegardes / restauration'],['ads','Publicité personnalisée']], 'overview');
    const html = `<div class="detail-page"><div class="detail-head"><div><h2>${esc(c.name || 'Client')}</h2><div class="detail-meta">Fiche administrative Super Admin · Client #${id} · ${tag}</div></div><div class="detail-actions"><button class="b2" onclick="go('clients')">← Liste des clients</button></div></div>${tabsHtml}${pane('admin-client-detail','overview',true,overview)}${pane('admin-client-detail','contract',false,contractHtml)}${pane('admin-client-detail','users',false,usersHtml)}${pane('admin-client-detail','modules',false,modsHtml)}${pane('admin-client-detail','dashboard',false,dashboardHtml)}${pane('admin-client-detail','history',false,historyHtml)}${pane('admin-client-detail','maintenance',false,maintenanceHtml)}${pane('admin-client-detail','ads',false,typeof renderClientAdEditor === 'function' ? await renderClientAdEditor(id) : '<p class="detail-empty">L’éditeur publicitaire individualisé sera activé dans la prochaine étape technique.</p>')}</div>`;
    setTimeout(() => { const root = document.getElementById('pg'); if (root) bindTabs(root); }, 0);
    return html;
  };


  // Fiche individuelle d'un compte rattaché à un client (Super Admin uniquement).
  VM.clientuserdetail = async function () {
    detailStyle();
    if (!(ME && ME.is_global)) return '<p class="warn">Cette interface est réservée au Super Admin.</p>';
    const match = String(arg || '').match(/^(\d+):(\d+)$/);
    if (!match) return '<p class="warn">Compte client invalide.</p>';
    const clientId = Number(match[1]), userId = Number(match[2]);
    const [clients, users] = await Promise.all([
      G('/admin/clients'), G('/admin/clients/' + clientId + '/users')
    ]);
    const clientList = Array.isArray(clients) ? clients : (clients.clients || []);
    const client = clientList.find(x => Number(x.id || x.client_id) === clientId);
    const user = (Array.isArray(users) ? users : []).find(x => Number(x.id) === userId);
    if (!client || !user) return '<p class="warn">Compte introuvable : seul l’administrateur local d’un client est accessible au Superadmin.</p>';
    if (user.role !== 'ADMIN') return '<p class="warn">Seul l’administrateur local d’un client est accessible au Superadmin.</p>';
    const status = user.active ? '<span class="tag g">Actif</span>' : '<span class="tag x">Inactif</span>';
    const session = user.session_active ? '<span class="tag g">Session active</span>' : '<span class="tag">Aucune session active</span>';
    // Séparation des rôles : le Superadmin ne voit et ne gère que l'administrateur local ; gérant, comptable, caissier, pompiste… relèvent de l'administrateur local.
    const resetBlock = user.active
      ? `<div class="detail-actions"><button class="b2" onclick="clientUserResetPassword(${clientId},${userId},${JSON.stringify(user.login || '').replace(/"/g, '&quot;')})">Réinitialiser le mot de passe</button></div><p class="detail-meta">En cas d’oubli ou de perte : un mot de passe temporaire est créé et affiché une seule fois ; les sessions de ce compte sont fermées.</p>`
      : '<p class="detail-meta">Compte désactivé : réactivez-le avant de réinitialiser son mot de passe.</p>';
    const roleNote = `<div class="card" style="text-align:left;margin-bottom:12px"><h3>Administrateur local</h3>
      <p class="detail-meta">Le Superadmin ne gère que l’<b>administrateur local</b> du compte client. Les postes et rôles d’exploitation (gérant, comptable, caissier, pompiste…) sont attribués et gérés par l’administrateur local, dans la limite des modules du contrat.</p>
      <p><span class="tag g">Administrateur local</span></p>${resetBlock}</div>`;
    const details = roleNote + `<div class="cards">${card('Statut du compte', status)}${card('Rôle', esc(user.role_label || user.role || '—'))}${card('Stations liées', esc(user.stations_count ?? '—'))}${card('Session', session)}</div>
      <div class="card" style="text-align:left;margin-top:12px"><h3>Identité et activité</h3><div class="detail-grid">
      <p><b>Nom complet</b><br>${esc(user.full_name || '—')}</p><p><b>Identifiant</b><br>${esc(user.login || '—')}</p><p><b>Fonction</b><br>${esc(user.job_title || '—')}</p><p><b>Rôle technique</b><br>${esc(user.role || '—')}</p><p><b>Créé le</b><br>${dt(user.created_at)}</p><p><b>Dernière connexion</b><br>${user.last_login_at ? dt(user.last_login_at) : 'Jamais connecté'}</p></div></div>
      <div class="card" style="text-align:left;margin-top:12px"><h3>Client rattaché</h3><div class="detail-grid"><p><b>Entreprise</b><br>${esc(client.name || '—')}</p><p><b>Code client</b><br>${esc(client.code || '—')}</p><p><b>Licence</b><br>${esc(client.license_status || client.contract_status || '—')}</p></div></div>`;
    return `<div class="detail-page"><div class="detail-head"><div><h2>Profil du compte client</h2><div class="detail-meta">${esc(client.name || 'Client')} · Compte #${userId}</div></div><div class="detail-actions"><button class="b2" onclick="go('clientdetail',${clientId})">← Retour à la fiche client</button><button class="b2" onclick="go('clients')">Liste des clients</button></div></div>${details}<p class="detail-meta">Cette fiche affiche uniquement les informations administratives disponibles. Les changements de rôle et de permissions restent soumis aux contrôles de sécurité existants.</p></div>`;
  };
  window.clientUserResetPassword = function (clientId, userId, login) {
    modal(`<h3>Réinitialiser le mot de passe</h3><p>Administrateur local : <b>${esc(login)}</b>. Un mot de passe temporaire sera créé et toutes ses sessions seront fermées.</p><label>Motif (3 caractères minimum)<input id="cu_rp_reason" autocomplete="off" placeholder="Ex. mot de passe oublié"></label><label>Votre mot de passe Super Admin<input type="password" id="cu_rp_pw" autocomplete="current-password"></label><div class="bar"><button onclick="clientUserResetPasswordGo(${clientId},${userId})">Réinitialiser</button><button class="b2" onclick="closeM()">Annuler</button></div>`);
  };
  window.clientUserResetPasswordGo = async function (clientId, userId) {
    const reason = (document.getElementById('cu_rp_reason')?.value || '').trim();
    const pw = document.getElementById('cu_rp_pw')?.value || '';
    if (reason.length < 3) return toast('Motif trop court', 'error');
    if (!pw) return toast('Saisissez votre mot de passe Super Admin', 'error');
    try {
      const r = await Po('/admin/clients/' + clientId + '/users/' + userId + '/reset-password', { reason, superadmin_password: pw });
      modal(`<h3>Mot de passe temporaire créé</h3><p>Transmettez-le à l’administrateur local par un canal sécurisé. Il ne sera plus affiché après fermeture de cette fenêtre.</p><div class="card"><label>Mot de passe temporaire de ${esc(r.login)}</label><input id="cu_rp_temp" readonly value="${esc(r.temporary_password)}" onclick="this.select()"></div><div class="bar"><button onclick="document.getElementById('cu_rp_temp').select();document.execCommand('copy');toast('Mot de passe copié','success')">Copier</button><button class="b2" onclick="closeM();go('clientuserdetail','${clientId}:${userId}')">Fermer</button></div><p style="font-size:12px;color:var(--m)">Les sessions de ce compte ont été fermées. Demandez-lui de changer ce mot de passe dès sa première connexion.</p>`);
    } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };
  window.clientRescueAdmin = function (clientId) {
    modal(`<h3>Administrateur local de secours</h3><p>Un <b>nouveau</b> compte Administrateur local sera créé pour ce client, avec un mot de passe temporaire affiché une seule fois. Les comptes existants ne sont pas modifiés.</p><label>Identifiant (3 caractères minimum)<input id="cu_ra_login" autocomplete="off"></label><label>Nom complet (facultatif)<input id="cu_ra_name" autocomplete="off"></label><label>Motif (3 caractères minimum)<input id="cu_ra_reason" autocomplete="off" placeholder="Ex. compte administrateur perdu"></label><label>Votre mot de passe Super Admin<input type="password" id="cu_ra_pw" autocomplete="current-password"></label><div class="bar"><button onclick="clientRescueAdminGo(${clientId})">Créer</button><button class="b2" onclick="closeM()">Annuler</button></div>`);
  };
  window.clientRescueAdminGo = async function (clientId) {
    const v = id => (document.getElementById(id)?.value || '').trim();
    const login = v('cu_ra_login'), reason = v('cu_ra_reason'), pw = document.getElementById('cu_ra_pw')?.value || '';
    if (login.length < 3) return toast('Identifiant trop court', 'error');
    if (reason.length < 3) return toast('Motif trop court', 'error');
    if (!pw) return toast('Saisissez votre mot de passe Super Admin', 'error');
    try {
      const r = await Po('/admin/clients/' + clientId + '/rescue-admin', { login, full_name: v('cu_ra_name') || undefined, reason, superadmin_password: pw });
      modal(`<h3>Administrateur local créé</h3><p>Transmettez ces accès par un canal sécurisé. Le mot de passe ne sera plus affiché après fermeture de cette fenêtre.</p><div class="card"><label>Identifiant</label><input readonly value="${esc(r.login)}"><label>Mot de passe temporaire</label><input id="cu_ra_temp" readonly value="${esc(r.temporary_password)}" onclick="this.select()"></div><div class="bar"><button onclick="document.getElementById('cu_ra_temp').select();document.execCommand('copy');toast('Mot de passe copié','success')">Copier</button><button class="b2" onclick="closeM();go('clientdetail',${clientId})">Fermer</button></div><p style="font-size:12px;color:var(--m)">Demandez-lui de changer ce mot de passe dès sa première connexion.</p>`);
    } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };
  if (typeof NAVOF !== 'undefined') NAVOF.clientuserdetail = 'clients';
  if (typeof TITLES !== 'undefined') TITLES.clientuserdetail = 'Profil du compte client';

  if (typeof NAVOF !== 'undefined') NAVOF.clientdetail = 'clients';
  if (typeof TITLES !== 'undefined') TITLES.clientdetail = 'Fiche administrative client';

  // Accès direct au panneau publicitaire, sans devoir chercher l’onglet dans la fiche.
  VM.clientads = async function () {
    detailStyle();
    if (!(ME && ME.is_global)) return '<p class="warn">Cette interface est réservée au Super Admin.</p>';
    const id = Number(arg);
    if (!Number.isInteger(id) || id < 1) return '<p class="warn">Client invalide.</p>';
    const all = await G('/admin/clients').catch(() => []);
    const list = Array.isArray(all) ? all : (all.clients || []);
    const c = list.find(x => Number(x.id) === id || Number(x.client_id) === id);
    if (!c) return '<p class="warn">Client introuvable ou inaccessible.</p>';
    const editor = typeof renderClientAdEditor === 'function'
      ? await renderClientAdEditor(id)
      : '<p class="detail-empty">L’éditeur publicitaire n’est pas chargé. Rechargez la page ou vérifiez la version déployée.</p>';
    return `<div class="detail-page"><div class="detail-head"><div><h2>Panneau publicitaire dédié</h2><div class="detail-meta">Client : ${esc(c.name || 'Client')} · #${id}</div></div><div class="detail-actions"><button class="b2" onclick="go('clientdetail',${id})">← Fiche du client</button><button class="b2" onclick="go('clients')">Liste des clients</button></div></div>${editor}</div>`;
  };
  if (typeof NAVOF !== 'undefined') NAVOF.clientads = 'clients';
  if (typeof TITLES !== 'undefined') TITLES.clientads = 'Panneau publicitaire client';

  const navof = typeof NAVOF !== 'undefined' ? NAVOF : null;
  const titles = typeof TITLES !== 'undefined' ? TITLES : null;
  if (navof) { navof.clidet = 'cli'; navof.supdet = 'four'; }
  if (titles) { titles.clidet = 'Fiche client'; titles.supdet = 'Fiche fournisseur'; }
})();


// Actions de maintenance isolée, accessibles uniquement depuis la fiche Super Admin.
window.refreshClientBackups = async function (id) { go('clientdetail', id); };
window.createClientBackup = async function (id) {
  if (!ME?.is_global) return toast('Réservé au Super Admin.', 'error');
  const password = prompt('Saisissez le mot de passe du Super Admin pour créer une sauvegarde isolée de ce client :');
  if (!password) return;
  try {
    const r = await fetch(`/api/admin/clients/${id}/isolated-backups`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+TK},body:JSON.stringify({superadmin_password:password})});
    const out = await r.json(); if (!r.ok) throw new Error(out.error || out.message || 'Sauvegarde refusée.');
    toast(`Sauvegarde isolée créée : ${out.name}`, 'success'); go('clientdetail',id);
  } catch(e) { toast(e.message || String(e),'error'); }
};
window.downloadClientBackup = async function(id,name) {
  if (!ME?.is_global) return toast('Réservé au Super Admin.','error');
  try { const r=await fetch(`/api/admin/clients/${id}/isolated-backups/${encodeURIComponent(name)}`,{headers:{Authorization:'Bearer '+TK}}); if(!r.ok) throw new Error('Téléchargement refusé.'); const blob=await r.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
  catch(e){toast(e.message||String(e),'error');}
};
window.restoreClientBackup = async function(id) {
  if(!ME?.is_global) return toast('Réservé au Super Admin.','error');
  const file=document.getElementById(`client_restore_file_${id}`)?.files?.[0], password=document.getElementById(`client_restore_password_${id}`)?.value||'';
  if(!file||!password) return toast('Sélectionnez une sauvegarde et saisissez le mot de passe Super Admin.','error');
  if(!confirm('Restaurer les données de ce client uniquement ? Une transaction annulera les changements si une erreur survient.')) return;
  try {const r=await fetch(`/api/admin/clients/${id}/isolated-restore`,{method:'POST',headers:{'Content-Type':(/\.json$/i.test(file.name)&&!(/\.json\.gz$/i.test(file.name))?'application/json':'application/gzip'),'X-SuperAdmin-Password':password,Authorization:'Bearer '+TK},body:file});const out=await r.json();if(!r.ok)throw new Error(out.error||out.message||'Restauration refusée.');toast('Restauration isolée terminée. Les comptes, stations et contrat sont conservés.','success');go('clientdetail',id);}
  catch(e){toast(e.message||String(e),'error');}
};
window.resetClientData = async function(id) {
  if(!ME?.is_global) return toast('Réservé au Super Admin.','error');
  const confirmation=document.getElementById(`client_reset_confirmation_${id}`)?.value||'', password=document.getElementById(`client_reset_password_${id}`)?.value||'';
  if(confirmation!=='REINITIALISER CE CLIENT') return toast('Saisissez exactement REINITIALISER CE CLIENT.','error');
  if(!password) return toast('Le mot de passe Super Admin est requis.','error');
  if(!confirm('DANGER : seules les données opérationnelles de ce client seront supprimées. Une sauvegarde isolée sera créée avant. Continuer ?')) return;
  try {const r=await fetch(`/api/admin/clients/${id}/isolated-reset`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+TK},body:JSON.stringify({confirmation,superadmin_password:password})});const out=await r.json();if(!r.ok)throw new Error(out.error||out.message||'Réinitialisation refusée.');toast('Données opérationnelles réinitialisées. Sauvegarde préalable : '+out.backup,'success');go('clientdetail',id);}
  catch(e){toast(e.message||String(e),'error');}
};
