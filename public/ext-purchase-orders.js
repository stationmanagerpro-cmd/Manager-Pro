/* Exploitation › Bon de commande — création, suivi, réceptions partielles, règlement obligatoire à la réception. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;
  V.bcommande = ['Bon de commande', 'purchase.manage|purchase.pay|finance.view|stock.adjust'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.bcommande = '📦';

  const m = n => (typeof f === 'function' ? f(n) : Number(n || 0).toLocaleString('fr-FR'));
  const q = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
  const canManage = () => typeof can !== 'function' || can('purchase.manage');
  const canPay = () => typeof can !== 'function' || can('purchase.pay');
  const dt = s => s ? String(s).slice(0, 10) : '—';
  const ref = p => p + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const STATUS = { brouillon: 'Brouillon', valide: 'Validé', partiel: 'Partiellement réceptionné', recu: 'Réceptionné', annule: 'Annulé' };
  const PAY = { aucun: '—', non_regle: 'Non réglé', partiel: 'Partiellement réglé', a_jour: 'Réglé à date', solde: 'Soldé' };
  const tag = (t, cls) => '<span class="tag"' + (cls ? ' style="' + cls + '"' : '') + '>' + esc(t) + '</span>';
  const F = { q: '', status: '', pay: '', supplier_id: '', from: '', to: '' };

  function qs() {
    const p = Object.keys(F).filter(k => F[k]).map(k => k + '=' + encodeURIComponent(F[k]));
    return p.length ? '?' + p.join('&') : '';
  }

  async function vBonCommande() {
    const [list, sups] = await Promise.all([G('/purchase-orders' + qs()).catch(e => ({ error: e.message })), G('/suppliers').catch(() => [])]);
    if (list && list.error) return '<p class="warn">' + esc(list.error) + '</p>';
    window._bcLast = list;
    const rows = list.map(x => [
      '<b>' + esc(x.order_no) + '</b>', esc(x.supplier), dt(x.ordered_at),
      tag(STATUS[x.reception_status] || x.status), tag(PAY[x.payment_status]),
      q(x.qty_received) + ' / ' + q(x.qty_ordered), m(x.total), m(x.paid), m(x.remaining_to_pay),
      '<button class="b2" onclick="bcShow(' + x.id + ')">Ouvrir</button>']);
    const opt = (o, sel) => Object.keys(o).filter(k => k !== 'aucun').map(k => '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + o[k] + '</option>').join('');
    return '<h2 style="margin-top:0">Bon de commande</h2>' +
      '<p class="muted">Commandes fournisseurs avec réceptions partielles ou successives. Le stock n’augmente qu’à la réception, et chaque réception impose un mode de règlement (différé ou immédiat).</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px;align-items:flex-end">' +
      (canManage() ? '<button onclick="bcEdit()">Nouveau bon de commande</button>' : '') +
      '<label>Recherche<input id="bcf_q" placeholder="N° ou fournisseur" value="' + esc(F.q) + '"></label>' +
      '<label>Fournisseur<select id="bcf_s"><option value="">Tous</option>' + (sups || []).map(s => '<option value="' + s.id + '"' + (String(F.supplier_id) === String(s.id) ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>' +
      '<label>Statut<select id="bcf_st"><option value="">Tous</option>' + opt(STATUS, F.status) + '</select></label>' +
      '<label>Règlement<select id="bcf_p"><option value="">Tous</option>' + opt(PAY, F.pay) + '</select></label>' +
      '<label>Du<input type="date" id="bcf_f" value="' + esc(F.from) + '"></label><label>Au<input type="date" id="bcf_t" value="' + esc(F.to) + '"></label>' +
      '<button class="b2" onclick="bcFilter()">Filtrer</button><button class="b2" onclick="bcFilter(1)">Réinitialiser</button>' +
      '<button class="b2" onclick="bcExportPdf()" title="Exporter en PDF la liste filtrée">📄 Exporter en PDF</button></div>' +
      T(['N°', 'Fournisseur', 'Date', 'Réception', 'Règlement', 'Reçu / commandé', 'Engagé', 'Payé', 'Reste à payer', ''], rows);
  }
  VM.bcommande = vBonCommande;

  const hdrs = () => Object.assign({ 'Content-Type': 'application/json' }, typeof TK !== 'undefined' && TK ? { Authorization: 'Bearer ' + TK } : {}, typeof SID !== 'undefined' && SID ? { 'X-Station-Id': String(SID) } : {});
  const b64 = blob => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });
  /** Photo → JPEG réduite (1600 px max) pour rester < 1,5 Mo ; les PDF sont envoyés tels quels. */
  async function prepFile(file) {
    if (!file) return null;
    if (file.type === 'application/pdf') { if (file.size > 1.5 * 1024 * 1024) throw new Error('PDF trop volumineux (1,5 Mo maximum).'); return { filename: file.name, mime: file.type, data: await b64(file) }; }
    if (!/^image\//.test(file.type)) throw new Error('Formats acceptés : photo ou PDF.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Image illisible')); i.src = url; });
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.72));
      if (blob.size > 1.4 * 1024 * 1024) blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.5));
      return { filename: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: await b64(blob) };
    } finally { URL.revokeObjectURL(url); }
  }
  async function uploadAttachment(poId, file, receiptId) {
    const f0 = await prepFile(file); if (!f0) return null;
    return Po('/purchase-orders/' + poId + '/attachments', Object.assign(f0, receiptId ? { receipt_id: receiptId } : {}));
  }
  window.bcAttach = function (id) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*,application/pdf';
    inp.onchange = async () => { try { await uploadAttachment(id, inp.files[0]); toast('Pièce jointe ajoutée'); bcShow(id); } catch (e) { toast(e.message, 'error'); } };
    inp.click();
  };
  window.bcViewAtt = async function (id, aid) {
    try {
      const r = await fetch('/api/purchase-orders/' + id + '/attachments/' + aid, { headers: hdrs() });
      if (!r.ok) throw new Error('Pièce introuvable');
      const u = URL.createObjectURL(await r.blob()); if (!window.open(u, '_blank')) location.href = u; setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) { toast(e.message, 'error'); }
  };

  /** Scan code-barres (application Android) : retrouve le produit par son code-barres. */
  let _prodByCode = null;
  async function productByCode(code) {
    if (!_prodByCode) { _prodByCode = new Map(); try { (await G('/products')).forEach(p => { if (p.barcode) _prodByCode.set(String(p.barcode).trim(), p); }); } catch (_) { /* sans catalogue */ } }
    return _prodByCode.get(String(code).trim());
  }
  const hasScanner = () => !!(window.AndroidBridge && AndroidBridge.scan);

  window.bcFilter = function (reset) {
    const v = id => (document.getElementById(id) || {}).value || '';
    Object.assign(F, reset ? { q: '', status: '', pay: '', supplier_id: '', from: '', to: '' }
      : { q: v('bcf_q').trim(), supplier_id: v('bcf_s'), status: v('bcf_st'), pay: v('bcf_p'), from: v('bcf_f'), to: v('bcf_t') });
    go('bcommande');
  };

  window.bcExportPdf = async function () {
    const list = window._bcLast || [];
    if (!list.length) return toast('Aucun bon de commande à exporter', 'info');
    if (typeof window.brandedPdf !== 'function') return toast('Moteur PDF indisponible', 'error');
    const sel = id => { const e = document.getElementById(id); return e && e.value ? e.options[e.selectedIndex].text : ''; };
    const dFr = v => { const d = v ? String(v).slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : '—'; };
    const filters = [];
    if (F.q) filters.push(['Recherche', F.q]);
    if (F.supplier_id) filters.push(['Fournisseur', sel('bcf_s')]);
    if (F.status) filters.push(['Statut', STATUS[F.status] || F.status]);
    if (F.pay) filters.push(['Règlement', PAY[F.pay] || F.pay]);
    let tt = 0, tp = 0, tr = 0;
    const rows = list.map(x => { const t = Number(x.total) || 0, p = Number(x.paid) || 0, r = Number(x.remaining_to_pay) || 0; tt += t; tp += p; tr += r;
      return [x.order_no, x.supplier || '—', dFr(x.ordered_at), STATUS[x.reception_status] || x.status || '—', PAY[x.payment_status] || '—', q(x.qty_received) + ' / ' + q(x.qty_ordered), t, p, r]; });
    const period = F.from || F.to ? 'du ' + (F.from ? dFr(F.from) : '…') + ' au ' + (F.to ? dFr(F.to) : '…') : '';
    const sections = [];
    if (filters.length) sections.push({ type: 'kv', title: 'Filtres appliqués', rows: filters });
    sections.push({ type: 'kpis', items: [{ label: 'Bons de commande', value: String(list.length) }, { label: 'Engagé', value: m(tt) }, { label: 'Payé', value: m(tp) }, { label: 'Reste à payer', value: m(tr) }] });
    sections.push({ type: 'table', title: 'Bons de commande fournisseurs', head: ['N°', 'Fournisseur', 'Date', 'Réception', 'Règlement', 'Reçu / commandé', 'Engagé', 'Payé', 'Reste à payer'], rows, totals: ['Total', '', '', '', '', '', tt, tp, tr] });
    const d = new Date(), p2 = n => String(n).padStart(2, '0'), stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
    await window.brandedPdf({ title: 'Bons de commande', period: period || undefined, ref: 'BC-' + stamp.replace(/-/g, ''), landscape: true, sections, filename: 'Bons_de_commande_' + stamp });
  };

  // ---------- Création / modification ----------
  window.bcEdit = async function (id) {
    const [sups, prods, po] = await Promise.all([G('/suppliers'), G('/products'), id ? G('/purchase-orders/' + id) : null]);
    const popt = '<option value="">— Produit —</option>' + (prods || []).filter(p => p.active !== false).map(p => '<option value="' + p.id + '" data-c="' + (p.buy_price || 0) + '">' + esc(p.name) + '</option>').join('');
    const row = l => '<tr><td><select class="bc-p">' + popt + '</select></td><td><input class="bc-q" type="number" min="0.001" step="0.001" value="' + (l ? l.qty_ordered : 1) + '" style="width:90px"></td>' +
      '<td><input class="bc-c" type="number" min="0.01" step="0.01" value="' + (l ? l.unit_cost : 0) + '" style="width:110px"></td><td class="bc-a">0</td><td><button type="button" class="b2 bc-x">×</button></td></tr>';
    modal('<h3 style="margin-top:0">' + (po ? 'Modifier ' + esc(po.order_no) : 'Nouveau bon de commande') + '</h3>' +
      '<div class="g"><label>Fournisseur<select id="bc_s">' + (sups || []).map(s => '<option value="' + s.id + '"' + (po && Number(po.supplier_id) === Number(s.id) ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></label>' +
      '<label>Livraison prévue<input type="date" id="bc_d" value="' + (po && po.expected_date ? String(po.expected_date).slice(0, 10) : '') + '"></label>' +
      '<label>Notes<input id="bc_n" value="' + esc(po && po.notes || '') + '"></label></div>' +
      '<div class="tw" style="max-height:40vh;overflow:auto"><table id="bc_t"><thead><tr><th>Produit</th><th>Qté</th><th>Coût unitaire</th><th>Montant</th><th></th></tr></thead><tbody></tbody></table></div>' +
      '<p><button type="button" class="b2" id="bc_add">+ Ligne</button> ' + (hasScanner() ? '<button type="button" class="b2" id="bc_scan">📷 Scanner un produit</button> ' : '') + '<b>Total : <span id="bc_tot">0</span></b></p>' +
      '<div class="r"><button class="b2" onclick="closeM()">Annuler</button><button class="b2" id="bc_save">Enregistrer en brouillon</button>' +
      '<button id="bc_val">Enregistrer et valider</button></div>');
    const tb = document.querySelector('#bc_t tbody');
    const calc = () => { let t = 0; tb.querySelectorAll('tr').forEach(tr => { const a = (+tr.querySelector('.bc-q').value || 0) * (+tr.querySelector('.bc-c').value || 0); tr.querySelector('.bc-a').textContent = m(a); t += a; }); document.getElementById('bc_tot').textContent = m(t); };
    const add = l => {
      tb.insertAdjacentHTML('beforeend', row(l)); const tr = tb.lastElementChild;
      if (l) tr.querySelector('.bc-p').value = l.product_id;
      tr.querySelector('.bc-p').onchange = e => { const o = e.target.selectedOptions[0]; if (o && o.dataset.c && !(+tr.querySelector('.bc-c').value)) tr.querySelector('.bc-c').value = o.dataset.c; calc(); };
      tr.querySelector('.bc-q').oninput = tr.querySelector('.bc-c').oninput = calc;
      tr.querySelector('.bc-x').onclick = () => { if (tb.rows.length > 1) { tr.remove(); calc(); } else toast('Au moins une ligne requise', 'error'); };
    };
    (po ? po.lines : [null]).forEach(add); calc();
    document.getElementById('bc_add').onclick = () => add(null);
    const sc = document.getElementById('bc_scan');
    if (sc) {
      const handler = async code => {
        const p = await productByCode(code); if (!p) { toast('Code-barres inconnu : ' + code, 'error'); return; }
        let tr = [...tb.querySelectorAll('tr')].find(x => +x.querySelector('.bc-p').value === Number(p.id));
        if (tr) tr.querySelector('.bc-q').value = (+tr.querySelector('.bc-q').value || 0) + 1;
        else {
          const empty = [...tb.querySelectorAll('tr')].find(x => !x.querySelector('.bc-p').value);
          if (empty) tr = empty; else { add(null); tr = tb.lastElementChild; }
          tr.querySelector('.bc-p').value = p.id; tr.querySelector('.bc-q').value = 1; if (!(+tr.querySelector('.bc-c').value)) tr.querySelector('.bc-c').value = p.buy_price || 0;
        }
        calc(); toast(p.name + ' ajouté');
      };
      sc.onclick = () => { window.__mpScanHandler = c => { if (!document.getElementById('bc_scan')) return false; handler(c); return true; }; AndroidBridge.scan(); };
    }
    const save = async validate => {
      const items = [...tb.querySelectorAll('tr')].map(tr => ({ product_id: +tr.querySelector('.bc-p').value, quantity: +tr.querySelector('.bc-q').value, unit_cost: +tr.querySelector('.bc-c').value }));
      if (items.some(i => !i.product_id || !(i.quantity > 0) || !(i.unit_cost > 0))) return toast('Chaque ligne doit avoir un produit, une quantité et un coût > 0', 'error');
      const body = { supplier_id: +document.getElementById('bc_s').value, items, notes: document.getElementById('bc_n').value || null, expected_date: document.getElementById('bc_d').value || null };
      try {
        let r = po ? await Pu('/purchase-orders/' + po.id, body) : await Po('/purchase-orders', Object.assign(body, { validate: validate }));
        if (po && validate) r = await Po('/purchase-orders/' + po.id + '/validate', {});
        closeM(); toast('Bon ' + r.order_no + ' enregistré'); go('bcommande');
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('bc_save').onclick = () => save(false);
    document.getElementById('bc_val').onclick = () => save(true);
  };

  // ---------- Détail ----------
  window.bcShow = async function (id) {
    let d; try { d = await G('/purchase-orders/' + id); } catch (e) { return toast(e.message, 'error'); }
    const st = d.reception_status, canRecv = canManage() && (st === 'valide' || st === 'partiel');
    const editable = canManage() && (st === 'brouillon' || (st === 'valide' && !d.receipts.length));
    const t = d.totals;
    const lines = T(['Produit', 'Commandé', 'Reçu', 'Reste', 'Coût unit.', 'Montant commandé', 'Montant reçu', 'Reste à recevoir'],
      d.lines.map(l => [esc(l.product), q(l.qty_ordered), q(l.qty_received), q(l.qty_remaining), m(l.unit_cost), m(l.amount_ordered), m(l.amount_received), m(l.amount_remaining)]));
    const rec = d.receipts.length ? T(['Réception', 'Date', 'Par', 'Lignes', 'Valeur', 'Règlement'],
      d.receipts.map(r => [esc(r.receipt_no || r.id), dt(r.received_at), esc(r.user_login || '—'), r.lines.map(l => esc(l.product) + ' × ' + q(l.quantity)).join('<br>'), m(r.value_received),
        r.payment_mode === 'immediat' ? 'Immédiat · ' + esc(r.payment_method) + ' · ' + m(r.amount_paid) : 'Différé (dette)'])) : '<p class="muted">Aucune réception.</p>';
    const pay = d.payments.length ? T(['Date', 'Montant', 'Mode', 'Origine', 'Par'], d.payments.map(p => [dt(p.paid_at), m(p.amount), esc(p.method), p.receipt_id ? 'À la réception' : 'Règlement ultérieur', esc(p.user_login || '—')])) : '<p class="muted">Aucun règlement.</p>';
    modal('<h3 style="margin-top:0">' + esc(d.order_no) + ' · ' + esc(d.supplier) + '</h3>' +
      '<p>' + tag(STATUS[st]) + ' ' + tag(PAY[d.payment_status]) + ' <span class="muted">Créé le ' + dt(d.ordered_at) + ' par ' + esc(d.created_by_login || '—') + (d.cancel_reason ? ' · Motif d’annulation : ' + esc(d.cancel_reason) : '') + '</span></p>' +
      '<div class="g" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">' +
      [['Engagé', t.amount_committed], ['Reçu (valeur)', t.amount_received], ['Payé', t.amount_paid], ['Reste à payer', t.amount_remaining_to_pay], ['Reste à recevoir', t.amount_remaining_to_receive]].map(k => '<div class="card"><small>' + k[0] + '</small><br><b>' + m(k[1]) + '</b></div>').join('') + '</div>' +
      '<h4>Lignes</h4>' + lines + '<h4>Historique des réceptions</h4>' + rec + '<h4>Règlements</h4>' + pay +
      '<h4>Pièces jointes</h4>' + ((d.attachments || []).length ? '<ul style="margin:0 0 8px;padding-left:18px">' + d.attachments.map(a => '<li><a href="#" onclick="bcViewAtt(' + d.id + ',' + a.id + ');return false">' + esc(a.filename) + '</a> <span class="muted">' + dt(a.created_at) + ' · ' + esc(a.user_login || '') + '</span></li>').join('') + '</ul>' : '<p class="muted">Aucune pièce jointe.</p>') +
      (d.notes ? '<p class="muted">Notes : ' + esc(d.notes) + '</p>' : '') +
      '<div class="r" style="flex-wrap:wrap;gap:6px"><button class="b2" onclick="closeM()">Fermer</button>' +
      '<button class="b2" onclick="bcPdf(' + d.id + ')">PDF</button><button class="b2" onclick="bcShare(' + d.id + ')">Partager</button>' + (canManage() && st !== 'annule' ? '<button class="b2" onclick="bcAttach(' + d.id + ')">📷 Joindre</button>' : '') + '<button class="b2" onclick="bcPrint(' + d.id + ')">Imprimer</button>' +
      (editable ? '<button class="b2" onclick="bcEdit(' + d.id + ')">Modifier</button>' : '') +
      (canManage() && st === 'brouillon' ? '<button onclick="bcValidate(' + d.id + ')">Valider</button>' : '') +
      (canManage() && (st === 'brouillon' || (st === 'valide' && !d.receipts.length)) ? '<button class="b2" onclick="bcCancel(' + d.id + ')">Annuler le bon</button>' : '') +
      (canPay() && d.remaining_to_pay > 0 && st !== 'brouillon' && st !== 'annule' ? '<button class="b2" onclick="bcPay(' + d.id + ')">Régler (' + m(d.remaining_to_pay) + ')</button>' : '') +
      (canRecv ? '<button onclick="bcReceive(' + d.id + ')">Réceptionner</button>' : '') + '</div>');
  };

  window.bcValidate = async id => { try { await Po('/purchase-orders/' + id + '/validate', {}); toast('Bon validé'); closeM(); go('bcommande'); } catch (e) { toast(e.message, 'error'); } };
  window.bcCancel = async id => {
    const reason = prompt('Motif de l’annulation (3 caractères minimum) :'); if (!reason) return;
    try { await Po('/purchase-orders/' + id + '/cancel', { reason }); toast('Bon annulé'); closeM(); go('bcommande'); } catch (e) { toast(e.message, 'error'); }
  };

  async function methodsSelect(id) {
    let rows = []; try { rows = await G('/payment-methods/linked'); } catch (_) { /* vide */ }
    return '<select id="' + id + '"><option value="">— Choisir le compte / mode de paiement —</option>' +
      (rows || []).map(r => '<option value="' + esc(r.code) + '">' + esc(r.label || r.code) + (r.account_name ? ' (' + esc(r.account_name) + ')' : '') + '</option>').join('') + '</select>';
  }

  // ---------- Réception : quantités réellement reçues + mode de règlement OBLIGATOIRE ----------
  window.bcReceive = async function (id) {
    const d = await G('/purchase-orders/' + id);
    const sel = await methodsSelect('rc_m');
    const open = d.lines.filter(l => l.qty_remaining > 0);
    modal('<h3 style="margin-top:0">Réception — ' + esc(d.order_no) + '</h3>' +
      '<p class="muted">Saisissez les quantités réellement reçues (partielles possibles ; le reste demeure en attente).</p>' +
      T(['Produit', 'Commandé', 'Déjà reçu', 'Reste', 'Reçu maintenant'], open.map(l => [esc(l.product), q(l.qty_ordered), q(l.qty_received), q(l.qty_remaining),
        '<input class="rc-q" data-d="' + l.id + '" data-c="' + l.unit_cost + '" data-max="' + l.qty_remaining + '" type="number" min="0" max="' + l.qty_remaining + '" step="0.001" value="' + l.qty_remaining + '" style="width:100px">'])) +
      '<p><b>Valeur reçue : <span id="rc_val">0</span></b></p>' +
      '<fieldset style="border:1px solid #8884;padding:8px;border-radius:8px"><legend><b>Mode de règlement (obligatoire)</b></legend>' +
      '<label style="display:block"><input type="radio" name="rc_mode" value="differe"> Règlement différé — la valeur reçue devient une dette envers le fournisseur</label>' +
      (canPay() ? '<label style="display:block"><input type="radio" name="rc_mode" value="immediat"> Règlement immédiat — débit du compte choisi</label>' +
        '<div id="rc_imm" style="display:none;margin-top:6px"><div class="g"><label>Compte / mode de paiement' + sel + '</label>' +
        '<label>Montant payé<input id="rc_amt" type="number" min="0.01" step="0.01"></label></div></div>' : '<p class="muted">Le règlement immédiat nécessite la permission de payer les fournisseurs.</p>') +
      '</fieldset><label>Note<input id="rc_n"></label>' +
      '<label>📷 Bon de livraison / facture fournisseur (photo ou PDF, facultatif)<input id="rc_f" type="file" accept="image/*,application/pdf"></label>' +
      '<div class="r"><button class="b2" onclick="closeM()">Annuler</button>' + (hasScanner() ? '<button class="b2" onclick="AndroidBridge.scan()">📷 Scanner</button>' : '') + '<button id="rc_ok">Valider la réception</button></div>');
    const inputs = () => [...document.querySelectorAll('.rc-q')];
    if (hasScanner()) {
      const pid = {}; d.lines.forEach(l => { pid[l.id] = l.product_id; });
      window.__mpScanHandler = code => {
        if (!document.getElementById('rc_ok')) return false;     // dialogue fermé : laisser le scan au champ actif
        (async () => {
          const p = await productByCode(code); const inp = p && inputs().find(i => Number(pid[i.dataset.d]) === Number(p.id));
          if (!inp) { toast(p ? p.name + ' : déjà entièrement reçu ou absent de ce bon' : 'Code-barres inconnu : ' + code, 'error'); return; }
          inp.focus(); inp.select(); toast(p.name + ' — saisissez la quantité reçue');
        })();
        return true;
      };
    }
    const val = () => inputs().reduce((a, i) => a + (+i.value || 0) * (+i.dataset.c), 0);
    const upd = () => { const v = val(); document.getElementById('rc_val').textContent = m(v); const a = document.getElementById('rc_amt'); if (a && !a.dataset.t) a.value = Math.round(v * 100) / 100; };
    inputs().forEach(i => i.oninput = upd); upd();
    const am = document.getElementById('rc_amt'); if (am) am.oninput = () => { am.dataset.t = '1'; };
    document.querySelectorAll('input[name=rc_mode]').forEach(r => r.onchange = () => { const x = document.getElementById('rc_imm'); if (x) x.style.display = r.value === 'immediat' && r.checked ? '' : 'none'; });
    const clientRef = ref('bcr');
    document.getElementById('rc_ok').onclick = async function () {
      const mode = (document.querySelector('input[name=rc_mode]:checked') || {}).value;
      if (!mode) return toast('Choisissez le mode de règlement (différé ou immédiat) avant de valider.', 'error');
      const lines = inputs().map(i => ({ detail_id: +i.dataset.d, quantity: +i.value || 0 }));
      for (const i of inputs()) if ((+i.value || 0) > +i.dataset.max + 1e-9) return toast('Quantité supérieure au reste à recevoir', 'error');
      if (!lines.some(l => l.quantity > 0)) return toast('Saisissez au moins une quantité reçue', 'error');
      const body = { lines, payment_mode: mode, note: document.getElementById('rc_n').value || null, client_ref: clientRef };
      if (mode === 'immediat') {
        body.method = (document.getElementById('rc_m') || {}).value;
        if (!body.method) return toast('Sélectionnez le compte / mode de paiement', 'error');
        body.amount = +document.getElementById('rc_amt').value || undefined;
      }
      this.disabled = true;
      try {
        const done = await Po('/purchase-orders/' + id + '/receive', body);
        const file = (document.getElementById('rc_f') || {}).files && document.getElementById('rc_f').files[0];
        let warn = '';
        if (file) { try { await uploadAttachment(id, file, (done.receipts[done.receipts.length - 1] || {}).id); } catch (e) { warn = ' — pièce jointe non enregistrée : ' + e.message; } }
        toast('Réception enregistrée' + warn, warn ? 'error' : undefined); closeM(); go('bcommande');
      }
      catch (e) { toast(e.message, 'error'); this.disabled = false; }
    };
  };

  // ---------- Règlement ultérieur ----------
  window.bcPay = async function (id) {
    const d = await G('/purchase-orders/' + id); const sel = await methodsSelect('py_m');
    modal('<h3 style="margin-top:0">Règlement — ' + esc(d.order_no) + '</h3><p>Reste dû sur les quantités reçues : <b>' + m(d.remaining_to_pay) + '</b></p>' +
      '<div class="g"><label>Montant<input id="py_a" type="number" min="0.01" step="0.01" max="' + d.remaining_to_pay + '" value="' + d.remaining_to_pay + '"></label><label>Compte / mode de paiement (obligatoire)' + sel + '</label></div>' +
      '<div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="py_ok">Enregistrer le règlement</button></div>');
    const clientRef = ref('bcp');
    document.getElementById('py_ok').onclick = async function () {
      const method = document.getElementById('py_m').value, amount = +document.getElementById('py_a').value;
      if (!method) return toast('Sélectionnez un mode de paiement', 'error');
      if (!(amount > 0)) return toast('Montant invalide', 'error');
      this.disabled = true;
      try { await Po('/purchase-orders/' + id + '/pay', { amount, method, client_ref: clientRef }); toast('Règlement enregistré'); closeM(); go('bcommande'); }
      catch (e) { toast(e.message, 'error'); this.disabled = false; }
    };
  };

  // ---------- PDF / impression ----------
  function pdfOpts(d) {
    return {
      title: 'Bon de commande ' + d.order_no, subtitle: d.supplier + ' — ' + (STATUS[d.reception_status] || '') + ' / ' + (PAY[d.payment_status] || ''),
      period: 'Date : ' + dt(d.ordered_at), ref: d.order_no, filename: d.order_no,
      sections: [
        { type: 'kpis', items: [{ label: 'Engagé', value: m(d.totals.amount_committed) }, { label: 'Reçu', value: m(d.totals.amount_received) }, { label: 'Payé', value: m(d.totals.amount_paid) }, { label: 'Reste à payer', value: m(d.totals.amount_remaining_to_pay) }] },
        { type: 'table', title: 'Lignes', head: ['Produit', 'Commandé', 'Reçu', 'Reste', 'Coût unit.', 'Montant'], rows: d.lines.map(l => [l.product, q(l.qty_ordered), q(l.qty_received), q(l.qty_remaining), m(l.unit_cost), m(l.amount_ordered)]) },
        { type: 'table', title: 'Réceptions', head: ['N°', 'Date', 'Par', 'Valeur', 'Règlement'], rows: d.receipts.map(r => [r.receipt_no || r.id, dt(r.received_at), r.user_login || '—', m(r.value_received), r.payment_mode === 'immediat' ? 'Immédiat (' + r.payment_method + ')' : 'Différé']) },
        { type: 'table', title: 'Règlements', head: ['Date', 'Montant', 'Mode'], rows: d.payments.map(p => [dt(p.paid_at), m(p.amount), p.method]) }
      ].filter(s => s.type === 'kpis' || s.rows.length),
      signatures: [{ label: 'Établi par' }, { label: 'Fournisseur' }]
    };
  }
  /** Partage du bon en PDF : feuille de partage Android (WhatsApp, e-mail…) ; sur ordinateur, téléchargement + liens prêts. */
  window.bcShare = async function (id) {
    try {
      const d = await G('/purchase-orders/' + id), o = pdfOpts(d);
      const r = await fetch('/api/docs/render', { method: 'POST', headers: hdrs(), body: JSON.stringify(o) });
      if (!r.ok) throw new Error('Génération du PDF impossible');
      const blob = await r.blob(), name = (d.order_no || 'bon-de-commande') + '.pdf';
      const text = 'Bon de commande ' + d.order_no + ' — ' + d.supplier + ' — ' + m(d.totals.amount_committed);
      if (window.AndroidBridge && AndroidBridge.shareFile) { AndroidBridge.shareFile(await b64(blob), 'application/pdf', name, text); return; }
      const file = new File([blob], name, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: d.order_no, text }); return; }
      const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
      modal('<h3 style="margin-top:0">PDF téléchargé</h3><p>Joignez le fichier <b>' + esc(name) + '</b> puis envoyez-le :</p><div class="r" style="gap:8px">' +
        '<a class="b2" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(text) + '">WhatsApp</a>' +
        '<a class="b2" href="mailto:?subject=' + encodeURIComponent('Bon de commande ' + d.order_no) + '&body=' + encodeURIComponent(text) + '">E-mail</a>' +
        '<button class="b2" onclick="closeM()">Fermer</button></div>');
    } catch (e) { if (e && e.name !== 'AbortError') toast(e.message, 'error'); }
  };
  window.bcPdf = async function (id) { try { const d = await G('/purchase-orders/' + id); await brandedPdf(pdfOpts(d)); } catch (e) { toast(e.message, 'error'); } };
  window.bcPrint = async function (id) {
    try {
      const d = await G('/purchase-orders/' + id); const o = pdfOpts(d); const w = window.open('', '_blank'); if (!w) return toast('Fenêtre bloquée', 'error');
      w.document.write('<html><head><title>' + esc(o.title) + '</title><style>body{font:13px sans-serif;padding:20px}table{border-collapse:collapse;width:100%;margin-bottom:14px}td,th{border:1px solid #999;padding:4px 6px;text-align:left}</style></head><body><h2>' + esc(o.title) + '</h2><p>' + esc(o.subtitle) + '</p>' +
        o.sections.filter(s => s.type === 'table').map(s => '<h4>' + esc(s.title) + '</h4><table><tr>' + s.head.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr>' + s.rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table>').join('') + '</body></html>');
      w.document.close(); if (!(window.ManageProNative && ManageProNative.available())) { w.focus(); w.print(); }
    } catch (e) { toast(e.message, 'error'); }
  };
})();
