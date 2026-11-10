/* ext-achats.js — Interface moderne « Achats »
   Commandes fournisseurs, réceptions de marchandises et factures d'achat.
   Inspirée de la maquette : KPIs, filtres période/statut/fournisseur, table des commandes. */
(function () {
  'use strict';

  const STATUS_MAP = {
    commande: { label: 'commandée', cls: 'tag' },
    commandee: { label: 'commandée', cls: 'tag' },
    partiel: { label: 'partielle', cls: 'tag' },
    recue: { label: 'reçue', cls: 'tag ok' },
    recu: { label: 'reçue', cls: 'tag ok' },
    facture: { label: 'facturée', cls: 'tag' },
    paye: { label: 'payée', cls: 'tag ok' },
    archive: { label: 'archivée', cls: 'tag' },
    annule: { label: 'annulée', cls: 'tag x' },
    annulee: { label: 'annulée', cls: 'tag x' }
  };

  function statusTag(s) {
    const key = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const m = STATUS_MAP[key] || { label: s || '—', cls: 'tag' };
    return `<span class="${m.cls}">${esc(m.label)}</span>`;
  }

  function periodBounds(key) {
    const n = new Date();
    const y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
    const iso = (dt) => {
      const z = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
      return z.toISOString().slice(0, 10);
    };
    if (key === 'today') return [iso(n), iso(n)];
    if (key === '7d') { const f = new Date(n); f.setDate(d - 6); return [iso(f), iso(n)]; }
    if (key === 'month') return [iso(new Date(y, m, 1)), iso(n)];
    if (key === 'lastmonth') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (key === 'quarter') {
      const q = Math.floor(m / 3) * 3;
      return [iso(new Date(y, q, 1)), iso(n)];
    }
    if (key === 'year') return [iso(new Date(y, 0, 1)), iso(n)];
    return [null, null]; // all
  }

  function inPeriod(dateStr, from, to) {
    if (!from && !to) return true;
    if (!dateStr) return false;
    const d = String(dateStr).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) { return String(d).slice(0, 10); }
  }

  function money(v) {
    const n = Number(v) || 0;
    if (typeof f === 'function') return f(n);
    return n.toLocaleString('fr-FR') + ' FCFA';
  }

  // État local des filtres
  let achatsState = { period: 'month', status: '', supplier: '', q: '' };

  window.achatsSetPeriod = function (p) {
    achatsState.period = p;
    if (typeof go === 'function') go('achats');
  };
  window.achatsSetStatus = function (el) {
    achatsState.status = el.value || '';
    if (typeof go === 'function') go('achats');
  };
  window.achatsSetSupplier = function (el) {
    achatsState.supplier = el.value || '';
    if (typeof go === 'function') go('achats');
  };
  window.achatsSetQ = function (el) {
    achatsState.q = (el.value || '').trim().toLowerCase();
    // Filtrage client-side instantané
    const rows = document.querySelectorAll('#achats-table tbody tr');
    rows.forEach(tr => {
      const hay = (tr.getAttribute('data-s') || '').toLowerCase();
      tr.style.display = !achatsState.q || hay.includes(achatsState.q) ? '' : 'none';
    });
  };

  const PERIOD_LABELS = { today: "Aujourd'hui", '7d': '7 derniers jours', month: 'Ce mois', lastmonth: 'Mois dernier', quarter: 'Trimestre en cours', year: 'Année en cours', all: 'Toute la période' };
  const STATUS_LABELS = { '': 'Tous les statuts', commande: 'Commandée / en attente', recue: 'Reçue' };
  const fdFr = d => (d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
  const plain = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  /* Export PDF : reprend exactement la sélection affichée (période, statut, fournisseur, recherche) */
  window.achatsExportPdf = function () {
    const L = achatsState.last;
    if (!L) return toast('Rien à exporter.', 'info');
    const q = achatsState.q;
    const rows = L.rows.filter(r => !q || r.hay.includes(q));
    if (!rows.length) return toast('Aucune commande à exporter pour cette sélection.', 'info');
    if (typeof brandedPdf !== 'function') return toast('Module PDF indisponible.', 'error');
    const total = rows.reduce((a, r) => a + r.total, 0), due = rows.reduce((a, r) => a + r.due, 0);
    const toRec = rows.filter(r => r.pending).length, rec = rows.filter(r => r.received).length;
    const sel = ['Période : ' + L.periodLabel, 'Statut : ' + L.statusLabel, 'Fournisseur : ' + L.supplierLabel].concat(q ? ['Recherche : « ' + q + ' »'] : []);
    brandedPdf({
      title: 'Achats — commandes et réceptions',
      subtitle: sel.join(' · '),
      landscape: true,
      filename: 'Achats_' + (L.from || 'tout') + '_' + (L.to || 'tout'),
      sections: [
        { type: 'kpis', title: 'Synthèse de la sélection', items: [
          { label: 'Commandes', value: rows.length, note: 'sur la période' },
          { label: 'Montant commandé TTC', value: money(total) },
          { label: 'À réceptionner', value: toRec, note: 'commande(s) en attente' },
          { label: 'Reçues', value: rec, note: 'sur la période' }] },
        { type: 'table', title: 'Détail des commandes', head: ['N°', 'Date', 'Fournisseur', 'Dépôt', 'Facture four.', 'Montant TTC', 'Reste dû', 'Statut'],
          rows: rows.map(r => r.cells), totals: ['TOTAL', '', '', '', '', money(total), due > 0 ? money(due) : '—', ''] }
      ].concat(L.agg && window.Agg ? [Agg.itemsPdf(L.agg, 'Agrégats de la sélection (période, statut, fournisseur) — avec sources')] : []),
      signatures: [{ label: 'Établi par' }, { label: 'Responsable achats' }]
    });
  };


  /* Agrégats de la sélection (période, statut, fournisseur) : calculés sur les lignes de GET /purchases affichées ;
     chaque tuile cite sa formule et ses colonnes sources (bouton « Source »). */
  function buildAggItems(list, suppliers) {
    const A = '#f59e0b', B = '#2563eb', G = '#16a34a', R = '#dc2626';
    const n = list.length, st = p => String(p.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const total = p => Number(p.total || p.total_ttc) || 0, inv = p => (p.invoice_total == null ? null : Number(p.invoice_total) || 0), paid = p => Number(p.paid) || 0;
    const day = d => String(d || '').slice(0, 10), todayIso = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);
    const SEL = 'GET /purchases (période, statut et fournisseur sélectionnés)';
    const label = p => p.order_no || p.ref || p.number || p.invoice_no || ('CF-' + String(p.id || '').padStart(4, '0'));
    const invoiced = list.filter(p => inv(p) != null);
    const invAmt = sum(invoiced, inv), paidAmt = sum(invoiced, paid), reste = sum(invoiced, p => Math.max(0, inv(p) - paid(p)));
    const overdue = invoiced.filter(p => p.due_date && day(p.due_date) < todayIso && inv(p) - paid(p) > 0);
    const received = list.filter(p => ['recue', 'recu', 'facture', 'paye'].includes(st(p)));
    const delays = list.filter(p => p.received_at && p.ordered_at).map(p => (new Date(p.received_at) - new Date(p.ordered_at)) / 864e5).filter(x => Number.isFinite(x) && x >= 0);
    const bySup = {}; list.forEach(p => { const k = p.supplier || '—'; bySup[k] = (bySup[k] || 0) + total(p); });
    const top = Object.entries(bySup).sort((a, b) => b[1] - a[1])[0], tot = sum(list, total);
    const big = list.slice().sort((a, b) => total(b) - total(a))[0];
    const items = [
      { label: 'Montant facturé', value: money(invAmt), sub: invoiced.length + ' commande(s) facturée(s)', formula: 'Σ du montant facturé des commandes de la sélection', sources: [SEL, 'purchases.invoice_total'], accent: B },
      { label: 'Montant déjà payé', value: money(paidAmt), sub: invAmt > 0 ? Math.round((paidAmt / invAmt) * 100) + ' % du facturé' : '', formula: 'Σ des règlements enregistrés sur les commandes facturées', sources: [SEL, 'purchases.paid (alimenté par supplier_payments.amount)'], accent: G },
      { label: 'Reste à payer sur factures', value: money(reste), formula: 'Σ max(facturé − payé ; 0)', sources: [SEL, 'purchases.invoice_total', 'purchases.paid'], accent: R },
      { label: 'Factures échues', value: overdue.length + ' · ' + money(sum(overdue, p => inv(p) - paid(p))), sub: 'échéance dépassée, reste dû > 0', formula: 'Commandes facturées avec échéance < aujourd’hui et reste à payer > 0', sources: [SEL, 'purchases.due_date', 'purchases.invoice_total − purchases.paid'], accent: R },
      { label: 'Commande moyenne', value: n ? money(tot / n) : 'n/d', formula: 'Montant commandé ÷ nombre de commandes', sources: [SEL, 'purchases.total'], accent: A },
      { label: 'Plus grosse commande', value: big ? money(total(big)) : 'n/d', sub: big ? label(big) + ' — ' + (big.supplier || '—') : '', formula: 'Maximum de purchases.total sur la sélection', sources: [SEL, 'purchases.total', 'suppliers.name'], accent: A },
      { label: 'Fournisseur principal', value: top ? top[0] : 'n/d', sub: top && tot > 0 ? money(top[1]) + ' · ' + Math.round((top[1] / tot) * 100) + ' % des achats' : '', formula: 'Fournisseur au plus fort montant commandé', sources: [SEL, 'purchases.supplier_id ⨝ suppliers.name', 'purchases.total'], accent: B },
      { label: 'Fournisseurs sollicités', value: String(Object.keys(bySup).length), formula: 'Nombre de fournisseurs distincts', sources: [SEL, 'purchases.supplier_id'], accent: B },
      { label: 'Taux de réception', value: n ? Math.round((received.length / n) * 100) + ' %' : 'n/d', sub: received.length + ' reçue(s) sur ' + n, formula: 'Commandes reçues, facturées ou payées ÷ commandes', sources: [SEL, 'purchases.status'], accent: G },
      { label: 'Délai moyen de réception', value: delays.length ? (Math.round((delays.reduce((a, x) => a + x, 0) / delays.length) * 10) / 10).toLocaleString('fr-FR') + ' j' : 'n/d', sub: delays.length + ' commande(s) reçue(s) datée(s)', formula: 'Moyenne de (date de réception − date de commande)', sources: [SEL, 'purchases.ordered_at', 'purchases.received_at'], accent: G },
      { label: 'Reçues sans facture', value: String(received.filter(p => st(p) !== 'facture' && st(p) !== 'paye' && p.invoice_total == null).length), sub: 'facture fournisseur à saisir', formula: 'Commandes reçues dont le montant facturé est vide', sources: [SEL, 'purchases.status', 'purchases.invoice_total'], accent: A }
    ];
    const withDebt = (suppliers || []).filter(x => x.balance_due !== undefined);
    if (withDebt.length) items.push({ label: 'Dette fournisseurs (à ce jour)', value: money(sum(withDebt, x => Math.max(0, Number(x.balance_due) || 0))), sub: withDebt.filter(x => Number(x.balance_due) > 0).length + ' fournisseur(s) à payer — toutes périodes', formula: 'Somme des soldes fournisseurs positifs', sources: ['GET /suppliers', 'suppliers.balance_due > 0 (deleted_at IS NULL)'], accent: R });
    return items;
  }

  async function vAchats() {
    const [from, to] = periodBounds(achatsState.period);
    const qs = [];
    if (from) qs.push('from=' + encodeURIComponent(from));
    if (to) qs.push('to=' + encodeURIComponent(to));
    if (achatsState.status === 'commande') qs.push('status=commande');
    // statut « reçue » : on charge sans status serveur puis on filtre partiel/recu côté client
    // (API n'accepte qu'un status exact)
    if (achatsState.supplier) qs.push('supplier_id=' + encodeURIComponent(achatsState.supplier));
    qs.push('limit=300');
    const [purchases, suppliers] = await Promise.all([
      G('/purchases' + (qs.length ? '?' + qs.join('&') : '')).catch(() => []),
      G('/suppliers').catch(() => [])
    ]);

    const list = (purchases || []).filter(p => {
      if (p.status === 'annule' || p.status === 'annulee') return false;
      // Sécurité : re-filtre période si le serveur ignore from/to (ancien backend)
      if (!inPeriod(p.ordered_at || p.created_at, from, to)) return false;
      if (achatsState.status === 'commande') {
        const st = String(p.status || '').toLowerCase();
        if (!['commande', 'commandee', 'partiel'].includes(st)) return false;
      }
      if (achatsState.status === 'recue') {
        const st = String(p.status || '').toLowerCase();
        if (!['recue', 'recu', 'partiel', 'facture', 'paye'].includes(st)) return false;
      }
      if (achatsState.supplier && String(p.supplier_id) !== String(achatsState.supplier)) return false;
      return true;
    });

    const supMap = {};
    (suppliers || []).forEach(s => { supMap[s.id] = s; });

    // KPIs
    const nbCommandes = list.length;
    const montantCommande = list.reduce((a, p) => a + (Number(p.total) || Number(p.total_ttc) || 0), 0);
    const aReceptionner = list.filter(p => {
      const st = String(p.status || '').toLowerCase();
      return st === 'commande' || st === 'commandee' || st === 'partiel';
    }).length;
    const recues = list.filter(p => {
      const st = String(p.status || '').toLowerCase();
      return st === 'recue' || st === 'recu';
    }).length;

    const periodBtns = [
      ['today', "Aujourd'hui"], ['7d', '7 jours'], ['month', 'Ce mois'],
      ['lastmonth', 'Mois dernier'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout']
    ].map(([k, lab]) =>
      `<button type="button" class="b2 ${achatsState.period === k ? 'on' : ''}" onclick="achatsSetPeriod('${k}')">${lab}</button>`
    ).join('');

    const statusOpts = [
      ['', 'Tous les statuts'],
      ['commande', 'Commandée / en attente'],
      ['recue', 'Reçue']
    ].map(([v, l]) => `<option value="${v}"${achatsState.status === v ? ' selected' : ''}>${l}</option>`).join('');

    const supOpts = ['<option value="">Tous les fournisseurs</option>']
      .concat((suppliers || []).map(s =>
        `<option value="${s.id}"${String(achatsState.supplier) === String(s.id) ? ' selected' : ''}>${esc(s.name)}</option>`
      )).join('');

    const stationName = (typeof AP !== 'undefined' && AP && AP.station && AP.station.name) || 'Magasin principal';

    const pdfRows = [];
    const rows = list.map(p => {
      const sup = supMap[p.supplier_id] || { name: p.supplier };
      const num = p.order_no || p.ref || p.number || p.invoice_no || ('CF-' + String(p.id || '').padStart(4, '0'));
      const facture = p.invoice_no || p.supplier_invoice || p.invoice_ref || p.facture || '—';
      const reste = (p.invoice_total != null && p.paid != null)
        ? Math.max(0, Number(p.invoice_total) - Number(p.paid))
        : (p.balance_due != null ? p.balance_due : (p.reste_du != null ? p.reste_du : null));
      const hay = [num, sup.name, facture, p.status].join(' ').toLowerCase();
      const st = String(p.status || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const totalP = Number(p.total || p.total_ttc) || 0, dueP = reste != null && Number(reste) > 0 ? Number(reste) : 0;
      pdfRows.push({ hay, total: totalP, due: dueP, pending: ['commande', 'commandee', 'partiel'].includes(st), received: ['recue', 'recu'].includes(st),
        cells: [plain(num), fmtDate(p.ordered_at || p.created_at), plain(sup.name || '—'), plain(stationName), plain(facture), money(totalP), dueP ? money(dueP) : '—', (STATUS_MAP[st] || { label: p.status || '—' }).label] });
      return `<tr data-s="${esc(hay)}" onclick="typeof showPO==='function'&&showPO(${Number(p.id)})" style="cursor:pointer">
        <td><b>${esc(num)}</b></td>
        <td>${fmtDate(p.ordered_at || p.created_at)}</td>
        <td>${esc(sup.name || '—')}</td>
        <td>${esc(stationName)}</td>
        <td>${esc(facture)}</td>
        <td class="pc-num">${money(p.total || p.total_ttc)}</td>
        <td class="pc-num">${reste != null && Number(reste) > 0 ? money(reste) : '—'}</td>
        <td>${statusTag(p.status)}</td>
      </tr>`;
    }).join('');

    const supSel = (suppliers || []).find(x => String(x.id) === String(achatsState.supplier));
    achatsState.last = { rows: pdfRows, from, to, periodLabel: PERIOD_LABELS[achatsState.period] + (from ? ' (' + fdFr(from) + ' → ' + fdFr(to) + ')' : ''),
      statusLabel: STATUS_LABELS[achatsState.status] || 'Tous les statuts', supplierLabel: supSel ? supSel.name : 'Tous les fournisseurs' };

    const aggItems = buildAggItems(list, suppliers);
    achatsState.last.agg = aggItems;

    const empty = list.length === 0
      ? '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--m)">Aucune commande sur cette période</td></tr>'
      : '';

    return `
      <div class="pc-head" style="margin-bottom:8px">
        <div>
          <h2 class="pc-title" style="margin:0">Achats</h2>
          <div class="pc-subtitle">Commandes fournisseurs, réceptions de marchandises et factures d'achat</div>
        </div>
        <div class="pc-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          ${can('purchase.manage') ? `<button onclick="typeof poNew==='function'?poNew():(typeof addPO==='function'&&addPO())">+ Nouvelle commande</button>` : ''}
          <button class="b2" onclick="achatsExportPdf()" title="Exporter en PDF la sélection affichée">📄 Exporter PDF</button>
          <button class="b2" onclick="go('four')">Fournisseurs</button>
        </div>
      </div>

      <div class="subtabs" style="margin-bottom:14px">
        <a class="on" href="javascript:void(0)">Commandes & réceptions <span class="tag" style="margin-left:6px">${nbCommandes}</span></a>
        <a href="javascript:void(0)" onclick="go('four')" style="opacity:.75">Historique et comparaison des prix</a>
      </div>

      <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">
        ${periodBtns}
      </div>

      <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <input class="q" type="search" placeholder="N°, facture, fournisseur…" value="${esc(achatsState.q)}" oninput="achatsSetQ(this)" style="min-width:200px">
        <select onchange="achatsSetStatus(this)" style="min-width:160px">${statusOpts}</select>
        <select onchange="achatsSetSupplier(this)" style="min-width:180px">${supOpts}</select>
      </div>

      <div class="dv2-kpis" style="margin-bottom:20px">
        <div class="dv2-kpi" style="border-left:4px solid #64748b">
          <div>
            <small>COMMANDES</small>
            <span class="val">${nbCommandes}</span>
            <small style="display:block;margin-top:2px">sur la période</small>
          </div>
        </div>
        <div class="dv2-kpi" style="background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;border:none">
          <div>
            <small style="color:rgba(255,255,255,.85)">MONTANT COMMANDÉ</small>
            <span class="val" style="color:#fff">${money(montantCommande)}</span>
            <small style="color:rgba(255,255,255,.75)">TTC</small>
          </div>
        </div>
        <div class="dv2-kpi" style="background:linear-gradient(135deg,#c2410c,#ea580c);color:#fff;border:none">
          <div>
            <small style="color:rgba(255,255,255,.85)">À RÉCEPTIONNER</small>
            <span class="val" style="color:#fff">${aReceptionner}</span>
            <small style="color:rgba(255,255,255,.75)">commande(s) en attente</small>
          </div>
        </div>
        <div class="dv2-kpi" style="background:linear-gradient(135deg,#15803d,#16a34a);color:#fff;border:none">
          <div>
            <small style="color:rgba(255,255,255,.85)">REÇUES</small>
            <span class="val" style="color:#fff">${recues}</span>
            <small style="color:rgba(255,255,255,.75)">sur la période</small>
          </div>
        </div>
      </div>

      ${window.Agg ? `<div class="agg-wrap" style="margin:0 0 18px"><h3>Agrégats de la sélection</h3><p class="agg-sub">Calculés sur les commandes affichées (période, statut et fournisseur choisis, hors recherche texte). Bouton « Source » : formule et colonnes d'origine.</p>${Agg.tiles(aggItems)}</div>` : ''}

      <div class="pc-tw" style="overflow:auto">
        <table class="pc-tbl" id="achats-table">
          <thead>
            <tr>
              <th>N°</th>
              <th>DATE</th>
              <th>FOURNISSEUR</th>
              <th>DÉPÔT</th>
              <th>FACTURE FOUR.</th>
              <th class="pc-num">MONTANT TTC</th>
              <th class="pc-num">RESTE DÛ</th>
              <th>STATUT</th>
            </tr>
          </thead>
          <tbody>${rows || empty}</tbody>
        </table>
      </div>
    `;
  }

  // Enregistrement page + navigation
  if (typeof VM !== 'undefined') {
    VM.achats = vAchats;
  }
  if (typeof V !== 'undefined') {
    V.achats = ['Achats', 'supplier.view|purchase.manage|purchase.pay|stock.adjust'];
  }
  if (typeof NAV_ICONS !== 'undefined') {
    NAV_ICONS.achats = '🛒';
  }

  // Remplacer l'ancien "four" par un accès rapide vers Achats si souhaité
  // On laisse "four" pour la fiche fournisseurs (ext-parties.js)
})();
