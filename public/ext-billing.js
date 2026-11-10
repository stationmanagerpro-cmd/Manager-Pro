/* Module Facturation clients */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  V.factures = ['Facturation', 'sale.create|finance.view|report.view|customer.view|customer.edit'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.factures = '🧾';

  function money(n) {
    try { return typeof f === 'function' ? f(n) : Number(n || 0).toLocaleString('fr-FR'); } catch (e) { return String(n); }
  }

  var BST = { brouillon: 'Brouillon', emise: 'Émise', partielle: 'Partiellement payée', payee: 'Payée', annulee: 'Annulée' };
  var BPAY = { non_regle: 'Non réglée', partiel: 'Partiellement réglée', solde: 'Soldée' };
  var BF = { q: '', customer_id: '', status: '', payment: '', from: '', to: '' };
  var dFr = function (v) { var d = v ? String(v).slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '—'; };

  function billQs() {
    var p = Object.keys(BF).filter(function (k) { return BF[k]; }).map(function (k) { return k + '=' + encodeURIComponent(BF[k]); });
    p.push('limit=1000');
    return '?' + p.join('&');
  }

  async function vFactures() {
    if (ME && ME.is_global) {
      return '<p class="warn">La facturation station est réservée aux comptes clients. La facturation plateforme reste dans Finance plateforme.</p>';
    }
    var res = await Promise.all([
      G('/invoices' + billQs()).catch(function (e) { return { error: e.message || String(e) }; }),
      G('/customers').catch(function () { return []; })
    ]);
    var list = res[0], custs = res[1];
    if (list && list.error) {
      return '<p class="warn">' + esc(list.error) + '</p>';
    }
    window._billLast = list || [];
    var rows = (list || []).map(function (x) {
      var rest = Number(x.total_ttc) - Number(x.amount_paid);
      return [
        esc(x.invoice_no),
        (x.customer_id && typeof window.showCli === 'function' ? '<a href="javascript:void(0)" onclick="showCli(' + Number(x.customer_id) + ')" title="Ouvrir la fiche client">' + esc(x.customer_name || '—') + '</a>' : esc(x.customer_name || '—')),
        '<span class="tag">' + esc(BST[x.status] || x.status) + '</span>',
        dFr(x.issued_on),
        money(x.total_ttc),
        money(x.amount_paid),
        money(rest),
        '<button class="b2" onclick="billShow(' + x.id + ')">Ouvrir</button>'
      ];
    });
    var opt = function (o, sel) { return Object.keys(o).map(function (k) { return '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + o[k] + '</option>'; }).join(''); };

    return '<h2 style="margin-top:0">Facturation clients</h2>' +
      '<p class="muted">Créez des factures, émettez-les, enregistrez les paiements et téléchargez le PDF. Module inclus (gratuit), isolé par station.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px;align-items:flex-end">' +
      '<button onclick="billNew()">Nouvelle facture</button>' +
      '<label>Recherche<input id="bf_q" placeholder="N° ou client" value="' + esc(BF.q) + '"></label>' +
      '<label>Client<select id="bf_c"><option value="">Tous</option>' + (custs || []).map(function (c) { return '<option value="' + Number(c.id) + '"' + (String(BF.customer_id) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Statut<select id="bf_s"><option value="">Tous</option>' + opt(BST, BF.status) + '</select></label>' +
      '<label>Règlement<select id="bf_p"><option value="">Tous</option>' + opt(BPAY, BF.payment) + '</select></label>' +
      '<label>Du<input type="date" id="bf_f" value="' + esc(BF.from) + '"></label><label>Au<input type="date" id="bf_t" value="' + esc(BF.to) + '"></label>' +
      '<button class="b2" onclick="billFilter()">Filtrer</button><button class="b2" onclick="billFilter(1)">Réinitialiser</button>' +
      '<button class="b2" onclick="billExportPdf()" title="Exporter en PDF la liste filtrée">📄 Exporter en PDF</button>' +
      '<button class="b2" onclick="go(\'factures\')">Actualiser</button>' +
      '<button class="b2" onclick="go(\'cli\')">Clients</button>' +
      '</div>' +
      (rows.length
        ? T(['N°', 'Client', 'Statut', 'Émise le', 'TTC', 'Payé', 'Reste', ''], rows)
        : (typeof emptyState === 'function'
          ? emptyState({ icon: '🧾', title: 'Aucune facture', desc: 'Aucune facture ne correspond aux filtres, ou créez-en une / générez-en une depuis une vente.' })
          : '<p class="muted">Aucune facture.</p>'));
  }

  window.billFilter = function (reset) {
    var v = function (id) { return (document.getElementById(id) || {}).value || ''; };
    if (reset) BF = { q: '', customer_id: '', status: '', payment: '', from: '', to: '' };
    else {
      if (v('bf_f') && v('bf_t') && v('bf_f') > v('bf_t')) { toast('La date de début doit précéder la date de fin', 'error'); return; }
      BF = { q: v('bf_q').trim(), customer_id: v('bf_c'), status: v('bf_s'), payment: v('bf_p'), from: v('bf_f'), to: v('bf_t') };
    }
    go('factures');
  };

  window.billExportPdf = async function () {
    var list = window._billLast || [];
    if (!list.length) { toast('Aucune facture à exporter', 'info'); return; }
    if (typeof window.brandedPdf !== 'function') { toast('Moteur PDF indisponible', 'error'); return; }
    var sel = function (id) { var e = document.getElementById(id); return e && e.value ? e.options[e.selectedIndex].text : ''; };
    var filters = [];
    if (BF.q) filters.push(['Recherche', BF.q]);
    if (BF.customer_id) filters.push(['Client', sel('bf_c')]);
    if (BF.status) filters.push(['Statut', BST[BF.status] || BF.status]);
    if (BF.payment) filters.push(['Règlement', BPAY[BF.payment] || BF.payment]);
    var tt = 0, tp = 0;
    var rows = list.map(function (x) { var t = Number(x.total_ttc) || 0, p = Number(x.amount_paid) || 0; tt += t; tp += p; return [x.invoice_no, x.customer_name || '—', BST[x.status] || x.status, dFr(x.issued_on), t, p, t - p]; });
    var period = BF.from || BF.to ? 'du ' + (BF.from ? dFr(BF.from) : '…') + ' au ' + (BF.to ? dFr(BF.to) : '…') : '';
    var sections = [];
    if (filters.length) sections.push({ type: 'kv', title: 'Filtres appliqués', rows: filters });
    sections.push({ type: 'kpis', items: [{ label: 'Factures', value: String(list.length) }, { label: 'Total TTC', value: money(tt) }, { label: 'Encaissé', value: money(tp) }, { label: 'Reste à encaisser', value: money(tt - tp) }] });
    sections.push({ type: 'table', title: 'Factures clients', head: ['N°', 'Client', 'Statut', 'Émise le', 'TTC', 'Payé', 'Reste'], rows: rows, totals: ['Total', '', '', '', tt, tp, tt - tp] });
    var d = new Date(), p2 = function (n) { return String(n).padStart(2, '0'); }, stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    await window.brandedPdf({ title: 'Facturation clients', period: period || undefined, ref: 'FAC-' + stamp.replace(/-/g, ''), landscape: true, sections: sections, filename: 'Facturation_clients_' + stamp });
  };


  /** Facture multi-lignes — éditeur dynamique (ajouter / supprimer / total). */
  window.billNew = async function (presetCustomerId) {
    var customers = await G('/customers').catch(function () { return []; });
    var products = await G('/products').catch(function () { return []; });
    var custOpts = '<option value="">— Sans client —</option>' + (customers || []).map(function (c) {
      return '<option value="' + Number(c.id) + '"' + (presetCustomerId && Number(c.id) === Number(presetCustomerId) ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    var prodOpts = '<option value="">— Libre —</option>' + (products || []).map(function (p) {
      return '<option value="' + Number(p.id) + '" data-price="' + (p.sell_price != null ? p.sell_price : '') + '">' +
        esc(p.name) + (p.sell_price != null ? ' · ' + p.sell_price : '') + '</option>';
    }).join('');
    function lineRow(i) {
      return '<tr data-i="' + i + '">' +
        '<td><select class="bl-prod">' + prodOpts + '</select></td>' +
        '<td><input class="bl-desc" placeholder="Désignation" style="min-width:120px"></td>' +
        '<td><input class="bl-qty" type="number" min="0.001" step="0.001" value="1" style="width:80px"></td>' +
        '<td><input class="bl-price" type="number" min="0" step="0.01" value="0" style="width:100px"></td>' +
        '<td class="bl-amt">0</td>' +
        '<td><button type="button" class="b2 bl-del">×</button></td></tr>';
    }
    modal('<h3 style="margin-top:0">Nouvelle facture (multi-lignes)</h3>' +
      '<div class="g"><label>Client<select id="bl_cust"' + (presetCustomerId ? ' disabled' : '') + '>' + custOpts + '</select></label>' +
      '<label>Échéance<input type="date" id="bl_due"></label>' +
      '<label>Taxe %<input type="number" id="bl_tax" value="0" step="0.01"></label>' +
      '<label>Notes<input id="bl_notes"></label></div>' +
      '<div class="tw" style="margin-top:10px;max-height:40vh;overflow:auto"><table id="bl_table"><thead><tr>' +
      '<th>Produit</th><th>Désignation</th><th>Qté</th><th>P.U.</th><th>Montant</th><th></th></tr></thead>' +
      '<tbody>' + lineRow(0) + '</tbody></table></div>' +
      '<p style="margin-top:8px"><button type="button" class="b2" id="bl_add">+ Ajouter une ligne</button> ' +
      '<b>Total HT : <span id="bl_total">0</span></b> · TTC : <span id="bl_ttc">0</span></p>' +
      '<div class="r"><button class="b2" onclick="closeM()">Annuler</button>' +
      '<button id="bl_ok">Créer le brouillon</button></div>');

    function recalc() {
      var total = 0;
      document.querySelectorAll('#bl_table tbody tr').forEach(function (tr) {
        var q = parseFloat(tr.querySelector('.bl-qty').value) || 0;
        var p = parseFloat(tr.querySelector('.bl-price').value) || 0;
        var amt = q * p;
        tr.querySelector('.bl-amt').textContent = (typeof money === 'function' ? money(amt) : amt.toFixed(2));
        total += amt;
      });
      var tax = parseFloat(document.getElementById('bl_tax').value) || 0;
      var ttc = total * (1 + tax / 100);
      document.getElementById('bl_total').textContent = typeof money === 'function' ? money(total) : total.toFixed(2);
      document.getElementById('bl_ttc').textContent = typeof money === 'function' ? money(ttc) : ttc.toFixed(2);
    }
    function bindRow(tr) {
      tr.querySelector('.bl-prod').onchange = function () {
        var opt = this.options[this.selectedIndex];
        var price = opt.getAttribute('data-price');
        if (price) tr.querySelector('.bl-price').value = price;
        if (!tr.querySelector('.bl-desc').value && opt.value) {
          tr.querySelector('.bl-desc').value = opt.textContent.split(' · ')[0];
        }
        recalc();
      };
      tr.querySelector('.bl-qty').oninput = recalc;
      tr.querySelector('.bl-price').oninput = recalc;
      tr.querySelector('.bl-del').onclick = function () {
        var tb = document.querySelector('#bl_table tbody');
        if (tb.rows.length <= 1) { toast('Au moins une ligne requise', 'error'); return; }
        tr.remove();
        recalc();
      };
    }
    document.querySelectorAll('#bl_table tbody tr').forEach(bindRow);
    document.getElementById('bl_tax').oninput = recalc;
    document.getElementById('bl_add').onclick = function () {
      var tb = document.querySelector('#bl_table tbody');
      if (tb.rows.length >= 20) { toast('Maximum 20 lignes', 'error'); return; }
      tb.insertAdjacentHTML('beforeend', lineRow(tb.rows.length));
      bindRow(tb.rows[tb.rows.length - 1]);
    };
    document.getElementById('bl_ok').onclick = async function () {
      var lines = [];
      document.querySelectorAll('#bl_table tbody tr').forEach(function (tr) {
        var desc = (tr.querySelector('.bl-desc').value || '').trim();
        var pid = tr.querySelector('.bl-prod').value ? Number(tr.querySelector('.bl-prod').value) : null;
        var qty = parseFloat(tr.querySelector('.bl-qty').value) || 0;
        var up = parseFloat(tr.querySelector('.bl-price').value) || 0;
        if (!desc && pid) {
          var opt = tr.querySelector('.bl-prod').options[tr.querySelector('.bl-prod').selectedIndex];
          desc = opt.textContent.split(' · ')[0];
        }
        if (!desc || qty <= 0) return;
        var line = { description: desc, quantity: qty, unit_price: up };
        if (pid) line.product_id = pid;
        lines.push(line);
      });
      if (!lines.length) { toast('Ajoutez au moins une ligne valide', 'error'); return; }
      var cust = document.getElementById('bl_cust').value;
      try {
        var inv = await Po('/invoices', {
          customer_id: cust ? Number(cust) : null,
          due_date: document.getElementById('bl_due').value || null,
          tax_rate: parseFloat(document.getElementById('bl_tax').value) || 0,
          notes: document.getElementById('bl_notes').value || undefined,
          lines: lines
        });
        closeM();
        toast('Brouillon ' + inv.invoice_no + ' créé (' + lines.length + ' ligne(s))', 'success');
        billShow(inv.id);
      } catch (e) {
        toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
      }
    };
    recalc();
  };


  window.billShow = async function (id) {
    var inv = await G('/invoices/' + id);
    var rest = Number(inv.total_ttc) - Number(inv.amount_paid);
    var lines = T(['Désignation', 'Qté', 'P.U.', 'Montant'], (inv.lines || []).map(function (l) {
      return [esc(l.description), l.quantity, money(l.unit_price), money(l.amount)];
    }));
    var pays = (inv.payments || []).length
      ? T(['Date', 'Mode', 'Montant', 'Réf.'], inv.payments.map(function (p) {
          return [typeof dt === 'function' ? dt(p.paid_at) : p.paid_at, esc(p.method), money(p.amount), esc(p.reference || '')];
        }))
      : '<p class="muted">Aucun paiement.</p>';
    var actions = '<button class="b2" onclick="closeM()">Fermer</button>';
    if (inv.status === 'brouillon') {
      actions += '<button onclick="billIssue(' + inv.id + ')">Émettre</button>';
      actions += '<button class="bd" onclick="billCancel(' + inv.id + ')">Annuler</button>';
    }
    if (inv.status === 'emise' || inv.status === 'partielle') {
      actions += '<button onclick="billPay(' + inv.id + ',' + rest + ')">Enregistrer un paiement</button>';
      actions += '<button class="bd" onclick="billCancel(' + inv.id + ')">Annuler</button>';
    }
    actions += '<button class="b2" onclick="billPdf(' + inv.id + ',\'' + esc(inv.invoice_no) + '\')">PDF</button>';

    modal('<h3 style="margin-top:0">Facture ' + esc(inv.invoice_no) + ' · <span class="tag">' + esc(inv.status) + '</span></h3>' +
      '<p>' + (inv.customer_name ? 'Client : <b>' + (inv.customer_id && typeof window.showCli === 'function' ? '<a href="javascript:void(0)" onclick="showCli(' + Number(inv.customer_id) + ')">' + esc(inv.customer_name) + '</a>' : esc(inv.customer_name)) + '</b><br>' : '') +
      'TTC : <b>' + money(inv.total_ttc) + '</b> · Payé : ' + money(inv.amount_paid) + ' · Reste : <b>' + money(rest) + '</b>' +
      (inv.due_date ? '<br>Échéance : ' + esc(inv.due_date) : '') +
      (inv.sale_id ? '<br>Liée à la vente #' + inv.sale_id : '') +
      (inv.attribution === 'quart' ? '<br>Quart n° ' + esc(inv.shift_number) + (inv.employee_name ? ' · employé : <b>' + esc(inv.employee_name) + '</b>' : '') : '') +
      (inv.attribution === 'commanditaire' ? '<br>Hors quart · commanditaire : <b>' + esc(inv.ordered_by_login || '—') + '</b>' : '') +
      (inv.pump_name ? '<br>Pompe : <b>' + esc(inv.pump_name) + '</b>' : '') +
      '</p>' +
      '<h4>Lignes</h4>' + lines +
      '<h4>Paiements</h4>' + pays +
      '<div class="r" style="margin-top:12px;flex-wrap:wrap;gap:8px">' + actions + '</div>');
  };

  /** Validation d'une facture : contexte quart / pompe, confirmation « hors quart », pompe obligatoire pour le carburant. */
  window.billIssue = async function (id) {
    try {
      var cx = await G('/invoices/' + id + '/issue-context');
      if (!cx.customer_id) { toast('Choisissez un client avant de valider la facture (elle constitue une créance suivie sur sa fiche).', 'error'); return; }
      var emps = (!cx.has_employee && cx.shift_open) ? await G('/employees').catch(function () { return []; }) : [];
      var info = cx.shift_open
        ? '<p class="tag ok" style="display:block;padding:8px">Quart n° ' + esc(cx.shift.number) + ' ouvert : la facture sera rattachée à ce quart, comptée dans le chiffre d’affaires, et le stock des produits sera diminué.</p>'
        : '<p class="tag" style="display:block;padding:8px;background:#fff7e6;color:#8a5a00">ℹ️ Information : aucun quart n’est ouvert. La facture ne sera liée ni à un employé ni à un quart. Si vous continuez, elle vous sera attribuée comme commanditaire et mentionnée comme telle. Le stock des produits sera diminué dès la validation.</p>';
      var pump = '';
      if (cx.needs_pump) {
        if (!cx.pumps.length) { toast('Aucune pompe active ne distribue le carburant de cette facture.', 'error'); return; }
        pump = '<h4 style="margin-bottom:4px">Cette vente a-t-elle été servie avec une pompe ?</h4>' +
          '<p class="muted" style="margin-top:0">Choisissez la pompe (obligatoire). ' + (cx.shift_open ? 'L’index de son compteur avancera du nombre de litres facturés.' : 'Aucun quart n’étant ouvert, l’index n’est pas modifié : seul le stock de la cuve est diminué.') + '</p>' +
          '<label>Pompe<select id="bi_pump"><option value="">— Choisir la pompe —</option>' +
          cx.pumps.map(function (p) { return '<option value="' + Number(p.id) + '">' + esc(p.name) + ' · ' + esc((p.products || []).join(', ')) + '</option>'; }).join('') + '</select></label>';
      }
      var emp = emps.length
        ? '<label>Employé responsable<select id="bi_emp"><option value="">— Choisir —</option>' + emps.map(function (e) { return '<option value="' + Number(e.id) + '">' + esc([e.first_name, e.last_name].filter(Boolean).join(' ')) + '</option>'; }).join('') + '</select></label>'
        : '';
      modal('<h3 style="margin-top:0">Valider la facture</h3>' + info + pump + emp +
        '<div class="r" style="margin-top:12px"><button class="b2" onclick="closeM()">Annuler</button>' +
        '<button id="bi_ok">' + (cx.shift_open ? 'Valider la facture' : 'Continuer et valider') + '</button></div>');
      document.getElementById('bi_ok').onclick = async function () {
        var body = {};
        if (cx.needs_pump) {
          var pv = document.getElementById('bi_pump').value;
          if (!pv) { toast('Sélectionnez la pompe : c’est obligatoire pour valider une facture de carburant.', 'error'); return; }
          body.pump_id = Number(pv);
        }
        var ev = document.getElementById('bi_emp');
        if (ev) { if (!ev.value) { toast('Choisissez l’employé responsable.', 'error'); return; } body.employee_id = Number(ev.value); }
        if (!cx.shift_open) body.no_shift_ack = true;
        this.disabled = true;
        try {
          await Po('/invoices/' + id + '/issue', body);
          toast('Facture validée', 'success');
          closeM();
          if (typeof go === 'function') go('factures');
          billShow(id);
        } catch (e) { this.disabled = false; toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
      };
    } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };

  window.billPay = async function (id, rest) {
    await refreshPmAccounts();
    const opts = pmAccOpts(['credit']);
    if (!opts.length) { toast('Aucun compte actif disponible : rattachez un moyen de paiement à un compte (Finance).', 'error'); return; }
    form('Paiement facture', [
      ['amount', 'Montant', 'number'],
      ['method', 'Compte / mode de règlement', 's', opts],
      ['reference', 'Référence']
    ], { amount: rest, method: opts[0][0] }, async function (d) {
      await Po('/invoices/' + id + '/pay', {
        amount: parseFloat(d.amount),
        method: d.method || 'especes',
        reference: d.reference || undefined
      });
      closeM();
      toast('Paiement enregistré', 'success');
      billShow(id);
      go('factures');
    });
  };

  window.billCancel = async function (id) {
    var reason = prompt('Motif d’annulation (obligatoire) :');
    if (!reason || reason.trim().length < 3) return;
    try {
      await Po('/invoices/' + id + '/cancel', { reason: reason.trim() });
      toast('Facture annulée', 'success');
      closeM();
      go('factures');
    } catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };

  window.billPdf = async function (id, no) {
    try {
      var r = await fetch('/api/invoices/' + id + '/pdf', {
        headers: Object.assign(
          { Accept: 'application/pdf' },
          typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {},
          typeof SID !== 'undefined' && SID ? { 'X-Station-Id': String(SID) } : {}
        )
      });
      if (!r.ok) {
        var j = await r.json().catch(function () { return null; });
        throw new Error((j && j.error) || ('Erreur ' + r.status));
      }
      var blob = await r.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (no || ('facture-' + id)) + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2500);
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  window.billFromSale = async function (saleId) {
    try {
      var inv = await Po('/invoices/from-sale/' + saleId, {});
      toast('Facture ' + inv.invoice_no + ' créée', 'success');
      billShow(inv.id);
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  // Hook ventes list: add button if possible by patching after load — optional note in UI
  Object.assign(VM, { factures: vFactures });
})();
