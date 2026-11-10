/* Priorité 3 — Fiches client / fournisseur */
(function () {
  if (typeof window === 'undefined') return;

  window.showCli = safe(async id => {
    const h = await G('/customers/' + id + '/history');
    const c = h.customer || {};
    const sales = (h.sales || []).map(s => [esc(s.invoice_no || s.id), dt(s.sold_at), f(s.total), esc(s.status)]);
    const pays = (h.payments || []).map(p => [dt(p.paid_at), esc(p.method), f(p.amount)]);
    const credits = (h.credits || []).map(x => [f(x.amount), f(x.remaining), esc(x.reason || ''), esc(x.status)]);
    modal(`<h3>${esc(c.name)}${can('receivable.view') ? ' · solde ' + f(c.balance) : ''}</h3>
      <p style="font-size:13px">Limite crédit : ${f(c.credit_limit)}</p>
      <div class="bar">
        <button class="b2" onclick="editCli(${id})">Modifier</button>
        <button onclick="payCli(${id},${c.balance || 0})">Encaisser</button>
        <button class="b2" onclick="addCliCredit(${id})">Avoir</button>
      </div>
      <h4>Ventes</h4>${T(['Facture', 'Date', 'Total', 'Statut'], sales)}
      <h4>Paiements</h4>${T(['Date', 'Mode', 'Montant'], pays)}
      <h4>Avoirs</h4>${T(['Montant', 'Restant', 'Motif', 'Statut'], credits)}
      <div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>`);
  });

  window.editCli = safe(async id => {
    const c = await G('/customers/' + id);
    form('Modifier client', [
      ['name', 'Nom'], ['kind', 'Type', 's', ['particulier', 'entreprise', 'professionnel', 'credit']],
      ['phone', 'Téléphone'], ['email', 'E-mail'], ['address', 'Adresse'], ['company', 'Société'],
      ['credit_limit', 'Limite crédit', 'number'], ['notes', 'Notes'],
      ['loyalty_tier', 'Fidélité', 's', ['standard', 'silver', 'gold']],
      ['credit_blocked', 'Crédit bloqué', 's', [['false', 'Non'], ['true', 'Oui']]]
    ], {
      name: c.name, kind: c.kind, phone: c.phone || '', email: c.email || '', address: c.address || '',
      company: c.company || '', credit_limit: c.credit_limit, notes: c.notes || '',
      loyalty_tier: c.loyalty_tier || 'standard', credit_blocked: c.credit_blocked ? 'true' : 'false'
    }, async d => {
      d.credit_blocked = d.credit_blocked === 'true';
      d.credit_limit = +d.credit_limit;
      await api('PATCH', '/customers/' + id, d);
      closeM(); toast('Client mis à jour', 'success'); go('cli');
    });
  });

  window.addCliCredit = safe(async id => {
    form('Avoir client', [['amount', 'Montant', 'number'], ['reason', 'Motif']], {}, async d => {
      const r = await Po('/customers/' + id + '/credits', { amount: +d.amount, reason: d.reason });
      closeM(); toast((r && r.note) || 'Avoir enregistré', 'success'); showCli(id);
    });
  });

  window.showSup = safe(async id => {
    const h = await G('/suppliers/' + id + '/history');
    const s = h.supplier || {};
    const pu = (h.purchases || []).map(p => [esc(p.number || p.order_no || p.id), esc(p.status), f(p.total), dt(p.ordered_at)]);
    const credits = (h.credits || []).map(x => [f(x.amount), f(x.remaining), esc(x.reason || ''), esc(x.status)]);
    modal(`<h3>${esc(s.name)}${can('debt.view') ? ' · dette ' + f(s.balance_due) : ''}</h3>
      <div class="bar">
        <button class="b2" onclick="editSup(${id})">Modifier</button>
        <button class="b2" onclick="addSupCredit(${id})">Avoir</button>
      </div>
      <h4>Achats</h4>${T(['N°', 'Statut', 'Total', 'Date'], pu)}
      <h4>Avoirs</h4>${T(['Montant', 'Restant', 'Motif', 'Statut'], credits)}
      <div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>`);
  });

  window.editSup = safe(async id => {
    const s = await G('/suppliers/' + id);
    form('Modifier fournisseur', [
      ['name', 'Nom'], ['company', 'Société'], ['phone', 'Téléphone'], ['email', 'E-mail'],
      ['address', 'Adresse'], ['contact', 'Contact'], ['tax_id', 'NIF'],
      ['payment_terms_days', 'Délai paiement (j)', 'number'], ['bank_info', 'Infos bancaires'], ['notes', 'Notes']
    ], {
      name: s.name, company: s.company || '', phone: s.phone || '', email: s.email || '',
      address: s.address || '', contact: s.contact || '', tax_id: s.tax_id || '',
      payment_terms_days: s.payment_terms_days ?? 30, bank_info: s.bank_info || '', notes: s.notes || ''
    }, async d => {
      d.payment_terms_days = +d.payment_terms_days;
      await api('PATCH', '/suppliers/' + id, d);
      closeM(); toast('Fournisseur mis à jour', 'success'); go('four');
    });
  });

  window.addSupCredit = safe(async id => {
    form('Avoir fournisseur', [['amount', 'Montant', 'number'], ['reason', 'Motif']], {}, async d => {
      const r = await Po('/suppliers/' + id + '/credits', { amount: +d.amount, reason: d.reason });
      closeM(); toast((r && r.note) || 'Avoir enregistré', 'success'); showSup(id);
    });
  });

  // Enrichir listes existantes si possible
  const _vCli = typeof VM !== 'undefined' && VM.cli;
  const _vFour = typeof VM !== 'undefined' && VM.four;
  if (typeof VM !== 'undefined') {
    const exportBtn = (kind, perm, label) => can(perm)
      ? `<button class="b2" onclick="exportList('${kind}','pdf')">📄 Exporter PDF</button><button class="b2" onclick="exportList('${kind}','xlsx')">Excel</button>` : '';
    VM.cli = async function () {
      const ls = await G('/customers' + archQuery('customers')), showBal = can('receivable.view'), inactiveView = ARCH.customers;
      return `<div class="bar"><input class="q" id="cli-q" placeholder="Rechercher un client" oninput="flt(this)">${can('customer.edit') && !inactiveView ? '<button onclick="addCli()">Ajouter un client</button>' : ''}${exportBtn('customers', 'export.customers')}${archToggleBtn('customers')}</div>` +
        archBanner('customers', ls.length) +
        `<p style="color:var(--m);font-size:13px;margin:0 0 8px">${ls.length} client(s) ${inactiveView ? 'inactif(s)' : 'actif(s)'}</p>` +
        T(['', 'Client', 'Type', 'Tél.', 'Limite'].concat(showBal ? ['Solde'] : [], ['']), ls.map(c => [
          av('customers', c.id, c.photo_path, c.name),
          `<a href="#" onclick="event.stopPropagation();showCli(${c.id});return false">${esc(c.name)}</a>`,
          esc(c.kind), esc(c.phone || ''), f(c.credit_limit)
        ].concat(showBal ? [f(c.balance)] : [], [
          (showBal && c.balance > 0 && can('cash.manage|sale.create') ? `<button class="b2" onclick="event.stopPropagation();payCli(${c.id},${c.balance})">Encaisser</button> ` : '') +
          archRowBtn('customers', c.id, inactiveView, c.name)
        ]), i => `showCli(${ls[i].id})`));
    };
    VM.four = async function () {
      const [sp, pu] = await Promise.all([G('/suppliers' + archQuery('suppliers')), G('/purchases').catch(() => [])]), showDebt = can('debt.view'), inactiveView = ARCH.suppliers;
      return `<div class="bar"><input class="q" id="four-q" placeholder="Rechercher un fournisseur" oninput="flt(this)">${can('supplier.edit') && !inactiveView ? '<button onclick="addSup()">Ajouter un fournisseur</button>' : ''}${can('purchase.manage') && !inactiveView ? '<button onclick="addPO()">Nouvelle commande</button>' : ''}${exportBtn('suppliers', 'export.suppliers')}${archToggleBtn('suppliers')}</div>` +
        archBanner('suppliers', sp.length) +
        `<p style="color:var(--m);font-size:13px;margin:0 0 8px">${sp.length} fournisseur(s) ${inactiveView ? 'inactif(s)' : 'actif(s)'}</p>` +
        T(['', 'Fournisseur', 'Téléphone'].concat(showDebt ? ['Dette'] : [], ['']), sp.map(s => [
          av('suppliers', s.id, s.photo_path, s.name),
          `<a href="#" onclick="event.stopPropagation();showSup(${s.id});return false">${esc(s.name)}</a>`,
          esc(s.phone || '')
        ].concat(showDebt ? [f(s.balance_due)] : [], [archRowBtn('suppliers', s.id, inactiveView, s.name)])), i => `showSup(${sp[i].id})`) +
        '<h3>Achats</h3>' + T(['Commande', 'Fournisseur', 'Statut', 'Total commandé', 'Facture', 'Payé'], pu.map(p => [
          esc(p.order_no), esc(p.supplier), `<span class="tag">${p.status}</span>`, f(p.total), esc(p.invoice_no || ''), f(p.paid)
        ]), i => `showPO(${pu[i].id})`);
    };
    // Export de la liste (le serveur revérifie la permission et masque dettes/créances si non autorisé)
    window.exportList = function (kind, fmt) {
      const q = (document.getElementById(kind === 'customers' ? 'cli-q' : 'four-q') || {}).value || '';
      dlFile(`/exports/${kind}?format=${fmt}&active=${ARCH[kind] ? 'false' : 'true'}${q.trim() ? '&q=' + encodeURIComponent(q.trim()) : ''}`, kind + '-' + new Date().toISOString().slice(0, 10));
    };
  }

  // Formulaires création enrichis
  window.addCli = safe(async () => {
    form('Client', [
      ['name', 'Nom'], ['kind', 'Type', 's', ['particulier', 'entreprise', 'professionnel', 'credit']],
      ['phone', 'Téléphone'], ['email', 'E-mail'], ['address', 'Adresse'], ['company', 'Société'],
      ['credit_limit', 'Limite de crédit', 'number'], ['notes', 'Notes']
    ], {}, async d => {
      d.credit_limit = +d.credit_limit || 0;
      await Po('/customers', d);
      closeM(); go('cli');
    });
  });

  window.addSup = safe(async () => {
    form('Fournisseur', [
      ['name', 'Nom'], ['company', 'Société'], ['phone', 'Téléphone'], ['email', 'E-mail'],
      ['address', 'Adresse'], ['contact', 'Contact'], ['tax_id', 'NIF'],
      ['payment_terms_days', 'Délai (j)', 'number'], ['notes', 'Notes']
    ], { payment_terms_days: 30 }, async d => {
      d.payment_terms_days = +d.payment_terms_days || 30;
      await Po('/suppliers', d);
      closeM(); go('four');
    });
  });
})();
