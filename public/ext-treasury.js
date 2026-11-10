/* ext-treasury.js — pages « Trésorerie » (VM.treso) et « Créances & dettes » (VM.dettes).
   Sources : /treasury/*, /debts/*, /money/*, /cash/*, /expenses, /invoices, /purchases (voir src/treasury.js). */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  /* ---------- utilitaires ---------- */
  const num = v => Number(v) || 0;
  const sum = (a, fn) => a.reduce((s, x) => s + num(fn(x)), 0);
  const isoDay = () => new Date().toISOString().slice(0, 10);
  const monthFirstDay = () => new Date().toISOString().slice(0, 8) + '01';
  const fdate = s => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const safeCan = p => { try { return can(p); } catch (_) { return false; } };
  const KIND = { encaissement: 'Encaissement', decaissement: 'Décaissement', depot_bancaire: 'Remise en banque', retrait: 'Retrait', transfert: 'Transfert',
    ecart_cloture: 'Écart de clôture', depot: 'Dépôt', virement_recu: 'Virement reçu', virement_emis: 'Virement émis', frais: 'Frais',
    remboursement: 'Remboursement', transfert_entrant: 'Transfert entrant', transfert_sortant: 'Transfert sortant', autre: 'Autre' };
  const signed = v => (v > 0 ? `<span class="pt-green">+${f(v)}</span>` : v < 0 ? `<span class="pt-red">−${f(-v)}</span>` : '<span class="pt-zero">0</span>');
  const lateBadge = d => (d > 0 ? `<span class="tr-late">${d} j</span>` : '<span class="pt-zero">—</span>');
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const card = (cls, icon, label, value, note, click) =>
    `<div class="tr-card ${cls}"${click ? ` onclick="${click}" role="button" tabindex="0"` : ''}><div class="tr-cl"><span>${icon}</span>${esc(label)}</div><div class="tr-cv">${value}</div><div class="tr-cn">${note || ''}</div></div>`;
  const tabsHtml = (list, cur, fn) => `<div class="tr-tabs" role="tablist">${list.map(([k, l, b]) =>
    `<button type="button" role="tab" data-t="${k}" class="${k === cur ? 'on' : ''}" onclick="${fn}('${k}')">${l}${b ? ` <span class="tr-badge">${b}</span>` : ''}</button>`).join('')}</div>`;
  const setTabs = cur => document.querySelectorAll('.tr-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === cur));
  const hydrate = () => { if (typeof hydrateImages === 'function') hydrateImages(); };
  const hint = t => `<p class="pc-empty">${esc(t)}</p>`;
  const tbl = (heads, rows) => `<div class="pc-tw"><table class="pc-tbl"><thead><tr>${heads.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

  function printDoc(title, body) {
    // Rapport officiel de la station : logo, coordonnées, pied de page, signatures (même moteur que les autres rapports)
    const box = document.createElement('div'); box.innerHTML = body;
    const small = box.querySelector('small'); const sub = small ? small.textContent.trim() : '';
    if (small) small.remove();
    const h1 = box.querySelector('h1'); if (h1) h1.remove();
    brandedPdfFromHtml(title, sub, box, { signatures: [{ label: 'Trésorier / Caissier' }, { label: 'Direction' }] });
  }
  const pTable = (heads, rows) => `<table><thead><tr>${heads.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const kv = (l, v) => `<span class="k">${esc(l)}<b>${v}</b></span>`;

  /* =====================================================================
     TRÉSORERIE
     ===================================================================== */
  let TRE = { tab: 'over', from: monthFirstDay(), to: isoDay(), acc: '', dir: '', ov: null };

  async function loadOverview() {
    const [ov, mv] = await Promise.all([G('/treasury/overview'), G('/treasury/movements?from=' + monthFirstDay() + '&to=' + isoDay()).catch(() => ({ lines: [] }))]);
    TRE.ov = ov; TRE.recent = (mv.lines || []).slice(0, 8); TRE.monthLines = mv.lines || [];
    return ov;
  }

  function accountCards(ov) {
    const edit = safeCan('money.manage');
    const reg = ov.registers.map(x => `<div class="tr-acc a-cash" onclick="treOpenAcc('cash:${x.id}')" role="button" tabindex="0">
        <div class="tr-ai">🧾</div><div class="tr-ab"><small>CAISSE</small><b>${esc(x.name)}</b><div class="tr-av">${f(x.balance)}</div>
        <div class="tr-am"><span class="pt-green">▲ ${num(x.in_month).toLocaleString('fr-FR')}</span> <span class="pt-red">▼ ${num(x.out_month).toLocaleString('fr-FR')}</span> <span>ce mois</span></div></div></div>`);
    const acc = ov.accounts.map(x => {
      const bank = x.kind === 'banque';
      return `<div class="tr-acc ${bank ? 'a-bank' : 'a-mm'}" onclick="treOpenAcc('acc:${x.id}')" role="button" tabindex="0">
        <div class="tr-ai">${bank ? '🏦' : '📱'}</div><div class="tr-ab"><small>${bank ? 'COMPTE BANCAIRE' : 'PORTEFEUILLE ÉLECTRONIQUE'}</small><b>${esc(x.name)}</b><div class="tr-av">${f(x.balance)}</div>
        <div class="tr-am"><span class="pt-green">▲ ${num(x.in_month).toLocaleString('fr-FR')}</span> <span class="pt-red">▼ ${num(x.out_month).toLocaleString('fr-FR')}</span> <span>ce mois</span></div></div>
        ${edit ? `<button type="button" class="tr-edit" title="Modifier le compte" onclick="event.stopPropagation();treEditAcc(${x.id})">✎</button>` : ''}</div>`;
    });
    return reg.concat(acc).join('') || hint('Aucune caisse ni aucun compte.');
  }


  /* Agrégats complémentaires de la trésorerie : calculés sur /treasury/overview et /treasury/movements (mois en cours) ;
     chaque tuile cite sa formule et ses tables sources (bouton « Source »). */
  const INTERNAL = ['ouverture', 'transfert', 'depot_bancaire', 'retrait', 'ecart_cloture', 'depot', 'transfert_entrant', 'transfert_sortant'];
  function treAggItems(ov, lines) {
    const fl = ov.flows, L = ov.liquidity, day = Math.max(1, new Date().getDate());
    const OV = 'GET /treasury/overview', MV = 'GET /treasury/movements (mois en cours)';
    const CM = 'cash_movements.amount (hors ouverture, remises en banque, retraits, transferts, écarts de clôture)', MM = 'money_movements.amount (hors dépôts, retraits, transferts)';
    const real = (lines || []).filter(x => !INTERNAL.includes(x.kind));
    const bigIn = real.filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount)[0], bigOut = real.filter(x => x.amount < 0).sort((a, b) => a.amount - b.amount)[0];
    const regs = ov.registers.concat(ov.accounts), neg = regs.filter(x => num(x.balance) < 0);
    const pct = v => (L.total > 0 ? Math.round((v / L.total) * 1000) / 10 + ' %' : 'n/d');
    const out = num(fl.out_month), items = [
      { label: 'Encaissements moyens par jour', value: f(num(fl.in_month) / day), sub: `sur ${day} jour(s) du mois`, formula: 'Encaissements du mois ÷ jours écoulés', sources: [OV, CM, MM], accent: '#16a34a' },
      { label: 'Décaissements moyens par jour', value: f(out / day), sub: `sur ${day} jour(s) du mois`, formula: 'Décaissements du mois ÷ jours écoulés', sources: [OV, CM, MM], accent: '#dc2626' },
      { label: 'Couverture des sorties', value: out > 0 ? (Math.round((L.total / (out / day)) * 10) / 10).toLocaleString('fr-FR') + ' j' : 'n/d', sub: 'jours de dépenses couverts par la trésorerie', formula: 'Trésorerie disponible ÷ décaissements moyens par jour', sources: [OV, 'cash_registers.balance', 'money_accounts.opening_balance + money_movements.amount', CM, MM], accent: '#2563eb' },
      { label: 'Part en espèces', value: pct(L.cash), formula: 'Soldes des caisses ÷ trésorerie disponible', sources: [OV, 'cash_registers.balance (active)'], accent: '#16a34a' },
      { label: 'Part en mobile money', value: pct(L.mobile_money), formula: 'Portefeuilles électroniques ÷ trésorerie disponible', sources: [OV, "money_accounts (kind = mobile_money) : opening_balance + Σ money_movements.amount"], accent: '#9333ea' },
      { label: 'Part en banque', value: pct(L.bank), formula: 'Comptes bancaires ÷ trésorerie disponible', sources: [OV, "money_accounts (kind = banque) : opening_balance + Σ money_movements.amount"], accent: '#0891b2' },
      { label: 'Solde moyen par compte', value: ov.accounts_count ? f(L.total / ov.accounts_count) : 'n/d', sub: ov.accounts_count + ' caisse(s) / compte(s)', formula: 'Trésorerie disponible ÷ nombre de caisses et comptes', sources: [OV] , accent: '#2563eb' },
      { label: 'Comptes à solde négatif', value: String(neg.length), sub: neg.map(x => x.name).slice(0, 3).join(', '), formula: 'Caisses et comptes dont le solde est < 0', sources: [OV, 'cash_registers.balance', 'money_accounts (solde calculé)'], accent: '#dc2626' },
      { label: 'Mouvements du mois', value: String(real.length) + (lines && lines.length >= 400 ? '+' : ''), sub: 'hors mouvements internes', formula: 'Nombre de mouvements réels (limité aux 400 plus récents)', sources: [MV, 'cash_movements.id', 'money_movements.id'], accent: '#64748b' },
      { label: 'Plus gros encaissement du mois', value: bigIn ? f(bigIn.amount) : 'n/d', sub: bigIn ? `${bigIn.account} — ${bigIn.label || KIND[bigIn.kind] || bigIn.kind}` : '', formula: 'Maximum des mouvements entrants réels', sources: [MV, 'cash_movements.amount > 0', 'money_movements.amount > 0'], accent: '#16a34a' },
      { label: 'Plus gros décaissement du mois', value: bigOut ? f(-bigOut.amount) : 'n/d', sub: bigOut ? `${bigOut.account} — ${bigOut.label || KIND[bigOut.kind] || bigOut.kind}` : '', formula: 'Maximum des mouvements sortants réels', sources: [MV, 'cash_movements.amount < 0', 'money_movements.amount < 0'], accent: '#dc2626' },
      { label: 'Transferts du mois', value: String(ov.transfers_month || 0), formula: 'Nombre de transferts sortants entre comptes', sources: [OV, "money_movements (kind = transfert_sortant, moved_on ≥ début du mois)"], accent: '#0891b2' },
      { label: 'Écarts de caisse non clôturés', value: ov.gaps && ov.gaps.n ? `${ov.gaps.n} · ${f(ov.gaps.total)}` : '0', formula: 'Écarts de caisse dont le statut n’est ni « clôturé » ni « régularisé »', sources: [OV, 'cash_gaps.amount, cash_gaps.status'], accent: '#f59e0b' }
    ];
    if (ov.receivables != null && ov.payables != null) items.push({ label: 'Ratio créances / dettes', value: ov.payables > 0 ? (Math.round((ov.receivables / ov.payables) * 100) / 100).toLocaleString('fr-FR') : 'n/d', sub: '> 1 : on vous doit plus que vous ne devez', formula: 'Créances clients ÷ dettes fournisseurs', sources: [OV, 'customers.balance > 0', 'suppliers.balance_due > 0'], accent: '#db2777' });
    return items;
  }

  function overviewHtml(ov) {
    const fl = ov.flows, L = ov.liquidity, dash = '—';
    const cards = [
      card('c-blue', '🏦', 'Trésorerie disponible', f(L.total), 'tous comptes confondus'),
      card('c-green', '⬇', 'Encaissements du mois', f(fl.in_month), 'Aujourd’hui : ' + f(fl.in_today)),
      card('c-red', '⬆', 'Décaissements du mois', f(fl.out_month), 'Aujourd’hui : ' + f(fl.out_today)),
      card('c-teal', '⚖', 'Flux net du mois', f(fl.net_month), 'Aujourd’hui : ' + f(fl.net_today)),
      card('c-purple', '🧾', 'À encaisser (créances clients)', ov.receivables == null ? dash : f(ov.receivables), 'Soldes clients non réglés', "go('dettes')"),
      card('c-pink', '💳', 'À payer (dettes fournisseurs)', ov.payables == null ? dash : f(ov.payables), 'Achats non réglés', "go('dettes')"),
      card('c-indigo', '🏛', 'Position nette', ov.net_position == null ? dash : f(ov.net_position), 'Trésorerie + créances − dettes'),
      card('c-slate', '🗂', 'Nombre de comptes', ov.accounts_count, 'caisses, banques, mobile money')
    ].join('');
    const gap = ov.gaps && ov.gaps.n ? `<div class="warn">${ov.gaps.n} écart(s) de caisse non clôturé(s) · ${f(ov.gaps.total)}</div>` : '';
    const recent = (TRE.recent || []).length ? tbl([['Date'], ['Compte'], ['Nature'], ['Libellé'], ['Montant', 'pc-num']],
      TRE.recent.map(x => `<tr><td>${fdate(x.day)}</td><td>${esc(x.account)}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td>${esc(x.label || '')}</td><td class="pc-num">${signed(x.amount)}</td></tr>`)) : hint('Aucun mouvement ce mois-ci.');
    return `${gap}<div class="tr-sec">📊 INDICATEURS DE TRÉSORERIE</div><div class="tr-cards">${cards}</div>
      <div class="tr-sec">🏦 COMPTES, CAISSES ET PORTEFEUILLES <span class="tr-sech">Cliquez sur une carte pour voir ses mouvements${safeCan('money.manage') ? ' · ✎ pour modifier le compte' : ''}</span></div>
      <div class="tr-accs">${accountCards(ov)}</div>
      <div class="tr-sec">🕘 DERNIERS MOUVEMENTS DU MOIS <a href="#" onclick="treTab('mov');return false" class="tr-sech">Tout voir →</a></div>${recent}
      ${window.Agg ? `<div class="tr-sec">📈 AGRÉGATS COMPLÉMENTAIRES <span class="tr-sech">Bouton « Source » : formule et tables d'origine</span></div><div class="agg-wrap">${Agg.tiles(treAggItems(ov, TRE.monthLines))}</div>` : ''}`;
  }

  async function tabMovements() {
    const q = new URLSearchParams({ from: TRE.from, to: TRE.to }); if (TRE.acc) q.set('account', TRE.acc); if (TRE.dir) q.set('dir', TRE.dir);
    const [d, ov] = await Promise.all([G('/treasury/movements?' + q), TRE.ov ? Promise.resolve(TRE.ov) : loadOverview()]);
    const opts = ['<option value="">Toutes les caisses et comptes</option>'].concat(ov.registers.map(x => `<option value="cash:${x.id}" ${TRE.acc === 'cash:' + x.id ? 'selected' : ''}>Caisse — ${esc(x.name)}</option>`),
      ov.accounts.map(x => `<option value="acc:${x.id}" ${TRE.acc === 'acc:' + x.id ? 'selected' : ''}>${x.kind === 'banque' ? 'Banque' : 'Mobile money'} — ${esc(x.name)}</option>`)).join('');
    const rows = d.lines.map(x => `<tr><td>${fdate(x.day)}</td><td>${esc(x.account)}</td><td>${esc(KIND[x.kind] || x.kind)}</td><td>${esc(x.label || '')}</td><td class="pc-hide-sm">${esc(x.reference || '')}</td><td class="pc-num">${signed(x.amount)}</td></tr>`);
    return `<div class="pc-filters"><label class="tr-lbl">Du <input type="date" id="tr-from" value="${TRE.from}"></label><label class="tr-lbl">au <input type="date" id="tr-to" value="${TRE.to}"></label>
        <select id="tr-acc">${opts}</select>
        <select id="tr-dir"><option value="">Entrées et sorties</option><option value="in" ${TRE.dir === 'in' ? 'selected' : ''}>Entrées</option><option value="out" ${TRE.dir === 'out' ? 'selected' : ''}>Sorties</option></select>
        <button type="button" onclick="treApply()">Appliquer</button>${typeof V !== 'undefined' && V.finevents ? '<button type="button" class="b2" onclick="go(\'finevents\')">Journal finance</button>' : ''}</div>
      <div class="tr-cards tr-mini">${card('c-green', '⬇', 'Entrées', f(d.totals.in))}${card('c-red', '⬆', 'Sorties', f(d.totals.out))}${card('c-teal', '⚖', 'Solde net', f(d.totals.net))}</div>
      ${rows.length ? tbl([['Date'], ['Compte'], ['Nature'], ['Libellé'], ['Référence', 'pc-hide-sm'], ['Montant', 'pc-num']], rows) : hint('Aucun mouvement sur cette période.')}
      <p class="tr-note">Les remises en banque et transferts apparaissent des deux côtés (sortie d’un compte, entrée dans l’autre) ; ils sont exclus des indicateurs « encaissements / décaissements ».</p>`;
  }

  async function tabExpenses() {
    const d = await G('/treasury/expenses?from=' + TRE.from + '&to=' + TRE.to);
    const chips = d.by_category.map(c => `<span class="tr-chip">${esc(c.category)} <b>${f(c.total)}</b></span>`).join('');
    const rows = d.lines.map(x => `<tr><td>${fdate(x.spent_on)}</td><td><b>${esc(x.category)}</b></td><td class="pc-hide-sm">${esc(x.beneficiary || '—')}</td><td>${esc(x.method || '')}</td><td class="pc-hide-sm">${esc(x.comment || '')}${x.receipt_url ? ` <a href="${esc(x.receipt_url)}" target="_blank" rel="noopener">reçu</a>` : ''}</td><td class="pc-num pt-red">${f(x.amount)}</td></tr>`);
    return `<div class="pc-filters"><label class="tr-lbl">Du <input type="date" id="tr-from" value="${TRE.from}"></label><label class="tr-lbl">au <input type="date" id="tr-to" value="${TRE.to}"></label><button type="button" onclick="treApply()">Appliquer</button>
        ${safeCan('expense.create') ? '<button type="button" class="b2" onclick="addX()">＋ Dépense / frais</button>' : ''}</div>
      <div class="tr-cards tr-mini">${card('c-red', '🧾', 'Total des dépenses', f(d.total), d.lines.length + ' dépense(s)')}</div>
      <div class="tr-chips">${chips}</div>
      ${rows.length ? tbl([['Date'], ['Catégorie'], ['Bénéficiaire', 'pc-hide-sm'], ['Mode'], ['Commentaire', 'pc-hide-sm'], ['Montant', 'pc-num']], rows) : hint('Aucune dépense sur cette période.')}`;
  }

  async function tabTransfers() {
    const d = await G('/treasury/transfers?from=' + TRE.from + '&to=' + TRE.to);
    const lab = x => (x.kind === 'transfert_sortant' ? 'Transfert sortant' : x.kind === 'transfert_entrant' ? 'Transfert entrant' : x.kind === 'depot' || x.kind === 'depot_bancaire' ? 'Remise en banque' : x.kind === 'retrait' ? 'Retrait' : 'Transfert');
    const rows = d.lines.map(x => `<tr><td>${fdate(x.day)}</td><td>${esc(x.account)}</td><td>${lab(x)}</td><td>${esc(x.label || '')}</td><td class="pc-hide-sm">${esc(x.reference || '')}</td><td class="pc-num">${signed(x.amount)}</td></tr>`);
    return `<div class="pc-filters"><label class="tr-lbl">Du <input type="date" id="tr-from" value="${TRE.from}"></label><label class="tr-lbl">au <input type="date" id="tr-to" value="${TRE.to}"></label><button type="button" onclick="treApply()">Appliquer</button>
        ${safeCan('money.manage') ? '<button type="button" class="b2" onclick="treTransfer()">↔ Transfert de fonds</button>' : ''}</div>
      ${rows.length ? tbl([['Date'], ['Compte / caisse'], ['Opération'], ['Libellé'], ['Réf.', 'pc-hide-sm'], ['Montant', 'pc-num']], rows) : hint('Aucun transfert sur cette période.')}`;
  }

  async function tabRecon() {
    const [list, recent] = await Promise.all([G('/treasury/reconciliation'), G('/money/recent?limit=15').catch(() => ({ statements: [] }))]);
    const rows = list.map(x => `<tr><td><b>${esc(x.name)}</b><small class="pt-sub">${x.kind === 'banque' ? 'Compte bancaire' : 'Mobile money'}</small></td>
      <td class="pc-num">${f(x.book_now)}</td><td>${x.statement_date ? fdate(x.statement_date) : '<span class="pt-zero">Aucun relevé</span>'}</td>
      <td class="pc-num">${x.statement_balance == null ? '—' : f(x.statement_balance)}</td><td class="pc-num pc-hide-sm">${x.book_at == null ? '—' : f(x.book_at)}</td>
      <td class="pc-num">${x.gap == null ? '—' : Math.abs(x.gap) < 0.005 ? '<span class="pt-green">Rapproché</span>' : `<span class="pt-red">${x.gap > 0 ? '+' : '−'}${f(Math.abs(x.gap))}</span>`}</td>
      <td class="pc-act">${safeCan('money.manage') ? `<button type="button" class="b2" onclick="treStmt(${x.id})">Saisir un relevé</button> ` : ''}${typeof treLines === 'function' ? `<button type="button" class="b2" onclick="treLines(${x.id})">Ligne à ligne</button>` : ''}</td></tr>`);
    const st = (recent.statements || []).map(x => `<tr><td>${fdate(x.statement_date)}</td><td>${esc(x.account_name)}</td><td class="pc-num">${f(x.balance)}</td><td class="pc-hide-sm">${esc(x.note || '—')}</td><td class="pc-hide-sm">${esc(x.created_at || '')}${x.login ? ' · ' + esc(x.login) : ''}</td></tr>`);
    return `<div class="pc-filters">${safeCan('money.manage') ? '<button type="button" onclick="treStmt()">＋ Saisir un relevé</button>' : ''}${typeof V !== 'undefined' && V.reconcile ? '<button type="button" class="b2" onclick="go(\'reconcile\')">Contrôles et réconciliations</button>' : ''}</div>
      ${rows.length ? tbl([['Compte'], ['Solde comptable', 'pc-num'], ['Dernier relevé'], ['Solde du relevé', 'pc-num'], ['Comptable à cette date', 'pc-num pc-hide-sm'], ['Écart', 'pc-num'], ['']], rows) : hint('Aucun compte bancaire ni mobile money. Créez-en un avec « Nouveau compte ».')}
      <div class="tr-sec">🕘 DERNIERS RELEVÉS SAISIS</div>${st.length ? tbl([['Date'], ['Compte'], ['Solde relevé', 'pc-num'], ['Note', 'pc-hide-sm'], ['Saisi le', 'pc-hide-sm']], st) : hint('Aucun relevé saisi pour le moment.')}`;
  }

  async function treLoad() {
    const host = document.getElementById('tre-body'); if (!host) return;
    host.innerHTML = '<p class="pc-empty">Chargement…</p>';
    try {
      if (TRE.tab === 'over') { host.innerHTML = overviewHtml(TRE.ov || await loadOverview()); }
      else host.innerHTML = await ({ mov: tabMovements, exp: tabExpenses, xfer: tabTransfers, rec: tabRecon }[TRE.tab] || tabMovements)();
    } catch (e) { host.innerHTML = `<p class="warn">${esc(e.message || e)}</p>`; }
    hydrate();
  }
  window.treTab = t => { TRE.tab = t; setTabs(t); treLoad(); };
  window.treApply = () => {
    const g = id => { const e = document.getElementById(id); return e ? e.value : null; };
    TRE.from = g('tr-from') || TRE.from; TRE.to = g('tr-to') || TRE.to;
    if (g('tr-acc') !== null) TRE.acc = g('tr-acc'); if (g('tr-dir') !== null) TRE.dir = g('tr-dir');
    treLoad();
  };
  window.treOpenAcc = acc => { TRE.acc = acc; TRE.dir = ''; TRE.tab = 'mov'; setTabs('mov'); treLoad(); };
  window.treRefresh = async () => { TRE.ov = null; await go('treso'); };

  /* ---- actions (formulaires) ---- */
  const accOptions = ov => ov.registers.map(x => ['cash:' + x.id, 'Caisse — ' + x.name]).concat(ov.accounts.map(x => ['acc:' + x.id, (x.kind === 'banque' ? 'Banque — ' : 'Mobile money — ') + x.name]));
  window.treIncome = async () => {
    const ov = TRE.ov || await loadOverview();
    const opts = accOptions(ov).filter(([v]) => (v.startsWith('cash:') ? safeCan('cash.manage') : safeCan('money.manage')));
    if (!opts.length) return toast('Aucune caisse ou aucun compte disponible pour votre profil.', 'error');
    form('Autre recette', [['target', 'Encaissé sur', 's', opts], ['amount', 'Montant', 'number'], ['label', 'Libellé (ex. location, subvention…)'], ['moved_on', 'Date', 'date']], { moved_on: isoDay() }, async d => {
      const amount = parseFloat(d.amount); if (!(amount > 0)) return toast('Montant invalide', 'error');
      if (String(d.target).startsWith('cash:')) await Po('/cash/movements', { kind: 'encaissement', amount, label: d.label, cash_register_id: +String(d.target).slice(5) });
      else await Po('/money/movements', { account_id: +String(d.target).slice(4), kind: 'encaissement', amount, label: d.label, moved_on: d.moved_on || undefined });
      closeM(); toast('Recette enregistrée', 'success'); treRefresh();
    });
  };
  window.treTransfer = async () => {
    const ov = TRE.ov || await loadOverview();
    const accs = ov.accounts.map(x => [String(x.id), x.name]);
    if (!accs.length) return toast('Créez d’abord un compte bancaire ou mobile money.', 'error');
    form('Transfert de fonds', [['mode', 'Type', 's', [['acc', 'Entre deux comptes'], ['depot', 'Remise en banque (caisse → compte)']]],
      ['from', 'Compte source (ignoré pour une remise en banque)', 's', accs], ['to', 'Compte destinataire', 's', accs.slice().reverse()],
      ['amount', 'Montant', 'number'], ['label', 'Libellé'], ['moved_on', 'Date', 'date']], { label: 'Transfert interne', moved_on: isoDay() }, async d => {
      const amount = parseFloat(d.amount); if (!(amount > 0)) return toast('Montant invalide', 'error');
      if (d.mode === 'depot') await Po('/money/deposit', { account_id: +d.to, amount, label: d.label || 'Remise en banque' });
      else { if (d.from === d.to) return toast('Choisissez deux comptes distincts', 'error'); await Po('/money/transfer', { from_account_id: +d.from, to_account_id: +d.to, amount, label: d.label || 'Transfert interne', moved_on: d.moved_on || undefined }); }
      closeM(); toast('Transfert enregistré', 'success'); treRefresh();
    });
  };
  window.treNewAcc = () => form('Nouveau compte', [['kind', 'Nature', 's', [['banque', 'Compte bancaire'], ['mobile_money', 'Portefeuille Mobile Money']]], ['name', 'Libellé du compte'],
    ['provider', 'Banque / opérateur (Orange Money, Wave…)'], ['account_ref', 'N° de compte / téléphone'], ['opening_balance', 'Solde d’ouverture', 'number']], { opening_balance: 0 }, async d => {
    await Po('/money/accounts', { kind: d.kind, name: d.name, provider: d.provider || undefined, account_ref: d.account_ref || undefined, opening_balance: parseFloat(d.opening_balance) || 0 });
    closeM(); toast('Compte créé', 'success'); treRefresh();
  });
  window.treEditAcc = async id => {
    const ov = TRE.ov || await loadOverview(); const a = ov.accounts.find(x => x.id === id); if (!a) return;
    form('Modifier le compte', [['name', 'Libellé du compte'], ['provider', 'Banque / opérateur'], ['account_ref', 'N° de compte / téléphone'], ['active', 'Statut', 's', [['1', 'Actif'], ['0', 'Désactivé (solde nul requis)']]]],
      { name: a.name, provider: a.provider || '', account_ref: a.account_ref || '', active: '1' }, async d => {
      await Pu('/money/accounts/' + id, { name: d.name, provider: d.provider || null, account_ref: d.account_ref || null, active: d.active !== '0' });
      closeM(); toast('Compte modifié', 'success'); treRefresh();
    });
  };
  window.treStmt = async preset => {
    const ov = TRE.ov || await loadOverview(); const accs = ov.accounts.map(x => [String(x.id), x.name]);
    if (!accs.length) return toast('Aucun compte bancaire ou mobile money.', 'error');
    form('Relevé (rapprochement)', [['account_id', 'Compte', 's', accs], ['statement_date', 'Date du relevé', 'date'], ['balance', 'Solde du relevé', 'number'], ['note', 'Note']],
      { account_id: preset ? String(preset) : accs[0][0], statement_date: isoDay() }, async d => {
      await Po('/money/statements', { account_id: +d.account_id, statement_date: d.statement_date, balance: parseFloat(d.balance), note: d.note || undefined });
      closeM(); toast('Relevé enregistré', 'success'); TRE.tab = 'rec'; treRefresh();
    });
  };
  /* Export PDF de l'onglet affiché, avec ses sélections (dates, compte, sens) — même moteur que les autres rapports */
  const sg = v => (num(v) > 0 ? '+' + f(v) : f(v));
  const pdfSig = [{ label: 'Trésorier / Caissier' }, { label: 'Direction' }];
  const accLabel = (ov, acc) => {
    if (!acc) return 'Toutes les caisses et comptes';
    const [t, id] = String(acc).split(':');
    const x = (t === 'cash' ? ov.registers : ov.accounts).find(a => String(a.id) === id);
    return x ? (t === 'cash' ? 'Caisse — ' : x.kind === 'banque' ? 'Banque — ' : 'Mobile money — ') + x.name : acc;
  };
  async function treTabPdf() {
    // Les sélections visibles (même non encore « Appliquées ») font foi
    const g = id => { const e = document.getElementById(id); return e ? e.value : null; };
    if (g('tr-from')) TRE.from = g('tr-from'); if (g('tr-to')) TRE.to = g('tr-to');
    if (g('tr-acc') !== null) TRE.acc = g('tr-acc'); if (g('tr-dir') !== null) TRE.dir = g('tr-dir');
    if (TRE.from > TRE.to) return toast('La date de début doit précéder la date de fin.', 'error');
    const ov = TRE.ov || await loadOverview(), per = `Du ${fdate(TRE.from)} au ${fdate(TRE.to)}`;
    const base = { signatures: pdfSig, landscape: true };
    if (TRE.tab === 'mov') {
      const q = new URLSearchParams({ from: TRE.from, to: TRE.to }); if (TRE.acc) q.set('account', TRE.acc); if (TRE.dir) q.set('dir', TRE.dir);
      const d = await G('/treasury/movements?' + q);
      if (!d.lines.length) return toast('Aucun mouvement à exporter pour cette sélection.', 'info');
      const sens = TRE.dir === 'in' ? 'Entrées' : TRE.dir === 'out' ? 'Sorties' : 'Entrées et sorties';
      return brandedPdf({ ...base, title: 'Trésorerie — mouvements financiers', subtitle: `${per} · ${accLabel(ov, TRE.acc)} · ${sens}`, filename: `Tresorerie_mouvements_${TRE.from}_${TRE.to}`,
        sections: [{ type: 'kpis', title: 'Synthèse', items: [{ label: 'Entrées', value: f(d.totals.in) }, { label: 'Sorties', value: f(d.totals.out) }, { label: 'Solde net', value: f(d.totals.net) }] },
          { type: 'table', title: 'Détail des mouvements', head: ['Date', 'Compte', 'Nature', 'Libellé', 'Référence', 'Montant'], rows: d.lines.map(x => [fdate(x.day), x.account, KIND[x.kind] || x.kind, x.label || '', x.reference || '', sg(x.amount)]) }] });
    }
    if (TRE.tab === 'exp') {
      const d = await G('/treasury/expenses?from=' + TRE.from + '&to=' + TRE.to);
      if (!d.lines.length) return toast('Aucune dépense à exporter pour cette période.', 'info');
      return brandedPdf({ ...base, title: 'Trésorerie — dépenses et frais', subtitle: per, filename: `Tresorerie_depenses_${TRE.from}_${TRE.to}`,
        sections: [{ type: 'kpis', title: 'Synthèse', items: [{ label: 'Total des dépenses', value: f(d.total), note: d.lines.length + ' dépense(s)' }] },
          { type: 'table', title: 'Par catégorie', head: ['Catégorie', 'Total'], rows: d.by_category.map(c => [c.category, f(c.total)]) },
          { type: 'table', title: 'Détail des dépenses', head: ['Date', 'Catégorie', 'Bénéficiaire', 'Mode', 'Commentaire', 'Montant'], rows: d.lines.map(x => [fdate(x.spent_on), x.category, x.beneficiary || '', x.method || '', x.comment || '', f(x.amount)]), totals: ['TOTAL', '', '', '', '', f(d.total)] }] });
    }
    if (TRE.tab === 'xfer') {
      const d = await G('/treasury/transfers?from=' + TRE.from + '&to=' + TRE.to);
      if (!d.lines.length) return toast('Aucun transfert à exporter pour cette période.', 'info');
      const lab = x => (x.kind === 'transfert_sortant' ? 'Transfert sortant' : x.kind === 'transfert_entrant' ? 'Transfert entrant' : x.kind === 'depot' || x.kind === 'depot_bancaire' ? 'Remise en banque' : x.kind === 'retrait' ? 'Retrait' : 'Transfert');
      return brandedPdf({ ...base, title: 'Trésorerie — transferts', subtitle: per, filename: `Tresorerie_transferts_${TRE.from}_${TRE.to}`,
        sections: [{ type: 'table', title: 'Détail des transferts', head: ['Date', 'Compte / caisse', 'Opération', 'Libellé', 'Réf.', 'Montant'], rows: d.lines.map(x => [fdate(x.day), x.account, lab(x), x.label || '', x.reference || '', sg(x.amount)]) }] });
    }
    if (TRE.tab === 'rec') {
      const [list, recent] = await Promise.all([G('/treasury/reconciliation'), G('/money/recent?limit=15').catch(() => ({ statements: [] }))]);
      if (!list.length) return toast('Aucun compte bancaire ni mobile money à exporter.', 'info');
      const sections = [{ type: 'table', title: 'Rapprochement par compte', head: ['Compte', 'Type', 'Solde comptable', 'Dernier relevé', 'Solde du relevé', 'Comptable à cette date', 'Écart'],
        rows: list.map(x => [x.name, x.kind === 'banque' ? 'Compte bancaire' : 'Mobile money', f(x.book_now), x.statement_date ? fdate(x.statement_date) : 'Aucun relevé', x.statement_balance == null ? '—' : f(x.statement_balance), x.book_at == null ? '—' : f(x.book_at), x.gap == null ? '—' : Math.abs(x.gap) < 0.005 ? 'Rapproché' : sg(x.gap)]) }];
      const st = recent.statements || [];
      if (st.length) sections.push({ type: 'table', title: 'Derniers relevés saisis', head: ['Date', 'Compte', 'Solde relevé', 'Note'], rows: st.map(x => [fdate(x.statement_date), x.account_name, f(x.balance), x.note || '']) });
      return brandedPdf({ ...base, title: 'Trésorerie — rapprochement bancaire', subtitle: 'Situation au ' + fdate(isoDay()), filename: 'Tresorerie_rapprochement_' + isoDay(), sections });
    }
  }
  window.treReport = async () => {
    try { if (TRE.tab !== 'over') return await treTabPdf(); } catch (e) { return toast((e && e.message) || 'Génération du PDF impossible', 'error'); }
    const ov = TRE.ov || await loadOverview(), fl = ov.flows, L = ov.liquidity;
    const accRows = ov.registers.map(x => ['Caisse', x.name, x.balance, x.in_month, x.out_month]).concat(ov.accounts.map(x => [x.kind === 'banque' ? 'Banque' : 'Mobile money', x.name, x.balance, x.in_month, x.out_month]))
      .map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="n">${f(r[2])}</td><td class="n">${f(r[3])}</td><td class="n">${f(r[4])}</td></tr>`);
    printDoc('Rapport de trésorerie', `<h1>Rapport de trésorerie</h1><small>Situation au ${fdate(ov.as_of)}</small>
      <h2>Indicateurs</h2>${kv('Trésorerie disponible', f(L.total))}${kv('Encaissements du mois', f(fl.in_month))}${kv('Décaissements du mois', f(fl.out_month))}${kv('Flux net du mois', f(fl.net_month))}
      ${ov.receivables != null ? kv('Créances clients', f(ov.receivables)) : ''}${ov.payables != null ? kv('Dettes fournisseurs', f(ov.payables)) : ''}${ov.net_position != null ? kv('Position nette', f(ov.net_position)) : ''}
      <h2>Répartition</h2>${kv('Espèces', f(L.cash))}${kv('Mobile money', f(L.mobile_money))}${kv('Banques', f(L.bank))}
      <h2>Comptes, caisses et portefeuilles</h2>${pTable([['Type'], ['Nom'], ['Solde', 'n'], ['Entrées du mois', 'n'], ['Sorties du mois', 'n']], accRows)}
      ${window.Agg ? '<h2>Agrégats complémentaires (avec sources)</h2>' + Agg.itemsTable(treAggItems(ov, TRE.monthLines)) : ''}`);
  };

  VM.treso = async function () {
    const ov = await loadOverview();
    const tabs = [['over', 'Vue d’ensemble'], ['mov', 'Mouvements financiers'], ['exp', 'Dépenses &amp; frais'], ['xfer', 'Transferts', ov.transfers_month || ''], ['rec', 'Rapprochement bancaire']];
    if (!tabs.some(t => t[0] === TRE.tab)) TRE.tab = 'over';
    if (TRE.tab !== 'over') setTimeout(treLoad, 0);
    return `<div class="pc-head"><div><h2 class="pc-title">Trésorerie</h2><div class="pc-subtitle">Caisses, comptes bancaires, portefeuilles électroniques et mouvements financiers</div></div></div>
      <div class="pc-actions tr-top">
        ${safeCan('expense.create') ? '<button onclick="addX()">🧾 Dépense / frais</button>' : ''}
        ${safeCan('cash.manage') || safeCan('money.manage') ? '<button class="b2" onclick="treIncome()">💰 Autre recette</button>' : ''}
        ${safeCan('money.manage') ? '<button class="b2" onclick="treTransfer()">↔ Transfert de fonds</button><button class="b2" onclick="treNewAcc()">＋ Nouveau compte</button>' : ''}
        <button class="b2" onclick="treReport()" title="Exporte en PDF l’onglet affiché, avec ses sélections">📄 Exporter PDF</button>
      </div>
      ${tabsHtml(tabs, TRE.tab, 'treTab')}
      <div id="tre-body">${TRE.tab === 'over' ? overviewHtml(ov) : '<p class="pc-empty">Chargement…</p>'}</div>`;
  };

  /* =====================================================================
     CRÉANCES & DETTES
     ===================================================================== */
  let DET = { tab: 'inv', q: '', sel: '', from: monthFirstDay(), to: isoDay(), data: null, rem: null };

  async function loadDebts() {
    const [data, rem] = await Promise.all([G('/debts/overview'), G('/debts/reminders').catch(() => ({ pending: [], history: [] }))]);
    DET.data = data; DET.rem = rem; return data;
  }
  const lateOf = d => Math.max(0, Math.floor((Date.now() - new Date(String(d).slice(0, 10) + 'T00:00:00').getTime()) / 864e5));

  function kpiRow(a) { return `<div class="tr-cards tr-k4">${a.join('')}</div>`; }
  function searchBar(ph, sel) {
    return `<div class="pc-filters"><input class="pc-q" type="search" placeholder="${ph}" value="${esc(DET.q)}" oninput="detSet('q',this.value)">
      <select onchange="detSet('sel',this.value)">${sel.map(([v, l]) => `<option value="${v}" ${DET.sel === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  }
  const match = (x, fields) => !DET.q.trim() || norm(fields.map(k => x[k]).join(' ')).includes(norm(DET.q.trim()));

  /* -- Créances clients -- */
  function cliTab(d) {
    const today = isoDay(), inv = d.invoices, late = inv.filter(x => x.days_late > 0);
    const debtors = d.customers;
    const kp = kpiRow([card('c-blue', '👥', 'Clients débiteurs', debtors.length, 'avec un solde à encaisser'), card('c-orange', '💰', 'Montant dû', f(sum(debtors, c => c.balance)), 'Soldes clients cumulés'),
      card('c-red', '⏰', 'Dont en retard', f(sum(late, x => x.remaining)), late.length + ' facture(s) échue(s)'), card('c-purple', '🚫', 'Crédit bloqué', debtors.filter(c => c.credit_blocked).length, 'clients bloqués')]);
    const sel = [['', 'Tous'], ['late', 'En retard'], ['blocked', 'Crédit bloqué'], ['over', 'Au-delà de la limite']];
    return { kp, bar: searchBar('Nom, téléphone…', sel), table: () => {
      const rows = debtors.filter(c => match(c, ['name', 'phone', 'email']) && (!DET.sel || (DET.sel === 'late' && c.oldest_due && c.oldest_due < today) || (DET.sel === 'blocked' && c.credit_blocked) || (DET.sel === 'over' && c.credit_limit > 0 && c.balance > c.credit_limit)))
        .map(c => { const l = c.oldest_due ? lateOf(c.oldest_due) : 0; return `<tr class="pc-row" onclick="showCli(${c.id})"><td><b>${esc(c.name)}</b><small class="pt-sub">${esc(c.phone || '')}${c.credit_blocked ? ' · <span class="pt-red">crédit bloqué</span>' : ''}</small></td>
          <td class="pc-num pc-hide-sm">${f(c.credit_limit)}</td><td class="pc-num pt-red">${f(c.balance)}</td><td class="pc-hide-sm">${c.oldest_due ? fdate(c.oldest_due) : '—'}</td><td>${lateBadge(l)}</td>
          <td class="pc-act" onclick="event.stopPropagation()">${safeCan('cash.manage|sale.create') ? `<button type="button" class="b2" onclick="detPayCli(${c.id},${c.balance})">Encaisser</button> ` : ''}${safeCan('customer.edit|cash.manage|finance.view') ? `<button type="button" class="b2" onclick="detRemind(${c.id},'whatsapp')">Relancer</button>` : ''}</td></tr>`; });
      return rows.length ? tbl([['Client'], ['Limite', 'pc-num pc-hide-sm'], ['Solde dû', 'pc-num'], ['Plus ancienne échéance', 'pc-hide-sm'], ['Retard'], ['']], rows) : hint('Aucune créance client.');
    } };
  }

  /* -- Factures impayées -- */
  function invTab(d) {
    const inv = d.invoices, late = inv.filter(x => x.days_late > 0);
    const avg = late.length ? Math.round(sum(late, x => x.days_late) / late.length) : 0;
    const kp = kpiRow([card('c-blue', '📄', 'Factures impayées', inv.length, 'à encaisser'), card('c-orange', '💰', 'Montant dû', f(sum(inv, x => x.remaining)), 'Reste à payer cumulé'),
      card('c-red', '🚨', 'Dont en retard', f(sum(late, x => x.remaining)), late.length + ' facture(s) échue(s)'), card('c-purple', '⏱', 'Retard moyen', avg + ' j', 'sur les factures échues')]);
    const sel = [['', 'Toutes'], ['late', 'En retard'], ['ok', 'Non échues'], ['partial', 'Partiellement payées']];
    return { kp, bar: searchBar('N° ou client…', sel), table: () => {
      const rows = inv.filter(x => match(x, ['invoice_no', 'customer_name']) && (!DET.sel || (DET.sel === 'late' && x.days_late > 0) || (DET.sel === 'ok' && x.days_late === 0) || (DET.sel === 'partial' && x.status === 'partielle')))
        .map(x => `<tr class="pc-row" ${typeof billShow === 'function' ? `onclick="billShow(${x.id})"` : ''}><td><b>${esc(x.invoice_no)}</b></td><td>${esc(x.customer_name)}</td><td class="pc-hide-sm">${fdate(x.issued_on)}</td><td class="pc-hide-sm">${fdate(x.due_date)}</td>
          <td class="pc-num pc-hide-sm">${f(x.total_ttc)}</td><td class="pc-num pc-hide-sm">${f(x.amount_paid)}</td><td class="pc-num pt-red">${f(x.remaining)}</td><td>${lateBadge(x.days_late)}</td>
          <td class="pc-act" onclick="event.stopPropagation()">${safeCan('sale.create|customer.edit|finance.view') ? `<button type="button" class="b2" onclick="detPayInvoice(${x.id},${x.remaining})">⬇ Encaisser</button>` : ''}</td></tr>`);
      return rows.length ? tbl([['Facture'], ['Client'], ['Date', 'pc-hide-sm'], ['Échéance', 'pc-hide-sm'], ['Total', 'pc-num pc-hide-sm'], ['Payé', 'pc-num pc-hide-sm'], ['Reste', 'pc-num'], ['Retard'], ['']], rows) : hint('Aucune facture impayée.');
    } };
  }

  /* -- Dettes fournisseurs -- */
  function supTab(d) {
    const pu = d.purchases, late = pu.filter(x => x.days_late > 0);
    const avg = late.length ? Math.round(sum(late, x => x.days_late) / late.length) : 0;
    const total = d.suppliers.length ? sum(d.suppliers, s => Math.max(0, s.balance_due)) : sum(pu, x => x.remaining);
    const kp = kpiRow([card('c-blue', '🏭', 'Fournisseurs à payer', d.suppliers.filter(s => s.balance_due > 0).length, 'avec une dette'), card('c-orange', '💰', 'Montant dû', f(total), 'Achats non réglés'),
      card('c-red', '🚨', 'Dont en retard', f(sum(late, x => x.remaining)), late.length + ' facture(s) échue(s)'), card('c-purple', '⏱', 'Retard moyen', avg + ' j', 'sur les factures échues')]);
    const sel = [['', 'Toutes'], ['late', 'En retard'], ['ok', 'Non échues']];
    return { kp, bar: searchBar('N° ou fournisseur…', sel), table: () => {
      const rows = pu.filter(x => match(x, ['order_no', 'invoice_no', 'supplier']) && (!DET.sel || (DET.sel === 'late' && x.days_late > 0) || (DET.sel === 'ok' && x.days_late === 0)))
        .map(x => `<tr class="pc-row" onclick="showPO(${x.id})"><td><b>${esc(x.invoice_no || x.order_no || '#' + x.id)}</b><small class="pt-sub">${esc(x.order_no || '')}</small></td><td>${esc(x.supplier)}</td><td class="pc-hide-sm">${fdate(x.due_date)}</td>
          <td class="pc-num pc-hide-sm">${f(x.invoice_total)}</td><td class="pc-num pc-hide-sm">${f(x.paid)}</td><td class="pc-num pt-red">${f(x.remaining)}</td><td>${lateBadge(x.days_late)}</td>
          <td class="pc-act" onclick="event.stopPropagation()">${safeCan('purchase.pay') && x.status === 'facture' ? `<button type="button" class="b2" onclick="detPayPO(${x.id},${x.remaining})">Payer</button>` : ''}</td></tr>`);
      const sup = d.suppliers.map(s => `<tr class="pc-row" onclick="showSup(${s.id})"><td><b>${esc(s.name)}</b><small class="pt-sub">${esc(s.phone || '')}</small></td><td class="pc-num">${s.balance_due > 0 ? `<span class="pt-red">${f(s.balance_due)}</span>` : `<span class="pt-green">Crédit ${f(-s.balance_due)}</span>`}</td></tr>`);
      return (rows.length ? tbl([['Facture'], ['Fournisseur'], ['Échéance', 'pc-hide-sm'], ['Facturé', 'pc-num pc-hide-sm'], ['Payé', 'pc-num pc-hide-sm'], ['Reste', 'pc-num'], ['Retard'], ['']], rows) : hint('Aucune facture fournisseur à payer.'))
        + (sup.length ? `<div class="tr-sec">SOLDES PAR FOURNISSEUR</div>${tbl([['Fournisseur'], ['Solde', 'pc-num']], sup)}` : '');
    } };
  }

  /* -- Échéancier -- */
  function echTab(d) {
    const items = d.invoices.map(x => ({ side: 'in', due: x.due_date, ref: x.invoice_no, party: x.customer_name, amount: x.remaining, late: x.days_late, id: x.id }))
      .concat(d.purchases.map(x => ({ side: 'out', due: x.due_date, ref: x.invoice_no || x.order_no, party: x.supplier, amount: x.remaining, late: x.days_late, id: x.id })));
    const days = x => (x.due ? Math.round((new Date(x.due + 'T00:00:00').getTime() - new Date(isoDay() + 'T00:00:00').getTime()) / 864e5) : null);
    items.forEach(x => { x.d = days(x); });
    const w30 = items.filter(x => x.d != null && x.d >= 0 && x.d <= 30), inn = sum(w30.filter(x => x.side === 'in'), x => x.amount), out = sum(w30.filter(x => x.side === 'out'), x => x.amount);
    const kp = kpiRow([card('c-green', '⬇', 'À encaisser (30 j)', f(inn), w30.filter(x => x.side === 'in').length + ' échéance(s)'), card('c-pink', '⬆', 'À payer (30 j)', f(out), w30.filter(x => x.side === 'out').length + ' échéance(s)'),
      card('c-teal', '⚖', 'Solde net (30 j)', f(inn - out), 'encaissements − paiements'), card('c-red', '⏰', 'Déjà en retard', f(sum(items.filter(x => x.d != null && x.d < 0 && x.side === 'in'), x => x.amount)) , 'créances clients échues')]);
    return { kp, bar: searchBar('Tiers ou référence…', [['', 'Toutes'], ['in', 'À encaisser'], ['out', 'À payer'], ['late', 'En retard']]), table: () => {
      const rows = items.filter(x => match(x, ['party', 'ref']) && (!DET.sel || DET.sel === x.side || (DET.sel === 'late' && x.d != null && x.d < 0)))
        .sort((a, b) => (a.d == null) - (b.d == null) || a.d - b.d).map(x => `<tr class="pc-row" onclick="${x.side === 'in' ? (typeof billShow === 'function' ? `billShow(${x.id})` : '') : `showPO(${x.id})`}"><td>${x.due ? fdate(x.due) : '<span class="pt-zero">Sans échéance</span>'}</td>
          <td>${x.side === 'in' ? '<span class="pt-green">Client</span>' : '<span class="pt-red">Fournisseur</span>'}</td><td>${esc(x.party)}</td><td class="pc-hide-sm">${esc(x.ref || '')}</td>
          <td class="pc-num">${x.side === 'in' ? '<span class="pt-green">+' : '<span class="pt-red">−'}${f(x.amount)}</span></td><td>${x.d == null ? '—' : x.d < 0 ? `<span class="tr-late">retard ${-x.d} j</span>` : x.d === 0 ? '<b>Aujourd’hui</b>' : 'dans ' + x.d + ' j'}</td></tr>`);
      return rows.length ? tbl([['Échéance'], ['Type'], ['Tiers'], ['Réf.', 'pc-hide-sm'], ['Montant', 'pc-num'], ['Délai']], rows) : hint('Aucune échéance à venir.');
    } };
  }

  /* -- Historique des règlements -- */
  async function histTab() {
    const p = await G('/debts/payments?from=' + DET.from + '&to=' + DET.to);
    const kp = kpiRow([card('c-green', '⬇', 'Encaissé des clients', f(p.totals.clients), 'sur la période'), card('c-pink', '⬆', 'Payé aux fournisseurs', f(p.totals.fournisseurs), 'sur la période'), card('c-teal', '⚖', 'Net', f(p.totals.clients - p.totals.fournisseurs), 'encaissé − payé')]);
    const bar = `<div class="pc-filters"><label class="tr-lbl">Du <input type="date" id="det-from" value="${DET.from}"></label><label class="tr-lbl">au <input type="date" id="det-to" value="${DET.to}"></label><button type="button" onclick="detApply()">Appliquer</button></div>`;
    const rows = p.lines.map(x => `<tr><td>${new Date(x.paid_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${x.side === 'client' ? '<span class="pt-green">Encaissement client</span>' : '<span class="pt-red">Paiement fournisseur</span>'}</td><td>${esc(x.party)}</td><td class="pc-hide-sm">${esc(x.ref || '')}</td><td class="pc-hide-sm">${esc(x.method || '')}</td><td class="pc-num">${x.side === 'client' ? '<span class="pt-green">+' : '<span class="pt-red">−'}${f(x.amount)}</span></td></tr>`);
    return { kp, bar, table: () => (rows.length ? tbl([['Date'], ['Opération'], ['Tiers'], ['Réf.', 'pc-hide-sm'], ['Mode', 'pc-hide-sm'], ['Montant', 'pc-num']], rows) : hint('Aucun règlement sur cette période.')) };
  }

  /* -- Relances -- */
  function remTab(d) {
    const R = DET.rem || { pending: [], history: [] }, monthStr = isoDay().slice(0, 7);
    const kp = kpiRow([card('c-orange', '🔔', 'Clients à relancer', R.pending.length, 'sans relance depuis 7 jours'), card('c-red', '💰', 'Montant concerné', f(sum(R.pending, x => x.due)), 'factures échues'),
      card('c-purple', '⏱', 'Retard maximal', (R.pending.length ? Math.max(...R.pending.map(x => x.max_late)) : 0) + ' j', 'plus ancienne facture échue'), card('c-blue', '✉', 'Relances ce mois', R.history.filter(x => String(x.created_at).slice(0, 7) === monthStr).length, 'envoyées')]);
    return { kp, bar: '', table: () => {
      const rows = R.pending.map(x => `<tr><td><b>${esc(x.name)}</b><small class="pt-sub">${esc(x.phone || x.email || '')}</small></td><td class="pc-num pc-hide-sm">${x.invoices}</td><td class="pc-num pt-red">${f(x.due)}</td><td>${lateBadge(x.max_late)}</td><td class="pc-hide-sm">${x.last_reminder ? fdate(x.last_reminder) : '<span class="pt-zero">Jamais</span>'}</td>
        <td class="pc-act"><button type="button" class="b2" onclick="detRemind(${x.customer_id},'whatsapp')">WhatsApp</button> <button type="button" class="b2" onclick="detRemind(${x.customer_id},'email')">E-mail</button> <button type="button" class="b2" onclick="detRemind(${x.customer_id},'appel')">Appel</button></td></tr>`);
      const hist = R.history.slice(0, 30).map(x => `<tr><td>${new Date(x.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${esc(x.customer)}</td><td>${esc(x.channel)}</td><td class="pc-num pc-hide-sm">${x.amount == null ? '—' : f(x.amount)}</td><td class="pc-hide-sm">${esc(x.login || '')}</td></tr>`);
      return (rows.length ? tbl([['Client'], ['Factures', 'pc-num pc-hide-sm'], ['Dû', 'pc-num'], ['Retard'], ['Dernière relance', 'pc-hide-sm'], ['Relancer par']], rows) : hint('Aucune relance à faire : tous les clients en retard ont été relancés récemment.'))
        + `<div class="tr-sec">HISTORIQUE DES RELANCES</div>` + (hist.length ? tbl([['Date'], ['Client'], ['Canal'], ['Montant', 'pc-num pc-hide-sm'], ['Par', 'pc-hide-sm']], hist) : hint('Aucune relance enregistrée.'));
    } };
  }

  async function detLoad() {
    const host = document.getElementById('det-body'); if (!host) return;
    host.innerHTML = '<p class="pc-empty">Chargement…</p>';
    try {
      const d = DET.data || await loadDebts();
      const part = DET.tab === 'cli' ? cliTab(d) : DET.tab === 'sup' ? supTab(d) : DET.tab === 'ech' ? echTab(d) : DET.tab === 'his' ? await histTab() : DET.tab === 'rel' ? remTab(d) : invTab(d);
      host.innerHTML = part.kp + part.bar + '<div id="det-tbl">' + part.table() + '</div>';
      DET.render = part.table;
    } catch (e) { host.innerHTML = `<p class="warn">${esc(e.message || e)}</p>`; }
    hydrate();
  }
  window.detTab = t => { DET.tab = t; DET.q = ''; DET.sel = ''; setTabs(t); detLoad(); };
  window.detSet = (k, v) => { DET[k] = v; const t = document.getElementById('det-tbl'); if (t && DET.render) t.innerHTML = DET.render(); };
  window.detApply = () => { const a = document.getElementById('det-from'), b = document.getElementById('det-to'); if (a && a.value) DET.from = a.value; if (b && b.value) DET.to = b.value; detLoad(); };
  window.detRefresh = async () => { DET.data = null; DET.rem = null; await go('dettes'); };

  window.detPayInvoice = async (id, rest) => {
    await refreshPmAccounts(); const opts = pmAccOpts(['credit']);
    if (!opts.length) return toast('Aucun compte actif disponible : rattachez un moyen de paiement à un compte (Finance).', 'error');
    form('Encaissement facture', [['amount', 'Montant', 'number'], ['method', 'Compte / mode de règlement', 's', opts], ['reference', 'Référence']], { amount: rest, method: opts[0][0] }, async d => {
      await Po('/invoices/' + id + '/pay', { amount: parseFloat(d.amount), method: d.method || 'especes', reference: d.reference || undefined });
      closeM(); toast('Paiement enregistré', 'success'); detRefresh();
    });
  };
  window.detPayCli = async (id, due) => {
    await refreshPmAccounts(); const opts = pmAccOpts(['credit']);
    if (!opts.length) return toast('Aucun compte actif disponible : rattachez un moyen de paiement à un compte (Finance).', 'error');
    form('Encaissement client', [['amount', 'Montant', 'number'], ['method', 'Compte / mode de règlement', 's', opts]], { amount: due, method: opts[0][0] }, async d => {
      await Po('/customers/' + id + '/payments', { amount: parseFloat(d.amount), method: d.method }); closeM(); toast('Paiement enregistré', 'success'); detRefresh();
    });
  };
  window.detPayPO = (id, rest) => form('Paiement fournisseur', [['amount', 'Montant (reste ' + fl(rest) + ')', 'number'], ['method', 'Mode', 's', pmOpts(['credit'])]], { amount: rest }, async d => {
    await Po('/purchases/' + id + '/pay', d); closeM(); toast('Paiement enregistré', 'success'); detRefresh();
  });

  function waNumber(p) { let d = String(p || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) d = d.slice(1); else if (d.startsWith('00')) d = d.slice(2); d = d.replace(/\D/g, ''); if (d.length === 8) d = '223' + d; return d.length >= 10 && d.length <= 15 ? d : null; }
  // Relance : ouvre WhatsApp / e-mail / appel, puis l'enregistre dans l'historique
  window.detRemind = async (customerId, channel) => {
    const d = DET.data || await loadDebts();
    const c = (DET.rem.pending.find(x => x.customer_id === customerId)) || (d.customers.find(x => x.id === customerId));
    if (!c) return toast('Client introuvable', 'error');
    const due = c.due != null ? c.due : c.balance, name = c.name;
    const msg = `Bonjour ${name}, sauf erreur de notre part, un montant de ${f(due)} reste à régler sur votre compte. Merci de procéder au règlement. Cordialement.`;
    if (channel === 'whatsapp') { const n = waNumber(c.phone); if (!n) return toast('Numéro invalide : utilisez le format +223 XX XX XX XX sur la fiche client.', 'error'); window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(msg), '_blank'); }
    else if (channel === 'email') { if (!c.email) return toast('Ce client n’a pas d’adresse e-mail.', 'error'); location.href = 'mailto:' + encodeURIComponent(c.email) + '?subject=' + encodeURIComponent('Rappel de paiement') + '&body=' + encodeURIComponent(msg); }
    else if (channel === 'appel' && c.phone) location.href = 'tel:' + String(c.phone).replace(/\s/g, '');
    try { await Po('/debts/reminders', { customer_id: customerId, channel, amount: due, message: msg }); toast('Relance enregistrée', 'success'); DET.rem = await G('/debts/reminders'); if (DET.tab === 'rel') detLoad(); else setTabs(DET.tab); }
    catch (e) { toast(e.message || 'Relance non enregistrée', 'error'); }
  };

  window.detEtat = async () => {
    const d = DET.data || await loadDebts(), late = d.invoices.filter(x => x.days_late > 0), latePu = d.purchases.filter(x => x.days_late > 0);
    const top = d.customers.slice(0, 15).map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td><td class="n">${f(c.balance)}</td></tr>`);
    const sup = d.suppliers.filter(s => s.balance_due > 0).slice(0, 15).map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.phone || '')}</td><td class="n">${f(s.balance_due)}</td></tr>`);
    printDoc('État récapitulatif — créances et dettes', `<h1>État récapitulatif des créances et dettes</h1><small>Situation au ${fdate(d.as_of)}</small>
      <h2>Créances clients</h2>${kv('Clients débiteurs', d.customers.length)}${kv('Montant dû', f(sum(d.customers, c => c.balance)))}${kv('Factures impayées', d.invoices.length)}${kv('Dont en retard', f(sum(late, x => x.remaining)))}
      ${top.length ? pTable([['Client'], ['Téléphone'], ['Solde dû', 'n']], top) : ''}
      <h2>Dettes fournisseurs</h2>${kv('Fournisseurs à payer', d.suppliers.filter(s => s.balance_due > 0).length)}${kv('Montant dû', f(sum(d.suppliers, s => Math.max(0, s.balance_due))))}${kv('Dont en retard', f(sum(latePu, x => x.remaining)))}
      ${sup.length ? pTable([['Fournisseur'], ['Téléphone'], ['Solde dû', 'n']], sup) : ''}
      <h2>Position</h2>${kv('Créances − dettes', f(sum(d.customers, c => c.balance) - sum(d.suppliers, s => Math.max(0, s.balance_due))))}`);
  };

  VM.dettes = async function () {
    const d = await loadDebts(), R = DET.rem;
    const tabs = [];
    if (!d.restricted.receivables) tabs.push(['cli', 'Créances clients'], ['inv', 'Factures impayées', d.invoices.length || '']);
    if (!d.restricted.payables) tabs.push(['sup', 'Dettes fournisseurs']);
    tabs.push(['ech', 'Échéancier'], ['his', 'Historique des règlements']);
    if (!d.restricted.receivables) tabs.push(['rel', 'Relances', R.pending.length || '']);
    if (!tabs.some(t => t[0] === DET.tab)) DET.tab = tabs[0][0];
    setTimeout(detLoad, 0);
    return `<div class="pc-head"><div><h2 class="pc-title">Créances &amp; dettes</h2><div class="pc-subtitle">Suivi des sommes dues par les clients et dues aux fournisseurs</div></div>
      <div class="pc-actions"><button class="b2" onclick="detEtat()">🖨 État récapitulatif</button></div></div>
      ${tabsHtml(tabs, DET.tab, 'detTab')}<div id="det-body"><p class="pc-empty">Chargement…</p></div>`;
  };

  /* ---------- enregistrement des pages ---------- */
  Object.assign(V, { treso: ['Trésorerie', 'cash.manage|finance.view|money.manage'], dettes: ['Créances & dettes', 'finance.view|receivable.view|debt.view|cash.manage'] });
  Object.assign(VM, { treso: VM.treso, dettes: VM.dettes });
  if (typeof NAV_ICONS !== 'undefined') Object.assign(NAV_ICONS, { treso: '🏦', dettes: '🧾' });
})();
