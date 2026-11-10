/* ext-accounting.js — page « Comptabilité » (plan comptable OHADA) : synthèse & contrôles, journaux, grand livre, balance,
   compte de résultat, bilan, TVA, plan comptable, immobilisations, exercices. API : /accounting/* (voir src/accounting.js).
   Les écritures automatiques sont dérivées des modules existants ; seules les écritures manuelles et immobilisations sont saisies ici. */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  const num = v => Number(v) || 0;
  const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const today = () => iso(new Date());
  const addD = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const fd = s => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
  const nf = v => Math.round(num(v)).toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ');
  const money = v => (num(v) < 0 ? '−' : '') + nf(Math.abs(num(v))) + ' FCFA';
  const cell = v => (num(v) ? nf(v) : '');
  const safeCan = p => { try { return can(p); } catch (_) { return false; } };
  const subOn = k => {
    try { const c = ME && ME.contract; if (!c || c.unrestricted) return true; return !!(((c.features || {}).modules || {})[k]); } catch (_) { return false; }
  };
  const JN = { VE: 'Ventes', HA: 'Achats', CA: 'Caisse', BQ: 'Banque', MM: 'Mobile Money', PA: 'Paie', IM: 'Immobilisations', ST: 'Stocks', AN: 'À-nouveaux', OD: 'Op. diverses' };
  const tbl = (heads, rows, cls) => `<div class="pc-tw"><table class="pc-tbl ${cls || ''}"><thead><tr>${heads.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const hint = t => `<p class="pc-empty">${esc(t)}</p>`;
  const CARD_COL = { '': 'c-blue', ok: 'c-green', bad: 'c-red' };   // « ok »/« bad »/vide n'avaient aucun fond : texte blanc sur fond clair en mode jour
  const card = (cls, icon, label, value, note) => `<div class="tr-card ${CARD_COL[cls] || cls}"><div class="tr-cl"><span>${icon}</span>${esc(label)}</div><div class="tr-cv">${value}</div><div class="tr-cn">${note || ''}</div></div>`;

  /* ---------- période ---------- */
  const ACC = { tab: 'synth', per: 'year', from: null, to: today(), journal: '', q: '', limit: 200, acct: '', cls: '', accounts: null, methods: null, cache: null };
  function applyPeriod(key) {
    const t = today(), d = new Date(t + 'T00:00:00'), y = d.getFullYear(), m = d.getMonth();
    ACC.per = key;
    if (key === 'today') { ACC.from = t; ACC.to = t; }
    else if (key === '7d') { ACC.from = addD(t, -6); ACC.to = t; }
    else if (key === 'month') { ACC.from = iso(new Date(y, m, 1)); ACC.to = t; }
    else if (key === 'prev') { ACC.from = iso(new Date(y, m - 1, 1)); ACC.to = iso(new Date(y, m, 0)); }
    else if (key === 'quarter') { ACC.from = iso(new Date(y, Math.floor(m / 3) * 3, 1)); ACC.to = t; }
    else if (key === 'year') { ACC.from = y + '-01-01'; ACC.to = t; }
    else if (key === 'all') { ACC.from = null; ACC.to = t; }
  }
  applyPeriod('year');
  const qs = () => `from=${ACC.from || ''}&to=${ACC.to}`;
  const CHIPS = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['month', 'Ce mois'], ['prev', 'Mois dernier'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout'], ['custom', 'Perso.']];
  const periodBadge = () => `<span class="ac-badge">${ACC.from ? 'Du ' + fd(ACC.from) + ' au ' + fd(ACC.to) : 'Jusqu’au ' + fd(ACC.to)}</span>`;
  const chipsHtml = () => `<div class="ac-chips">${CHIPS.map(([k, l]) => `<button type="button" class="ac-chip${ACC.per === k ? ' on' : ''}" onclick="accPer('${k}')">${l}</button>`).join('')}${periodBadge()}</div>
    ${ACC.per === 'custom' ? `<div class="ac-custom"><label>Du <input type="date" id="ac-from" value="${ACC.from || ''}"></label><label>au <input type="date" id="ac-to" value="${ACC.to}"></label><button class="b2" onclick="accCustom()">Appliquer</button></div>` : ''}`;
  window.accPer = k => { if (k === 'custom') { ACC.per = 'custom'; if (!ACC.from) ACC.from = ACC.to.slice(0, 4) + '-01-01'; } else applyPeriod(k); ACC.limit = 200; go('compta'); };
  window.accCustom = () => {
    const a = document.getElementById('ac-from').value, b = document.getElementById('ac-to').value;
    if (!b) return toast('Choisissez une date de fin.', 'error');
    if (a && a > b) return toast('La date de début doit précéder la date de fin.', 'error');
    ACC.from = a || null; ACC.to = b; go('compta');
  };

  /* ---------- onglets ---------- */
  function tabs() {
    const t = [['synth', 'Synthèse & contrôles'], ['jour', 'Journaux'], ['gl', 'Grand livre'], ['bal', 'Balance'], ['res', 'Compte de résultat'], ['bilan', 'Bilan']];
    if (subOn('accounting_vat')) t.push(['tva', 'TVA']);
    t.push(['plan', 'Plan comptable']);
    if (subOn('accounting_assets')) t.push(['immo', 'Immobilisations']);
    t.push(['exo', 'Exercices']);
    return t;
  }
  window.accTab = k => { if (ACC.tab !== k) ACC.q = ''; ACC.tab = k; ACC.limit = 200; document.querySelectorAll('.ac-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === k)); accLoad(); };
  const body = html => { const el = document.getElementById('ac-body'); if (el) el.innerHTML = html; };

  VM.compta = async function () {
    const t = tabs(); if (!t.some(x => x[0] === ACC.tab)) ACC.tab = 'synth';
    const canMan = safeCan('accounting.manage');
    setTimeout(accLoad, 0);
    return `<div class="ac-head"><div><h2 class="pc-title">Comptabilité</h2><div class="pc-subtitle">Comptabilité générale en partie double (plan comptable OHADA) : journaux, grand livre, balance, résultat, bilan et TVA</div></div>
      <div class="pc-actions">${canMan && subOn('accounting_entries') ? '<button class="ac-primary" onclick="accNewEntry()">＋ Nouvelle écriture</button>' : ''}${canMan && subOn('accounting_assets') ? '<button class="b2" onclick="accNewAsset()">🏗 Immobilisation</button>' : ''}<button class="b2" id="ac-pdf-btn" onclick="accPdf()" title="Exporter l’onglet affiché en PDF">📄 Export PDF</button></div></div>
      <div class="ac-tabs" role="tablist">${t.map(([k, l]) => `<button type="button" role="tab" data-t="${k}" class="${k === ACC.tab ? 'on' : ''}" onclick="accTab('${k}')">${l}</button>`).join('')}</div>
      ${chipsHtml()}<div id="ac-body"><p class="pc-empty">Chargement…</p></div>`;
  };

  async function accLoad() {
    try {
      const fn = { synth: tSynth, jour: tJour, gl: tGl, bal: tBal, res: tRes, bilan: tBilan, tva: tTva, plan: tPlan, immo: tImmo, exo: tExo }[ACC.tab] || tSynth;
      body('<p class="pc-empty">Chargement…</p>');
      await fn();
    } catch (e) { if (!e || !e.stale) body(hint((e && e.message) || 'Erreur de chargement.')); }
  }

  /* ---------- Synthèse & contrôles ---------- */
  async function tSynth() {
    const s = await G('/accounting/summary?' + qs()), k = s.kpis;
    const ic = { ok: '✅', warn: '⚠️', error: '❌' };
    const nErr = s.controls.filter(c => c.status !== 'ok').length;
    body(`<div class="tr-cards">${card('c-green', '📈', 'Produits', money(k.produits))}${card('c-orange', '📉', 'Charges', money(k.charges))}${card(k.resultat >= 0 ? 'ok' : 'bad', '🧮', 'Résultat', money(k.resultat), 'Marge commerciale ' + money(k.marge_commerciale))}
      ${card('c-teal', '🏦', 'Trésorerie', money(k.tresorerie), 'Caisse + banques + Mobile Money')}${card('c-indigo', '🧾', 'Clients', money(k.clients))}${card('c-purple', '🏭', 'Fournisseurs', money(k.fournisseurs))}${card('c-slate', '🏛', 'TVA due', money(k.tva_due))}</div>
      <h3 class="ac-h">Contrôles de cohérence ${nErr ? `<span class="ac-warn">${nErr} à vérifier</span>` : '<span class="ac-okb">Tout est conforme</span>'}</h3>
      ${tbl([['Contrôle'], ['Comptabilité', 'n'], ['Module source', 'n'], ['Écart', 'n'], ['']], s.controls.map(c => `<tr><td>${ic[c.status]} ${esc(c.label)}${c.hint ? `<div class="ac-hint">${esc(c.hint)}</div>` : ''}</td><td class="n">${nf(c.ledger)}</td><td class="n">${nf(c.actual)}</td><td class="n ${c.status !== 'ok' ? 'pt-red' : ''}">${nf(c.diff)}</td><td></td></tr>`))}
      <h3 class="ac-h">Écritures de la période</h3>
      <div class="ac-jc">${Object.keys(JN).map(j => `<span class="ac-jchip" onclick="ACC.journal='${j}';accTab('jour')">${JN[j]} <b>${s.journals_count[j] || 0}</b></span>`).join('')}</div>
      <p class="ac-note">Exercice : <b>${esc(s.fiscal_year.label)}</b> (${fd(s.fiscal_year.start_date)} → ${fd(s.fiscal_year.end_date)}) — ${s.fiscal_year.status === 'cloture' ? '🔒 clôturé' : 'ouvert'}${s.fiscal_year.virtual ? ' · exercice par défaut (année civile) : créez vos exercices dans l’onglet Exercices' : ''}.
      ${(s.locks || []).length ? '<br>Périodes verrouillées (Verrouillage de période) : ' + s.locks.map(l => esc(l.period_key)).join(', ') + '.' : ''}</p>`);
  }

  /* ---------- Journaux ---------- */
  async function tJour() {
    const d = await G(`/accounting/journals?${qs()}&journal=${ACC.journal}&q=${encodeURIComponent(ACC.q)}&limit=${ACC.limit}`);
    const canCancel = safeCan('accounting.manage') && subOn('accounting_entries');
    body(`<div class="ac-bar"><div class="ac-jc"><span class="ac-jchip${ACC.journal ? '' : ' on'}" onclick="ACC.journal='';accLoad()">Tous</span>${d.journals.map(j => `<span class="ac-jchip${ACC.journal === j.code ? ' on' : ''}" onclick="ACC.journal='${j.code}';accLoad()">${esc(JN[j.code])} <b>${j.count}</b></span>`).join('')}</div>
      <input class="ac-search" placeholder="Rechercher (libellé, pièce, compte)…" value="${esc(ACC.q)}" onchange="ACC.q=this.value;accLoad()">${subOn('accounting_export') ? '<button class="b2" onclick="accCsv(\'journal\')">⬇ CSV</button>' : ''}</div>
      ${d.entries.length ? d.entries.map(e => `<details class="ac-entry"><summary><span class="ac-d">${fd(e.date)}</span><span class="ac-j j-${e.journal}">${e.journal}</span><span class="ac-ref">${esc(e.ref)}</span><span class="ac-lab">${esc(e.label)}${e.auto ? '' : ' <em>(manuel)</em>'}</span><span class="ac-amt">${nf(e.debit)}</span></summary>
        ${tbl([['Compte'], ['Libellé'], ['Débit', 'n'], ['Crédit', 'n']], e.lines.map(l => `<tr><td><b>${esc(l.account)}</b> ${esc(l.label_account)}</td><td>${esc(l.label || '')}${l.party ? ` <small>(${l.party.t} n°${esc(l.party.id)})</small>` : ''}</td><td class="n">${cell(l.debit)}</td><td class="n">${cell(l.credit)}</td></tr>`))}
        ${!e.auto && canCancel ? `<div class="ac-ea"><button class="b2" onclick="accCancel(${e.id})">Annuler cette écriture</button></div>` : ''}</details>`).join('') : hint('Aucune écriture sur la période.')}
      ${d.total > d.entries.length ? `<div class="ac-more"><button class="b2" onclick="ACC.limit+=200;accLoad()">Afficher plus (${d.entries.length}/${d.total})</button></div>` : ''}`);
  }

  /* ---------- Grand livre ---------- */
  async function tGl() {
    const acc = ACC.acct;
    if (!acc) {
      const d = await G(`/accounting/ledger?${qs()}`);
      body(`<div class="ac-bar"><input class="ac-search" id="ac-gl" placeholder="N° de compte ou début de numéro (ex. 411, 57)" onchange="ACC.acct=this.value.replace(/\\D/g,'');accLoad()"></div>
        ${d.accounts.length ? tbl([['Compte'], ['Libellé'], ['Débit', 'n'], ['Crédit', 'n'], ['Solde', 'n']], d.accounts.map(a => `<tr class="ac-click" onclick="ACC.acct='${a.account}';accLoad()"><td><b>${esc(a.account)}</b></td><td>${esc(a.label)}</td><td class="n">${cell(a.debit)}</td><td class="n">${cell(a.credit)}</td><td class="n">${nf(a.net)}</td></tr>`)) : hint('Aucun mouvement sur la période.')}`);
      return;
    }
    const d = await G(`/accounting/ledger?${qs()}&account=${acc}`);
    body(`<div class="ac-bar"><button class="b2" onclick="ACC.acct='';accLoad()">← Tous les comptes</button><input class="ac-search" value="${esc(acc)}" onchange="ACC.acct=this.value.replace(/\\D/g,'');accLoad()"></div>
      ${d.ledgers.length ? d.ledgers.map(g => `<h3 class="ac-h">${esc(g.account)} — ${esc(g.label)}</h3>${tbl([['Date'], ['Jnl'], ['Pièce'], ['Libellé'], ['Débit', 'n'], ['Crédit', 'n'], ['Solde', 'n']],
        [`<tr class="ac-rep"><td colspan="6">Report à nouveau</td><td class="n">${nf(g.opening)}</td></tr>`].concat(g.rows.map(r => `<tr><td>${fd(r.date)}</td><td>${r.journal}</td><td>${esc(r.ref)}</td><td>${esc(r.label)}</td><td class="n">${cell(r.debit)}</td><td class="n">${cell(r.credit)}</td><td class="n">${nf(r.balance)}</td></tr>`))
          .concat([`<tr class="ac-tot"><td colspan="4">Total</td><td class="n">${nf(g.debit)}</td><td class="n">${nf(g.credit)}</td><td class="n">${nf(g.closing)}</td></tr>`]))}`).join('') : hint('Aucun compte actif ne commence par ce numéro.')}`);
  }

  /* ---------- Balance ---------- */
  async function tBal() {
    const d = await G('/accounting/trial-balance?' + qs()), T = d.totals;
    body(`<div class="ac-bar"><span></span>${subOn('accounting_export') ? '<button class="b2" onclick="accCsv(\'balance\')">⬇ CSV</button>' : ''}</div>
      ${d.rows.length ? tbl([['Compte'], ['Libellé'], ['Report D', 'n'], ['Report C', 'n'], ['Débit', 'n'], ['Crédit', 'n'], ['Solde D', 'n'], ['Solde C', 'n']],
        d.rows.map(r => `<tr class="ac-click" onclick="ACC.acct='${r.account}';accTab('gl')"><td><b>${esc(r.account)}</b></td><td>${esc(r.label)}</td><td class="n">${cell(r.open_debit)}</td><td class="n">${cell(r.open_credit)}</td><td class="n">${cell(r.debit)}</td><td class="n">${cell(r.credit)}</td><td class="n">${cell(r.end_debit)}</td><td class="n">${cell(r.end_credit)}</td></tr>`)
          .concat([`<tr class="ac-tot"><td colspan="2">Totaux</td><td class="n">${nf(T.open_debit)}</td><td class="n">${nf(T.open_credit)}</td><td class="n">${nf(T.debit)}</td><td class="n">${nf(T.credit)}</td><td class="n">${nf(T.end_debit)}</td><td class="n">${nf(T.end_credit)}</td></tr>`])) : hint('Aucun mouvement.')}
      <p class="ac-note">${Math.abs(T.debit - T.credit) < 1 && Math.abs(T.end_debit - T.end_credit) < 1 ? '✅ Balance équilibrée.' : '❌ Balance déséquilibrée.'}</p>`);
  }

  /* ---------- Compte de résultat ---------- */
  async function tRes() {
    const d = await G('/accounting/income-statement?' + qs()), T = d.totals;
    const sec = s => `<tr class="ac-sec"><td colspan="2">${esc(s.label)}</td><td class="n">${nf(s.total)}</td></tr>` + s.lines.map(l => `<tr><td><b>${esc(l.code)}</b></td><td>${esc(l.label)}</td><td class="n">${nf(l.amount)}</td></tr>`).join('');
    const ind = (l, v) => `<tr class="ac-tot"><td colspan="2">${l}</td><td class="n ${v < 0 ? 'pt-red' : ''}">${nf(v)}</td></tr>`;
    const S = k => d.sections.find(x => x.key === k);
    body(`<div class="ac-bar"><span></span></div>
      ${tbl([['Compte'], ['Libellé'], ['Montant', 'n']], [sec(S('ventes')), sec(S('achats')), sec(S('varstock')), ind('MARGE COMMERCIALE', T.marge_commerciale),
        sec(S('autres_produits')), sec(S('charges_externes')), sec(S('impots')), sec(S('personnel')), sec(S('autres_charges')), sec(S('dotations')), ind('RÉSULTAT D’EXPLOITATION', T.resultat_exploitation),
        sec(S('produits_financiers')), sec(S('charges_financieres')), ind('RÉSULTAT FINANCIER', T.resultat_financier), sec(S('hao_produits')), sec(S('hao_charges')), ind('RÉSULTAT HORS ACTIVITÉS ORDINAIRES', T.resultat_hao),
        sec(S('impot_resultat')), ind('RÉSULTAT NET', T.resultat_net)])}
      <p class="ac-note">Total produits <b>${money(T.produits)}</b> − total charges <b>${money(T.charges)}</b> = <b>${money(T.resultat_net)}</b>. Le stock est valorisé au prix d’achat courant (inventaire permanent).</p>`);
  }

  /* ---------- Bilan ---------- */
  async function tBilan() {
    const d = await G('/accounting/balance-sheet?to=' + ACC.to);
    const col = (title, rows, total) => `<div class="ac-bc"><div class="ac-bt">${title}</div>${rows.map(r => `<div class="ac-br"><span>${esc(r.label)}</span><b>${money(r.amount)}</b></div>`).join('')}<div class="ac-br ac-btot"><span>Total ${title.toLowerCase()}</span><b>${money(total)}</b></div></div>`;
    body(`<div class="ac-bar"><span class="ac-badge">Bilan arrêté au ${fd(d.as_of)}</span><span class="${d.balanced ? 'ac-okb' : 'ac-warn'}">${d.balanced ? 'Actif = Passif' : 'Écart ' + money(d.difference)}</span></div>
      <div class="ac-bilan">${col('ACTIF', d.actif, d.total_actif)}${col('PASSIF', d.passif, d.total_passif)}</div>
      <p class="ac-note">Exercice ${esc(d.fiscal_year.label)} (du ${fd(d.fiscal_year.start_date)}). Les résultats des exercices antérieurs figurent au report à nouveau.</p>`);
  }

  /* ---------- TVA ---------- */
  async function tTva() {
    const d = await G('/accounting/vat?' + qs());
    body(`<div class="tr-cards">${card('', '🧾', 'TVA collectée', money(d.collected))}${card('', '↩️', 'TVA déductible', money(d.deductible), 'Écritures 4452 (saisie manuelle)')}${card(d.due > 0 ? 'bad' : 'ok', '🏛', d.due >= 0 ? 'TVA à reverser' : 'Crédit de TVA', money(Math.abs(d.due)))}</div>
      <h3 class="ac-h">Par mois</h3>${d.months.length ? tbl([['Mois'], ['Collectée', 'n'], ['Déductible', 'n'], ['Solde', 'n']], d.months.map(m => `<tr><td>${esc(m.month)}</td><td class="n">${nf(m.collected)}</td><td class="n">${nf(m.deductible)}</td><td class="n">${nf(m.due)}</td></tr>`)) : hint('Aucune TVA sur la période.')}
      <h3 class="ac-h">Par taux</h3>${d.rates.length ? tbl([['Taux'], ['Base HT', 'n'], ['TVA', 'n']], d.rates.map(r => `<tr><td>${r.rate === 'autre' ? 'Autres (manuel / factures)' : esc(r.rate) + ' %'}</td><td class="n">${nf(r.base)}</td><td class="n">${nf(r.tax)}</td></tr>`)) : ''}
      <p class="ac-note">Les prix de vente sont considérés TTC : TVA = montant × taux / (100 + taux). Les achats ne portent pas de TVA déductible automatique : saisissez-la en écriture manuelle (Débit 4452).</p>`);
  }

  /* ---------- Plan comptable ---------- */
  async function tPlan() {
    const d = await G('/accounting/accounts?' + qs()); ACC.accounts = d.accounts;
    const q = String(ACC.q || '').toLowerCase();
    const list = d.accounts.filter(a => (!ACC.cls || String(a.class) === ACC.cls) && (!q || (a.code + ' ' + a.label).toLowerCase().includes(q)));
    body(`<div class="ac-bar"><select onchange="ACC.cls=this.value;accLoad()"><option value="">Toutes les classes</option>${[1, 2, 3, 4, 5, 6, 7, 8].map(c => `<option value="${c}" ${ACC.cls === String(c) ? 'selected' : ''}>Classe ${c}</option>`).join('')}</select>
      <input class="ac-search" placeholder="Rechercher un compte…" value="${esc(ACC.q)}" onchange="ACC.q=this.value;accLoad()">${safeCan('accounting.manage') ? '<button class="b2" onclick="accNewAccount()">＋ Compte</button>' : ''}</div>
      ${tbl([['Compte'], ['Libellé'], ['Débit', 'n'], ['Crédit', 'n'], ['Solde', 'n']], list.map(a => `<tr class="${a.active ? '' : 'ac-off'}"><td><b>${esc(a.code)}</b></td><td>${esc(a.label)}${a.is_custom ? ' <em>(personnalisé)</em>' : ''}</td><td class="n">${cell(a.debit)}</td><td class="n">${cell(a.credit)}</td><td class="n">${a.debit || a.credit ? nf(a.net) : ''}</td></tr>`))}`);
  }
  window.accNewAccount = () => form('Nouveau compte', [['code', 'Numéro (3 à 10 chiffres)'], ['label', 'Libellé']], {}, async d => {
    await Po('/accounting/accounts', { code: String(d.code).trim(), label: d.label }); closeM(); toast('Compte créé', 'success'); accLoad();
  });

  /* ---------- Immobilisations ---------- */
  const CATS = [['221', 'Terrain'], ['231', 'Bâtiment'], ['238', 'Aménagements / agencements'], ['2411', 'Pompes, cuves, équipements de distribution'], ['241', 'Matériel et outillage'], ['244', 'Mobilier / matériel de bureau'], ['245', 'Matériel de transport'], ['246', 'Matériel informatique'], ['212', 'Logiciels / licences'], ['248', 'Autres matériels']];
  async function tImmo() {
    const d = await G('/accounting/assets?to=' + ACC.to), canM = safeCan('accounting.manage');
    const ST = { en_service: 'En service', cede: 'Cédée', rebut: 'Mise au rebut' };
    body(`<div class="tr-cards">${card('', '🏗', 'Valeur brute', money(d.totals.cost), 'Immobilisations en service')}${card('c-orange', '📉', 'Amortissements cumulés', money(d.totals.depreciation), 'Au ' + fd(d.as_of))}${card('ok', '💠', 'Valeur nette', money(d.totals.cost - d.totals.depreciation))}</div>
      ${d.assets.length ? tbl([['Immobilisation'], ['Acquise le'], ['Coût', 'n'], ['Durée', 'n'], ['Amort. cumulé', 'n'], ['Valeur nette', 'n'], ['Statut'], ['']], d.assets.map(a => `<tr><td><b>${esc(a.label)}</b><div class="ac-hint">Compte ${esc(a.category)}${a.supplier_name ? ' · ' + esc(a.supplier_name) : ''}</div></td><td>${fd(a.acquired_on)}</td><td class="n">${nf(a.cost)}</td><td class="n">${a.life_years ? a.life_years + ' ans' : '—'}</td><td class="n">${nf(a.depreciation)}</td><td class="n">${nf(a.net_value)}</td><td>${ST[a.status]}${a.disposed_on ? '<div class="ac-hint">' + fd(a.disposed_on) + '</div>' : ''}</td><td>${canM && a.status === 'en_service' ? `<button class="b2" onclick="accDispose(${a.id})">Sortir</button>` : ''}</td></tr>`)) : hint('Aucune immobilisation enregistrée.')}
      <p class="ac-note">Amortissement linéaire au prorata des jours. Une immobilisation payée via la Trésorerie génère le décaissement réel dans la caisse ou le compte choisi.</p>`);
  }
  async function methods() { if (!ACC.methods) ACC.methods = (await G('/accounting/payment-methods')).methods; return ACC.methods; }
  window.accNewAsset = async () => {
    const ms = await methods().catch(() => []);
    form('Nouvelle immobilisation', [['label', 'Désignation'], ['category', 'Catégorie', 's', CATS.map(c => [c[0], c[0] + ' — ' + c[1]])], ['acquired_on', 'Date d’acquisition', 'date'], ['cost', 'Coût d’acquisition (FCFA)', 'number'],
      ['residual_value', 'Valeur résiduelle (FCFA)', 'number'], ['life_years', 'Durée d’amortissement (années ; vide pour un terrain)', 'number'],
      ['funding', 'Financement', 's', [['apport', 'Apport / déjà possédée'], ['tresorerie', 'Payée maintenant (Trésorerie)'], ['dette', 'À payer (dette d’investissement)']]],
      ['funding_method', 'Moyen de paiement (si payée maintenant)', 's', [['', '—']].concat(ms.map(m => [m.code, m.label]))], ['supplier_name', 'Fournisseur (facultatif)']], { acquired_on: today(), residual_value: 0, funding: 'apport' }, async d => {
      const cost = parseFloat(d.cost); if (!(cost > 0)) return toast('Coût invalide', 'error');
      await Po('/accounting/assets', { label: d.label, category: d.category, acquired_on: d.acquired_on, cost, residual_value: parseFloat(d.residual_value) || 0, life_years: parseFloat(d.life_years) || null, funding: d.funding, funding_method: d.funding === 'tresorerie' ? d.funding_method : null, supplier_name: d.supplier_name || null });
      closeM(); toast('Immobilisation enregistrée', 'success'); ACC.tab = 'immo'; go('compta');
    });
  };
  window.accDispose = async id => {
    const ms = await methods().catch(() => []);
    form('Sortie d’une immobilisation', [['status', 'Type', 's', [['cede', 'Cession (vente)'], ['rebut', 'Mise au rebut']]], ['disposed_on', 'Date de sortie', 'date'], ['price', 'Prix de cession (FCFA)', 'number'],
      ['method', 'Encaissé par', 's', [['creance', 'À recevoir (créance)']].concat(ms.map(m => [m.code, m.label]))]], { disposed_on: today(), price: 0, status: 'cede' }, async d => {
      await Po(`/accounting/assets/${id}/dispose`, { status: d.status, disposed_on: d.disposed_on, price: parseFloat(d.price) || 0, method: d.method }); closeM(); toast('Sortie enregistrée', 'success'); accLoad();
    });
  };

  /* ---------- Exercices ---------- */
  async function tExo() {
    const d = await G('/accounting/fiscal-years'), canM = safeCan('accounting.manage') && subOn('accounting_closing');
    const y = new Date().getFullYear();
    body(`${canM ? `<div class="ac-bar"><button class="b2" onclick="accNewFY(${y})">＋ Nouvel exercice</button></div>` : ''}
      ${d.fiscal_years.length ? tbl([['Exercice'], ['Début'], ['Fin'], ['Résultat', 'n'], ['Statut'], ['']], d.fiscal_years.map(x => `<tr><td><b>${esc(x.label)}</b></td><td>${fd(x.start_date)}</td><td>${fd(x.end_date)}</td><td class="n ${x.result < 0 ? 'pt-red' : ''}">${nf(x.status === 'cloture' ? x.closing_result : x.result)}</td><td>${x.status === 'cloture' ? '🔒 Clôturé' : 'Ouvert'}</td>
        <td>${canM ? (x.status === 'ouvert' ? `<button class="b2" onclick="accCloseFY(${x.id})">Clôturer</button>` : `<button class="b2" onclick="accReopenFY(${x.id})">Rouvrir</button>`) : ''}</td></tr>`)) : hint('Aucun exercice défini : l’année civile est utilisée par défaut.')}
      <p class="ac-note">La clôture vérifie l’équilibre du bilan, fige le résultat et interdit toute écriture manuelle ou immobilisation sur la période. Les périodes déjà verrouillées via « Verrouillage de période » sont également respectées.</p>`);
  }
  window.accNewFY = y => form('Nouvel exercice', [['label', 'Libellé (ex. ' + y + ')'], ['start_date', 'Début', 'date'], ['end_date', 'Fin', 'date']], { label: String(y), start_date: y + '-01-01', end_date: y + '-12-31' }, async d => {
    await Po('/accounting/fiscal-years', { label: d.label, start_date: d.start_date, end_date: d.end_date }); closeM(); toast('Exercice créé', 'success'); accLoad();
  });
  window.accCloseFY = async id => { if (!confirm('Clôturer cet exercice ? Plus aucune écriture ne pourra y être passée.')) return; try { const r = await Po(`/accounting/fiscal-years/${id}/close`, {}); toast('Exercice clôturé — résultat ' + money(r.result), 'success'); accLoad(); } catch (e) { toast(e.message, 'error'); } };
  window.accReopenFY = id => form('Rouvrir l’exercice', [['reason', 'Motif (obligatoire, journalisé)']], {}, async d => { await Po(`/accounting/fiscal-years/${id}/reopen`, { reason: d.reason }); closeM(); toast('Exercice rouvert', 'success'); accLoad(); });

  /* ---------- Saisie d'écriture ---------- */
  async function accountList() { if (!ACC.accounts) ACC.accounts = (await G('/accounting/accounts?' + qs())).accounts; return ACC.accounts; }
  window.accNewEntry = async () => {
    const accs = (await accountList()).filter(a => a.active && String(a.code).length >= 3);
    window.__acAccs = accs;
    modal(`<h3>Nouvelle écriture</h3><div class="ac-form"><label>Journal<select id="ae-j">${['OD', 'AN', 'CA', 'BQ', 'MM', 'HA', 'VE', 'PA'].map(j => `<option value="${j}">${JN[j]}</option>`).join('')}</select></label>
      <label>Date<input type="date" id="ae-d" value="${today()}"></label><label class="ac-w">Libellé<input id="ae-l" placeholder="Ex. Apport en capital"></label><label>Référence<input id="ae-r"></label></div>
      <datalist id="ae-dl">${accs.map(a => `<option value="${esc(a.code)}">${esc(a.label)}</option>`).join('')}</datalist>
      <table class="pc-tbl ac-lines"><thead><tr><th>Compte</th><th>Libellé</th><th class="n">Débit</th><th class="n">Crédit</th><th></th></tr></thead><tbody id="ae-b"></tbody></table>
      <div class="ac-ea"><button class="b2" onclick="accAddLine()">＋ Ligne</button><span id="ae-t" class="ac-note"></span></div>
      <div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="ae-ok" onclick="accSaveEntry()">Enregistrer</button></div>`);
    accAddLine(); accAddLine();
  };
  window.accAddLine = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td><input list="ae-dl" class="ae-a" size="8" placeholder="N°"></td><td><input class="ae-lb"></td><td><input type="number" min="0" step="1" class="ae-dd n" oninput="accTot()"></td><td><input type="number" min="0" step="1" class="ae-cc n" oninput="accTot()"></td><td><button class="b2" onclick="this.closest(\'tr\').remove();accTot()">✕</button></td>';
    document.getElementById('ae-b').appendChild(tr);
  };
  window.accTot = () => {
    let d = 0, c = 0; document.querySelectorAll('#ae-b tr').forEach(r => { d += num(r.querySelector('.ae-dd').value); c += num(r.querySelector('.ae-cc').value); });
    const el = document.getElementById('ae-t'); if (el) el.innerHTML = `Débit ${nf(d)} · Crédit ${nf(c)} · ` + (Math.abs(d - c) < 0.005 && d > 0 ? '<b class="ac-okb">équilibrée</b>' : `<b class="ac-warn">écart ${nf(d - c)}</b>`);
  };
  window.accSaveEntry = async () => {
    const lines = [...document.querySelectorAll('#ae-b tr')].map(r => ({ account: r.querySelector('.ae-a').value.trim(), label: r.querySelector('.ae-lb').value.trim() || null, debit: num(r.querySelector('.ae-dd').value), credit: num(r.querySelector('.ae-cc').value) })).filter(l => l.account || l.debit || l.credit);
    if (lines.length < 2) return toast('Une écriture comporte au moins deux lignes.', 'error');
    try {
      await Po('/accounting/entries', { journal: document.getElementById('ae-j').value, entry_date: document.getElementById('ae-d').value, label: document.getElementById('ae-l').value, reference: document.getElementById('ae-r').value || null, lines });
      closeM(); toast('Écriture enregistrée', 'success'); ACC.accounts = null; go('compta');
    } catch (e) { toast(e.message, 'error'); }
  };
  window.accCancel = id => form('Annuler l’écriture', [['reason', 'Motif (obligatoire, journalisé)']], {}, async d => { await Po(`/accounting/entries/${id}/cancel`, { reason: d.reason }); closeM(); toast('Écriture annulée', 'success'); accLoad(); });

  /* ---------- exports ---------- */
  window.accCsv = async kind => {
    try {
      const r = await fetch(`/api/accounting/export?${qs()}&kind=${kind}`, { headers: { ...(TK && { Authorization: 'Bearer ' + TK }), ...(SID && { 'X-Station-Id': SID }) } });
      if (!r.ok) { const j = await r.json().catch(() => ({})); return toast(j.error || 'Export impossible', 'error'); }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = `compta_${kind}_${ACC.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (e) { toast(e.message, 'error'); }
  };
  /* ---------- Export PDF structuré (toutes les rubriques) ----------
     Le rapport est construit à partir des DONNÉES de l'API (et non du DOM) : tableaux alignés, montants numériques,
     lignes de total réelles, aucun emoji (la police PDF ne les gère pas). Même moteur que les autres rapports de la station. */
  const pm = v => money(v).replace(/\u2212/g, '-');            // montant texte sans signe typographique
  const pn = v => Math.round(num(v));                          // montant numérique (formaté et aligné à droite par le moteur)
  const pc = v => (num(v) ? Math.round(num(v)) : '');          // vide si zéro
  const sum = (arr, f) => arr.reduce((a, x) => a + num(f(x)), 0);
  const MAXROWS = 4500;
  const periodSub = () => (ACC.from ? 'Du ' + fd(ACC.from) + ' au ' + fd(ACC.to) : 'Jusqu’au ' + fd(ACC.to));
  const TITLES = { synth: 'Synthèse et contrôles comptables', jour: 'Journaux comptables', gl: 'Grand livre', bal: 'Balance générale', res: 'Compte de résultat', bilan: 'Bilan', tva: 'TVA', plan: 'Plan comptable', immo: 'Immobilisations', exo: 'Exercices comptables' };
  const CTRL = { ok: 'Conforme', warn: 'À vérifier', error: 'Erreur' };

  async function pSynth() {
    const s = await G('/accounting/summary?' + qs()), k = s.kpis, fy = s.fiscal_year;
    return { sections: [
      { type: 'kpis', title: 'Indicateurs clés', items: [
        { label: 'Produits', value: pm(k.produits) }, { label: 'Charges', value: pm(k.charges) },
        { label: 'Résultat', value: pm(k.resultat), note: 'Marge commerciale ' + pm(k.marge_commerciale) },
        { label: 'Trésorerie', value: pm(k.tresorerie), note: 'Caisse + banques + Mobile Money' },
        { label: 'Clients', value: pm(k.clients) }, { label: 'Fournisseurs', value: pm(k.fournisseurs) }, { label: 'TVA due', value: pm(k.tva_due) }] },
      { type: 'table', title: 'Contrôles de cohérence', head: ['Contrôle', 'Comptabilité', 'Module source', 'Écart', 'Statut'],
        rows: s.controls.map(c => [c.label + (c.hint ? ' (' + c.hint + ')' : ''), pn(c.ledger), pn(c.actual), pn(c.diff), CTRL[c.status] || c.status]) },
      { type: 'kv', title: 'Écritures de la période par journal', rows: Object.keys(JN).map(j => [JN[j], String((s.journals_count || {})[j] || 0)]) },
      { type: 'text', title: 'Exercice', text: `${fy.label} (du ${fd(fy.start_date)} au ${fd(fy.end_date)}) - ${fy.status === 'cloture' ? 'clôturé' : 'ouvert'}${fy.virtual ? ' - exercice par défaut (année civile)' : ''}.${(s.locks || []).length ? ' Périodes verrouillées : ' + s.locks.map(l => l.period_key).join(', ') + '.' : ''}` }
    ] };
  }

  async function pJour() {
    let off = 0, total = 0, all = [];
    do {
      const d = await G(`/accounting/journals?${qs()}&journal=${ACC.journal}&q=${encodeURIComponent(ACC.q)}&limit=1000&offset=${off}`);
      total = d.total; all = all.concat(d.entries); off += d.entries.length;
      if (!d.entries.length) break;
    } while (all.length < total && all.length < 3000);
    const rows = []; let tD = 0, tC = 0, cut = false;
    for (const e of all) {
      if (rows.length + e.lines.length > MAXROWS) { cut = true; break; }
      e.lines.forEach((l, i) => {
        tD += num(l.debit); tC += num(l.credit);
        rows.push([i ? '' : fd(e.date), i ? '' : e.journal, i ? '' : (e.ref || ''), i ? '' : (e.label || '') + (e.auto ? '' : ' (manuel)'),
          l.account + ' ' + (l.label_account || ''), l.label || '', pc(l.debit), pc(l.credit)]);
      });
    }
    const notes = [];
    if (cut || all.length < total) notes.push('Export limité aux ' + all.length + ' premières écritures sur ' + total + '. Réduisez la période ou filtrez par journal pour obtenir le reste.');
    if (ACC.journal) notes.push('Journal : ' + (JN[ACC.journal] || ACC.journal) + '.');
    if (ACC.q) notes.push('Filtre de recherche : « ' + ACC.q + ' ».');
    return { sections: [{ type: 'table', title: total + ' écriture(s)', head: ['Date', 'Jnl', 'Pièce', 'Libellé écriture', 'Compte', 'Libellé ligne', 'Débit', 'Crédit'],
      rows, totals: ['Total', '', '', '', '', '', pn(tD), pn(tC)], notes }] };
  }

  async function pGl() {
    const ledgerTable = g => ({ type: 'table', title: g.account + ' - ' + g.label, head: ['Date', 'Jnl', 'Pièce', 'Libellé', 'Débit', 'Crédit', 'Solde'],
      rows: [['', '', '', 'Report à nouveau', '', '', pn(g.opening)]].concat(g.rows.map(r => [fd(r.date), r.journal, r.ref || '', r.label || '', pc(r.debit), pc(r.credit), pn(r.balance)])),
      totals: ['', '', '', 'Total', pn(g.debit), pn(g.credit), pn(g.closing)] });
    if (ACC.acct) {
      const d = await G(`/accounting/ledger?${qs()}&account=${ACC.acct}&max=400`);
      if (!d.ledgers.length) return { sections: [{ type: 'text', text: 'Aucun compte actif ne commence par ' + ACC.acct + '.' }] };
      return { sub: 'Compte(s) ' + ACC.acct + '… - ' + periodSub(), sections: d.ledgers.slice(0, 295).map(ledgerTable) };
    }
    // Aucun compte saisi : grand livre général = tous les comptes mouvementés, détaillés classe par classe
    const sumry = await G(`/accounting/ledger?${qs()}`);
    const parts = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(c => G(`/accounting/ledger?${qs()}&account=${c}&max=400`).catch(() => ({ ledgers: [] }))));
    const all = parts.flatMap(p => p.ledgers);
    const sections = [{ type: 'table', title: 'Récapitulatif des comptes mouvementés', head: ['Compte', 'Libellé', 'Débit', 'Crédit', 'Solde'],
      rows: sumry.accounts.map(a => [a.account, a.label, pc(a.debit), pc(a.credit), pn(a.net)]),
      totals: ['Total', '', pn(sum(sumry.accounts, a => a.debit)), pn(sum(sumry.accounts, a => a.credit)), ''] }];
    all.slice(0, 295).forEach(g => sections.push(ledgerTable(g)));
    if (all.length > 295) sections.push({ type: 'text', text: 'Export limité à 295 comptes détaillés sur ' + all.length + '. Saisissez un numéro de compte (ex. 411) pour le détail d’une famille.' });
    return { sections };
  }

  async function pBal() {
    const d = await G('/accounting/trial-balance?' + qs()), T = d.totals;
    const ok = Math.abs(T.debit - T.credit) < 1 && Math.abs(T.end_debit - T.end_credit) < 1;
    return { sections: [{ type: 'table', head: ['Compte', 'Libellé', 'Report D', 'Report C', 'Débit', 'Crédit', 'Solde D', 'Solde C'],
      rows: d.rows.map(r => [r.account, r.label, pc(r.open_debit), pc(r.open_credit), pc(r.debit), pc(r.credit), pc(r.end_debit), pc(r.end_credit)]),
      totals: ['Totaux', '', pn(T.open_debit), pn(T.open_credit), pn(T.debit), pn(T.credit), pn(T.end_debit), pn(T.end_credit)],
      notes: [ok ? 'Balance équilibrée.' : 'ATTENTION : balance déséquilibrée.'] }] };
  }

  async function pRes() {
    const d = await G('/accounting/income-statement?' + qs()), T = d.totals;
    const S = k => d.sections.find(x => x.key === k), rows = [];
    const sec = s => { if (!s) return; rows.push(['', String(s.label).toUpperCase(), pn(s.total)]); s.lines.forEach(l => rows.push([l.code, l.label, pn(l.amount)])); };
    const ind = (l, v) => rows.push(['', l, pn(v)]);
    sec(S('ventes')); sec(S('achats')); sec(S('varstock')); ind('MARGE COMMERCIALE', T.marge_commerciale);
    sec(S('autres_produits')); sec(S('charges_externes')); sec(S('impots')); sec(S('personnel')); sec(S('autres_charges')); sec(S('dotations')); ind('RÉSULTAT D’EXPLOITATION', T.resultat_exploitation);
    sec(S('produits_financiers')); sec(S('charges_financieres')); ind('RÉSULTAT FINANCIER', T.resultat_financier);
    sec(S('hao_produits')); sec(S('hao_charges')); ind('RÉSULTAT HORS ACTIVITÉS ORDINAIRES', T.resultat_hao); sec(S('impot_resultat'));
    return { sections: [
      { type: 'kpis', items: [{ label: 'Total produits', value: pm(T.produits) }, { label: 'Total charges', value: pm(T.charges) }, { label: 'Résultat net', value: pm(T.resultat_net) }] },
      { type: 'table', head: ['Compte', 'Libellé', 'Montant'], rows, totals: ['', 'RÉSULTAT NET', pn(T.resultat_net)],
        notes: ['Le stock est valorisé au prix d’achat courant (inventaire permanent).'] }] };
  }

  async function pBilan() {
    const d = await G('/accounting/balance-sheet?to=' + ACC.to);
    const t = (title, list, total) => ({ type: 'table', title, head: ['Libellé', 'Montant'], rows: list.map(r => [r.label, pn(r.amount)]), totals: ['Total ' + title.toLowerCase(), pn(total)] });
    return { sub: 'Arrêté au ' + fd(d.as_of), sections: [
      t('ACTIF', d.actif, d.total_actif), t('PASSIF', d.passif, d.total_passif),
      { type: 'text', text: (d.balanced ? 'Actif = Passif : le bilan est équilibré.' : 'ATTENTION : écart Actif / Passif de ' + pm(d.difference) + '.') + ` Exercice ${d.fiscal_year.label} (du ${fd(d.fiscal_year.start_date)}). Les résultats des exercices antérieurs figurent au report à nouveau.` }] };
  }

  async function pTva() {
    const d = await G('/accounting/vat?' + qs());
    const sections = [{ type: 'kpis', items: [{ label: 'TVA collectée', value: pm(d.collected) }, { label: 'TVA déductible', value: pm(d.deductible) }, { label: d.due >= 0 ? 'TVA à reverser' : 'Crédit de TVA', value: pm(Math.abs(d.due)) }] }];
    if (d.months.length) sections.push({ type: 'table', title: 'Par mois', head: ['Mois', 'Collectée', 'Déductible', 'Solde'], rows: d.months.map(m => [m.month, pn(m.collected), pn(m.deductible), pn(m.due)]),
      totals: ['Total', pn(sum(d.months, m => m.collected)), pn(sum(d.months, m => m.deductible)), pn(sum(d.months, m => m.due))] });
    if (d.rates.length) sections.push({ type: 'table', title: 'Par taux', head: ['Taux', 'Base HT', 'TVA'], rows: d.rates.map(r => [r.rate === 'autre' ? 'Autres (manuel / factures)' : r.rate + ' %', pn(r.base), pn(r.tax)]) });
    sections.push({ type: 'text', text: 'Les prix de vente sont considérés TTC : TVA = montant x taux / (100 + taux). La TVA déductible provient des écritures manuelles (Débit 4452).' });
    return { sections };
  }

  async function pPlan() {
    const d = await G('/accounting/accounts?' + qs()), q = String(ACC.q || '').toLowerCase();
    const list = d.accounts.filter(a => (!ACC.cls || String(a.class) === ACC.cls) && (!q || (a.code + ' ' + a.label).toLowerCase().includes(q)));
    return { sub: (ACC.cls ? 'Classe ' + ACC.cls + ' - ' : '') + periodSub(), sections: [{ type: 'table', title: list.length + ' compte(s)', head: ['Compte', 'Libellé', 'Débit', 'Crédit', 'Solde'],
      rows: list.slice(0, MAXROWS).map(a => [a.code, a.label + (a.is_custom ? ' (personnalisé)' : '') + (a.active ? '' : ' (inactif)'), pc(a.debit), pc(a.credit), a.debit || a.credit ? pn(a.net) : '']) }] };
  }

  async function pImmo() {
    const d = await G('/accounting/assets?to=' + ACC.to);
    const ST = { en_service: 'En service', cede: 'Cédée', rebut: 'Mise au rebut' };
    return { sub: 'Situation au ' + fd(d.as_of), sections: [
      { type: 'kpis', items: [{ label: 'Valeur brute', value: pm(d.totals.cost), note: 'Immobilisations en service' }, { label: 'Amortissements cumulés', value: pm(d.totals.depreciation) }, { label: 'Valeur nette', value: pm(d.totals.cost - d.totals.depreciation) }] },
      { type: 'table', title: 'Détail des immobilisations', head: ['Immobilisation', 'Compte', 'Acquise le', 'Coût', 'Durée', 'Amort. cumulé', 'Valeur nette', 'Statut'],
        rows: d.assets.map(a => [a.label + (a.supplier_name ? ' (' + a.supplier_name + ')' : ''), a.category, fd(a.acquired_on), pn(a.cost), a.life_years ? a.life_years + ' ans' : '-', pn(a.depreciation), pn(a.net_value), (ST[a.status] || a.status) + (a.disposed_on ? ' le ' + fd(a.disposed_on) : '')]),
        notes: ['Amortissement linéaire au prorata des jours.'] }] };
  }

  async function pExo() {
    const d = await G('/accounting/fiscal-years');
    return { sub: 'Liste des exercices', sections: [{ type: 'table', head: ['Exercice', 'Début', 'Fin', 'Résultat', 'Statut'],
      rows: d.fiscal_years.map(x => [x.label, fd(x.start_date), fd(x.end_date), pn(x.status === 'cloture' ? x.closing_result : x.result), x.status === 'cloture' ? 'Clôturé' : 'Ouvert']) }] };
  }

  let pdfBusy = false;
  window.accPdf = async () => {
    if (pdfBusy) return; pdfBusy = true;
    const btn = document.getElementById('ac-pdf-btn'); if (btn) btn.disabled = true;
    try {
      const tab = ACC.tab, fn = { synth: pSynth, jour: pJour, gl: pGl, bal: pBal, res: pRes, bilan: pBilan, tva: pTva, plan: pPlan, immo: pImmo, exo: pExo }[tab] || pSynth;
      toast('Génération du PDF…', 'info');
      const r = await fn();
      if (!r.sections || !r.sections.length) return toast('Rien à exporter sur cette période.', 'info');
      const widest = Math.max(0, ...r.sections.filter(s => s.type === 'table').map(s => s.head.length));
      const title = TITLES[tab] || 'Comptabilité';
      await brandedPdf({ title, subtitle: r.sub || periodSub(), sections: r.sections, landscape: widest > 5 ? true : undefined,
        filename: title + '_' + ACC.to, signatures: [{ label: 'Comptable' }, { label: 'Direction' }] });
    } catch (e) { if (!e || !e.stale) toast((e && e.message) || 'Export PDF impossible', 'error'); }
    finally { pdfBusy = false; if (btn) btn.disabled = false; }
  };
  window.accPrint = () => window.accPdf();   // compatibilité avec d'anciens appels
  window.ACC = ACC; window.accLoad = accLoad;

  /* ---------- enregistrement ---------- */
  Object.assign(V, { compta: ['Comptabilité', 'accounting.view'] });
  Object.assign(VM, { compta: VM.compta });
  if (typeof NAV_ICONS !== 'undefined') Object.assign(NAV_ICONS, { compta: '📒' });
})();
