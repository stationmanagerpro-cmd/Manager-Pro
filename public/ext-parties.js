/* ext-parties.js — Pages « Fournisseurs » et « Clients » : en-tête + boutons, cartes de synthèse,
   recherche, tableau (nom + code, contact, adresse, montants), profil au clic.
   Remplace VM.four et VM.cli ; à charger après ext-detail-pages.js. */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  const num = v => Number(v) || 0;
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const code = (pre, id) => pre + String(id).padStart(4, '0');
  const short = (s, n) => { s = String(s || '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const ini = n => (typeof initials === 'function' ? initials(n) : String(n || '?').slice(0, 2).toUpperCase());
  const money = v => (v == null ? '—' : f(v));
  const safe = fn => (typeof fn === 'function' ? fn : () => '');

  function avatar(ent, r) {
    return r.photo_path
      ? `<img class="pc-thumb" data-ent="${ent}" data-id="${Number(r.id)}" data-name="${esc(r.name)}" alt="">`
      : `<span class="pc-thumb">${esc(ini(r.name))}</span>`;
  }
  function kpi(icon, label, value, note, hot) {
    return `<div class="pt-kpi${hot ? ' pt-hot' : ''}"><div class="pt-kl"><span>${icon}</span>${esc(label)}</div><div class="pt-kv">${value}</div>${note ? `<div class="pt-kn">${esc(note)}</div>` : ''}</div>`;
  }
  function amount(v, kind) {          // kind : 'owed' (rouge si > 0) ; v < 0 = crédit (vert)
    if (v == null) return '<span class="pt-zero">—</span>';
    v = num(v);
    if (v > 0) return `<span class="pt-red">${f(v)}</span>`;
    if (v < 0) return `<span class="pt-green">Crédit ${f(-v)}</span>`;
    return '<span class="pt-zero">0</span>';
  }

  window.ptFilter = function (val) {
    const q = norm(val).trim(); let n = 0, tot = 0;
    document.querySelectorAll('#pt-body tr[data-s]').forEach(tr => {
      tot++; const ok = !q || tr.dataset.s.includes(q); tr.style.display = ok ? '' : 'none'; if (ok) n++;
    });
    const c = document.getElementById('pt-count'), lab = c && c.dataset.label;
    if (c) c.textContent = n === tot ? `${tot} ${lab}` : `${n} sur ${tot} ${lab}`;
  };

  function buttons(c) {
    const b = [];
    if (c.canAdd && !c.inactive) b.push(`<button onclick="${c.addFn}()">${c.addIcon} ${c.addLabel}</button>`);
    if (c.extraBtn) b.push(c.extraBtn);
    if (c.canImport && !c.inactive)
      b.push(`<button class="b2" onclick="typeof impStart==='function'?impStart('${c.kind}'):go('imports')">⬆ Importer</button><button class="b2" onclick="typeof impDownload==='function'&&impDownload('${c.kind}')" title="Télécharger le modèle Excel à remplir">Modèle</button>`);
    if (c.canExport)
      b.push(`<button class="b2" onclick="exportList('${c.kind}','pdf')">📄 Exporter PDF</button><button class="b2" onclick="exportList('${c.kind}','xlsx')">📊 Exporter Excel</button>`);
    b.push(safe(typeof archToggleBtn === 'function' && archToggleBtn)(c.kind));
    return b.join('');
  }

  function page(c) {
    const wide = c.rows.length === 0 ? `<p class="pc-empty">${esc(c.emptyText)}</p>` :
      `<div class="pc-tw"><table class="pc-tbl"><thead><tr>${c.heads.map(h => `<th class="${h.cls || ''}">${h.t}</th>`).join('')}</tr></thead><tbody id="pt-body">${c.rows.join('')}</tbody></table></div>`;
    return `<div class="pc-head"><div><h2 class="pc-title">${esc(c.title)}</h2><div class="pc-subtitle" id="pt-count" data-label="${esc(c.countLabel)}">${c.rows.length} ${esc(c.countLabel)}</div></div><div class="pc-actions">${buttons(c)}</div></div>
      ${typeof archBanner === 'function' ? archBanner(c.kind, c.rows.length) : ''}
      <div class="pt-kpis">${c.kpis.join('')}</div>
      <div class="pc-filters"><input class="pc-q" id="${c.kind === 'customers' ? 'cli-q' : 'four-q'}" type="search" placeholder="${esc(c.placeholder)}" oninput="ptFilter(this.value)"></div>
      ${wide}${c.after || ''}`;
  }

  /* ===================== FOURNISSEURS ===================== */
  VM.four = async function () {
    const hasArch = typeof archQuery === 'function';
    const inactive = !!(hasArch && typeof ARCH !== 'undefined' && ARCH.suppliers);
    const [sp, pu] = await Promise.all([G('/suppliers' + (hasArch ? archQuery('suppliers') : '')), G('/purchases').catch(() => [])]);
    const showDebt = can('debt.view');
    const now = new Date(), ym = now.getFullYear() * 12 + now.getMonth();
    const valid = pu.filter(p => p.status !== 'annule');
    const buys = {}; valid.forEach(p => { buys[p.supplier_id] = (buys[p.supplier_id] || 0) + num(p.total); });
    const monthBuys = valid.filter(p => { const d = new Date(p.ordered_at); return d.getFullYear() * 12 + d.getMonth() === ym; }).reduce((a, p) => a + num(p.total), 0);
    const open = pu.filter(p => p.status === 'commande' || p.status === 'partiel').length;
    const debt = sp.reduce((a, s) => a + Math.max(0, num(s.balance_due)), 0);

    const rows = sp.map(s => `<tr class="pc-row" data-s="${esc(norm([s.name, s.company, s.contact, s.phone, s.email, s.address, code('FOU-', s.id)].join(' ')))}" onclick="showSup(${Number(s.id)})" title="Ouvrir la fiche du fournisseur">
      <td><div class="pc-prod">${avatar('suppliers', s)}<div><b>${esc(s.name)}</b><small>${code('FOU-', s.id)}${s.contact ? ' · ' + esc(s.contact) : ''}</small></div></div></td>
      <td><div>${esc(s.phone || '—')}</div><small class="pt-sub">${esc(s.email || '')}</small></td>
      <td class="pc-hide-sm">${esc(short(s.address, 30) || '—')}</td>
      <td class="pc-num pc-hide-sm">${f(buys[s.id] || 0)}</td>
      ${showDebt ? `<td class="pc-num">${amount(s.balance_due)}</td>` : ''}
      <td class="pc-act" onclick="event.stopPropagation()">${safe(typeof archRowBtn === 'function' && archRowBtn)('suppliers', s.id, inactive, s.name)}</td></tr>`);

    const orders = pu.length ? '<h3 style="margin-top:22px">Commandes d’achat</h3>' + T(['Commande', 'Fournisseur', 'Statut', 'Total commandé', 'Facture', 'Payé'], pu.map(p => [
      esc(p.order_no), esc(p.supplier), `<span class="tag">${esc(p.status)}</span>`, f(p.total), esc(p.invoice_no || ''), f(p.paid)
    ]), i => `showPO(${pu[i].id})`) : '';

    return page({
      kind: 'suppliers', title: 'Fournisseurs', countLabel: 'fournisseur(s)', inactive, rows,
      placeholder: 'Nom, code, contact…', emptyText: inactive ? 'Aucun fournisseur inactif.' : 'Aucun fournisseur.',
      canAdd: can('supplier.edit'), addFn: 'addSup', addIcon: '＋', addLabel: 'Nouveau fournisseur',
      extraBtn: can('purchase.manage') && !inactive ? '<button class="b2" onclick="addPO()">🛒 Nouvelle commande</button>' : '',
      canImport: can('supplier.edit'), canExport: can('export.suppliers'),
      heads: [{ t: 'Fournisseur' }, { t: 'Contact' }, { t: 'Adresse', cls: 'pc-hide-sm' }, { t: 'Achats', cls: 'pc-num pc-hide-sm' }].concat(showDebt ? [{ t: 'Dette', cls: 'pc-num' }] : [], [{ t: '' }]),
      kpis: [
        kpi('🚚', 'Fournisseurs', sp.length),
        kpi('💰', 'Dettes fournisseurs', showDebt ? f(debt) : '—', showDebt ? 'À régler' : 'Accès restreint', true),
        kpi('📦', 'Commandes en cours', open),
        kpi('🛍️', 'Achats du mois', f(monthBuys))
      ],
      after: orders
    });
  };

  /* ===================== CLIENTS ===================== */
  VM.cli = async function () {
    const hasArch = typeof archQuery === 'function';
    const inactive = !!(hasArch && typeof ARCH !== 'undefined' && ARCH.customers);
    const ls = await G('/customers' + (hasArch ? archQuery('customers') : '')).catch(() => []);
    const showBal = can('receivable.view');
    const owed = ls.reduce((a, c) => a + Math.max(0, num(c.balance)), 0);
    const debtors = ls.filter(c => num(c.balance) > 0).length;
    const blocked = ls.filter(c => c.credit_blocked).length;

    const rows = ls.map(c => `<tr class="pc-row" data-s="${esc(norm([c.name, c.company, c.kind, c.phone, c.email, c.address, code('CLI-', c.id)].join(' ')))}" onclick="showCli(${Number(c.id)})" title="Ouvrir la fiche du client">
      <td><div class="pc-prod">${avatar('customers', c)}<div><b>${esc(c.name)}</b><small>${code('CLI-', c.id)} · ${esc(c.company || c.kind || '')}${c.credit_blocked ? ' · <span class="pt-red">crédit bloqué</span>' : ''}</small></div></div></td>
      <td><div>${esc(c.phone || '—')}</div><small class="pt-sub">${esc(c.email || '')}</small></td>
      <td class="pc-hide-sm">${esc(short(c.address, 30) || '—')}</td>
      <td class="pc-num pc-hide-sm">${f(c.credit_limit || 0)}</td>
      ${showBal ? `<td class="pc-num">${amount(c.balance)}</td>` : ''}
      <td class="pc-act" onclick="event.stopPropagation()">${(showBal && num(c.balance) > 0 && can('cash.manage|sale.create') ? `<button class="b2" onclick="payCli(${Number(c.id)},${num(c.balance)})">Encaisser</button> ` : '')}${safe(typeof archRowBtn === 'function' && archRowBtn)('customers', c.id, inactive, c.name)}</td></tr>`);

    return page({
      kind: 'customers', title: 'Clients', countLabel: 'client(s)', inactive, rows,
      placeholder: 'Nom, code, téléphone…', emptyText: inactive ? 'Aucun client inactif.' : 'Aucun client.',
      canAdd: can('customer.edit'), addFn: 'addCli', addIcon: '＋', addLabel: 'Nouveau client',
      canImport: can('customer.edit'), canExport: can('export.customers'),
      heads: [{ t: 'Client' }, { t: 'Contact' }, { t: 'Adresse', cls: 'pc-hide-sm' }, { t: 'Limite', cls: 'pc-num pc-hide-sm' }].concat(showBal ? [{ t: 'Solde', cls: 'pc-num' }] : [], [{ t: '' }]),
      kpis: [
        kpi('👥', 'Clients', ls.length),
        kpi('💰', 'Créances clients', showBal ? f(owed) : '—', showBal ? 'À encaisser' : 'Accès restreint', true),
        kpi('🧾', 'Clients débiteurs', showBal ? debtors : '—'),
        kpi('⛔', 'Crédit bloqué', blocked)
      ]
    });
  };
})();
