/* ext-platform.js — Finance et rapports de la PLATEFORME (Superadmin uniquement)
   Périmètre : licences, abonnements des clients, dépenses du projet (hébergement, base de données, stockage, domaine, outils...).
   Aucune donnée de station (ventes, caisse, stocks, dettes commerciales) n'est lue ni affichée ici : API /api/admin/platform/*. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const CAT = { hebergement: 'Hébergement', base_de_donnees: 'Base de données', stockage: 'Stockage (fichiers, médias)', domaine: 'Domaine et certificats', licences_logicielles: 'Licences logicielles et outils', api_paiement: 'API payantes et frais de paiement', maintenance: 'Maintenance', developpement: 'Développement', support: 'Support', communication: 'Communication', autre: 'Autre' };
  const KIND = { licence: 'Licence', abonnement: 'Abonnement', mise_en_service: 'Frais de mise en service', autre: 'Autre recette' };
  const STATE = { impayee: 'Impayée', partielle: 'Partielle', soldee: 'Soldée', en_retard: 'En retard', annulee: 'Annulée' };
  const TABS = [['sum', 'Synthèse'], ['inv', 'Recettes (licences / abonnements)'], ['exp', 'Dépenses du projet'], ['rep', 'Rapports']];
  let TAB = 'sum', FROM = '', TO = '';
  const day = d => (d ? String(d).slice(0, 10) : '—');
  const card = (l, v, sub) => `<div class="card"><small>${l}</small><b>${v}</b>${sub ? `<small style="display:block;color:var(--m)">${sub}</small>` : ''}</div>`;
  const q = () => (FROM ? '&from=' + FROM : '') + (TO ? '&to=' + TO : '');

  function tabs() {
    return `<div class="subtabs" style="margin-bottom:12px">${TABS.map(([k, l]) => `<a class="${k === TAB ? 'on' : ''}" onclick="pfTab('${k}')">${l}</a>`).join('')}</div>`;
  }
  function periodBar() {
    return `<div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:12px"><label style="flex-direction:row;align-items:center;gap:6px">Du <input type="date" id="pf_from" value="${FROM}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px">au <input type="date" id="pf_to" value="${TO}"></label>
      <button class="b2" onclick="pfPeriod()">Appliquer</button><button class="b2" onclick="pfPeriod(true)">Tout</button></div>`;
  }

  async function sum() {
    const s = await G('/admin/platform/summary?x=1' + q());
    return `${periodBar()}<div class="cards">
      ${card('Facturé (période)', f(s.invoiced), 'Recettes émises, hors factures annulées')}
      ${card('Encaissé (période)', f(s.collected), 'Paiements réellement reçus')}
      ${card('Dépenses engagées (période)', f(s.expenses_committed))}
      ${card('Dépenses payées (période)', f(s.expenses_paid))}
      ${card('Créances à ce jour', f(s.receivables), 'dont en retard : ' + f(s.receivables_overdue))}
      ${card('Dettes à ce jour', f(s.payables), 'Dépenses non encore réglées')}
      ${card('Trésorerie', f(s.treasury), 'Tous encaissements − tous paiements')}
      ${card('Résultat (engagement)', f(s.result_accrual), 'Facturé − dépenses engagées')}
      ${card('Résultat (trésorerie)', f(s.result_cash), 'Encaissé − payé')}</div>
      ${T(['Catégorie de dépense', 'Engagé'], (s.expenses_by_category || []).map(c => [esc(CAT[c.category] || c.category), f(c.committed)]))}
      <p style="font-size:12px;color:var(--m)">${esc(s.method)} Seules les opérations enregistrées sur cette page sont comptées ; la comptabilité des stations n'est jamais incluse.</p>`;
  }

  async function inv() {
    const rows = await G('/admin/platform/invoices');
    return `<div class="bar"><button onclick="pfNewInvoice()">Nouvelle facture</button></div>
      ${T(['Date', 'Client', 'Type', 'Libellé', 'Montant', 'Encaissé', 'Solde', 'Échéance', 'État', ''], rows.map(x => [day(x.issued_on), esc(x.client_name || '—'), esc(KIND[x.kind] || x.kind), esc(x.label), f(x.amount), f(x.paid), f(x.balance), day(x.due_on), esc(STATE[x.pay_state] || x.pay_state),
        x.pay_state === 'annulee' ? '' : (x.balance > 0 ? `<button class="b2" onclick="pfPay('invoices',${x.id},${x.balance})">Encaisser</button> ` : '') + (+x.paid === 0 ? `<button class="b2" onclick="pfCancel('invoices',${x.id})">Annuler</button>` : '')]))}`;
  }

  async function exp() {
    const rows = await G('/admin/platform/expenses');
    return `<div class="bar"><button onclick="pfNewExpense()">Nouvelle dépense</button></div>
      ${T(['Date', 'Catégorie', 'Libellé', 'Fournisseur', 'Montant', 'Payé', 'Reste', 'Échéance', 'État', ''], rows.map(x => [day(x.expense_date), esc(CAT[x.category] || x.category), esc(x.label), esc(x.supplier || '—'), f(x.amount), f(x.paid), f(x.balance), day(x.due_on), esc(STATE[x.pay_state] || x.pay_state),
        x.pay_state === 'annulee' ? '' : (x.balance > 0 ? `<button class="b2" onclick="pfPay('expenses',${x.id},${x.balance})">Régler</button> ` : '') + (+x.paid === 0 ? `<button class="b2" onclick="pfCancel('expenses',${x.id})">Annuler</button>` : '')]))}`;
  }

  async function rep() {
    const list = await G('/admin/platform/reports');
    const c = await G('/admin/platform/report-colors');
    return `<p style="color:var(--m);margin-top:0">Rapports de la plateforme uniquement. Chaque rapport peut être affiché ou exporté en PDF ou Excel. Les exports CSV ont été retirés de cette interface.</p>
      <div class="card" style="margin:12px 0"><b>Couleurs des rapports Super Admin</b><p style="font-size:12px;color:var(--m)">Ces couleurs s’appliquent uniquement aux exports PDF et Excel de la plateforme, jamais aux rapports des clients.</p><div class="g"><label>Couleur principale <input id="pfr_primary" type="color" value="${esc(c.primary)}"></label><label>Fond des en-têtes <input id="pfr_secondary" type="color" value="${esc(c.secondary)}"></label><label>Couleur du texte <input id="pfr_text" type="color" value="${esc(c.text)}"></label></div><button onclick="pfSaveReportColors()">Enregistrer les couleurs</button></div>
      ${T(['Rapport', ''], list.map(r => [esc(r.title), `<button class="b2" onclick="pfReport('${r.key}')">Afficher</button> <button class="b2" onclick="pfPdf('${r.key}')">PDF</button> <button class="b2" onclick="pfXlsx('${r.key}')">Excel</button>`]))}<div id="pf_rep"></div>`;
  }

  async function vPfin() {
    const body = TAB === 'inv' ? await inv() : TAB === 'exp' ? await exp() : TAB === 'rep' ? await rep() : await sum();
    return `<h2 style="margin-top:0">Finance de la plateforme</h2>
      <p style="font-size:13px;color:var(--m);margin-top:0">Licences, abonnements des clients et dépenses du projet. Distincte de la comptabilité des stations.</p>${tabs()}${body}`;
  }

  window.pfTab = k => { TAB = k; go('pfin'); };
  window.pfPeriod = reset => { FROM = reset ? '' : $('#pf_from').value; TO = reset ? '' : $('#pf_to').value; go('pfin'); };
  window.pfNewInvoice = safe(async () => {
    const cl = await G('/admin/clients').catch(() => []);
    const list = Array.isArray(cl) ? cl : (cl.clients || []);
    form('Nouvelle facture', [['client_id', 'Client', 's', [['', '— aucun —'], ...list.map(c => [c.id, c.name])]], ['kind', 'Type', 's', Object.entries(KIND)], ['label', 'Libellé'], ['amount', 'Montant', 'number'], ['issued_on', 'Date d\'émission', 'date'], ['due_on', 'Échéance', 'date'], ['reference', 'Référence / pièce']],
      { kind: 'licence', issued_on: new Date().toISOString().slice(0, 10) }, async d => {
        await Po('/admin/platform/invoices', { client_id: d.client_id ? +d.client_id : null, kind: d.kind, label: d.label, amount: d.amount, issued_on: d.issued_on || undefined, due_on: d.due_on || null, reference: d.reference || null });
        closeM(); toast('Facture enregistrée', 'success'); TAB = 'inv'; go('pfin');
      });
  });
  window.pfNewExpense = safe(async () => {
    form('Nouvelle dépense du projet', [['category', 'Catégorie', 's', Object.entries(CAT)], ['label', 'Libellé'], ['supplier', 'Fournisseur / prestataire'], ['amount', 'Montant', 'number'], ['expense_date', 'Date', 'date'], ['due_on', 'Échéance', 'date'], ['reference', 'Référence / pièce justificative']],
      { category: 'hebergement', expense_date: new Date().toISOString().slice(0, 10) }, async d => {
        await Po('/admin/platform/expenses', { category: d.category, label: d.label, supplier: d.supplier || null, amount: d.amount, expense_date: d.expense_date || undefined, due_on: d.due_on || null, reference: d.reference || null });
        closeM(); toast('Dépense enregistrée', 'success'); TAB = 'exp'; go('pfin');
      });
  });
  window.pfPay = safe(async (kind, id, left) => {
    form(kind === 'invoices' ? 'Encaissement' : 'Règlement', [['amount', 'Montant (solde : ' + left + ')', 'number'], ['paid_on', 'Date', 'date'], ['method', 'Moyen de paiement'], ['reference', 'Référence']],
      { amount: left, paid_on: new Date().toISOString().slice(0, 10) }, async d => {
        await Po('/admin/platform/' + kind + '/' + id + '/payments', { amount: d.amount, paid_on: d.paid_on || undefined, method: d.method || null, reference: d.reference || null });
        closeM(); toast('Opération enregistrée', 'success'); go('pfin');
      });
  });
  window.pfCancel = (kind, id) => ask('Annuler cette opération ? Elle sera exclue des calculs.', async () => { await Po('/admin/platform/' + kind + '/' + id + '/cancel'); toast('Opération annulée', 'success'); go('pfin'); });
  window.pfSaveReportColors = safe(async () => {
    const colors = { primary: $('#pfr_primary').value, secondary: $('#pfr_secondary').value, text: $('#pfr_text').value };
    // Serveur attend PUT (pas POST) — Po provoquait 404/405.
    await api('PUT', '/admin/platform/report-colors', { colors });
    toast('Couleurs des rapports Super Admin enregistrées', 'success');
  });
  window.pfReport = safe(async key => {
    const d = await G('/admin/platform/reports/' + key);
    const cell = c => (typeof c === 'number' ? new Intl.NumberFormat(loc(), { maximumFractionDigits: 2 }).format(c) : esc(c == null ? '' : c));
    const body = d.rows.map(r => r.map(cell)), foot = (d.totals || []).map(r => r.map(c => '<b>' + cell(c) + '</b>'));
    $('#pf_rep').innerHTML = `<h3>${esc(d.title)}</h3>${T(d.columns.map(esc), body.concat(foot))}${d.rows.length ? '' : '<p class="dv2-empty">Aucune donnée sur la période.</p>'}`;
  });
  window.pfPdf = safe(async key => {
    const r = await fetch('/api/admin/platform/reports/' + key + '?format=pdf', { headers: { Authorization: 'Bearer ' + TK } });
    if (!r.ok) throw new Error('Export PDF impossible (' + r.status + ')');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'plateforme-' + key + '.pdf'; document.body.appendChild(a); a.click(); a.remove();
  });
  window.pfXlsx = safe(async key => {
    const r = await fetch('/api/admin/platform/reports/' + key + '?format=xlsx', { headers: { Authorization: 'Bearer ' + TK } });
    if (!r.ok) throw new Error('Export Excel impossible (' + r.status + ')');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'plateforme-' + key + '.xlsx'; document.body.appendChild(a); a.click(); a.remove();
  });

  Object.assign(V, { pfin: ['Finance plateforme', 'user.manage'] });
  Object.assign(VM, { pfin: vPfin });
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.pfin = '📈';
})();
