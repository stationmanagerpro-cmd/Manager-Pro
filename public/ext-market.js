/* ext-market.js — fonctions « marché » : Prix du jour, Fidélité, Risque des quarts, Prévision de rupture, Espace client,
   et rapprochement relevé Mobile Money ↔ ventes (bouton ajouté à la fenêtre de rapprochement). API : src/market.js, src/client_portal.js */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined' || typeof G === 'undefined') return;
  var can_ = function (p) { try { return can(p); } catch (_) { return false; } };
  var fd = function (s) { return s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—'; };
  var num = function (n, d) { return nfr(n, d == null ? 2 : d); };
  var err = function (e) { toast((e && e.message) || String(e), 'error'); };
  var tbl = function (heads, rows, numCols) {
    if (!rows.length) return '<p class="pc-empty" style="text-align:left">Aucune donnée.</p>';
    return '<div class="pc-tw"><table class="pc-tbl"><thead><tr>' + heads.map(function (h, i) { return '<th' + (numCols && numCols.indexOf(i) >= 0 ? ' class="pc-num"' : '') + '>' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (numCols && numCols.indexOf(i) >= 0 ? ' class="pc-num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  };
  var today = function () { return new Date().toISOString().slice(0, 10); };
  var ago = function (n) { return new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); };
  var tag = function (cls, t) { return '<span class="' + cls + '">' + esc(t) + '</span>'; };
  var LEVEL = { a_controler: ['À contrôler', 'pt-red'], a_surveiller: ['À surveiller', ''], normal: ['Normal', 'pt-green'], critique: ['Critique', 'pt-red'], attention: ['Attention', ''], ok: ['Suffisant', 'pt-green'] };
  var lvl = function (l) { var x = LEVEL[l] || [l, '']; return tag(x[1], x[0]); };

  /* ───────── 8. Prix du jour ───────── */
  var pb = null;
  VM.prixjour = async function () {
    pb = await G('/prices/board');
    var edit = can_('price.edit');
    var rows = pb.items.map(function (p) {
      return [esc(p.name), f(p.sell_price), p.previous_price != null ? f(p.previous_price) : '—', p.changed_at ? esc(p.changed_at) : '—',
        edit ? '<input type="number" min="0" step="any" data-pb="' + p.id + '" data-cur="' + p.sell_price + '" placeholder="' + p.sell_price + '" style="width:110px">' : '',
        pb.can_cost ? (p.margin != null ? f(p.margin) + ' (' + num(p.margin_pct, 1) + ' %)' : '—') : '',
        pb.can_cost ? (p.margin_7d != null ? f(p.margin_7d) : '—') : ''];
    });
    var heads = ['Carburant', 'Prix actuel', 'Précédent', 'Changé le', edit ? 'Nouveau prix' : ''].concat(pb.can_cost ? ['Marge / unité', 'Marge 7 j'] : []);
    var cut = pb.can_cost ? 7 : 5;
    return '<h2 style="margin-top:0">Prix du jour</h2><p class="muted">Tous les carburants sur un seul écran : changez les prix en une fois, chaque changement est daté, historisé et audité.' +
      (pb.can_cost ? ' La marge est recalculée sur le coût d’achat.' : '') + '</p>' +
      (pb.open_shift ? '<p class="warn">Le quart n° ' + esc(pb.open_shift) + ' est ouvert : le nouveau prix s’applique aux ventes saisies à partir de maintenant.</p>' : '') +
      tbl(heads.slice(0, cut), rows.map(function (r) { return r.slice(0, cut); }), pb.can_cost ? [1, 2, 5, 6] : [1, 2]) +
      (edit ? '<div class="bar" style="margin-top:10px"><input id="pb-note" placeholder="Motif (ex. hausse fournisseur)" style="min-width:240px"><button type="button" onclick="mkPriceSave()">Appliquer les nouveaux prix</button></div>' : '');
  };
  window.mkPriceSave = function () {
    var ch = [].slice.call(document.querySelectorAll('[data-pb]')).map(function (i) { return { product_id: Number(i.getAttribute('data-pb')), price: i.value === '' ? null : Number(i.value), cur: Number(i.getAttribute('data-cur')) }; })
      .filter(function (c) { return c.price != null && !isNaN(c.price) && c.price !== c.cur; });
    if (!ch.length) return toast('Saisissez au moins un nouveau prix différent du prix actuel', 'error');
    ask('Appliquer ' + ch.length + ' changement(s) de prix ?', async function () {
      await Po('/prices/board', { changes: ch.map(function (c) { return { product_id: c.product_id, price: c.price }; }), note: (document.getElementById('pb-note') || {}).value || null });
      toast('Prix mis à jour', 'success'); go('prixjour');
    });
  };

  /* ───────── 5. Prévision de rupture ───────── */
  VM.previsions = async function () {
    var lead = Number(window.__mkLead || 2), d = await G('/stock/forecast?lead=' + lead);
    var rows = d.items.map(function (x) {
      return [esc(x.name), num(x.stock, 1) + ' ' + esc(x.unit || ''), num(x.daily_rate, 1), num(x.days_left, 1) + ' j', fd(x.stockout_on), fd(x.order_by), lvl(x.level)];
    });
    return '<h2 style="margin-top:0">Prévision de rupture de stock</h2><p class="muted">Rythme de vente estimé sur ' + d.window_days + ' jours (récent pondéré). Date de commande conseillée = rupture − délai de livraison.</p>' +
      '<div class="bar"><label>Délai de livraison (jours) <input id="mk-lead" type="number" min="0" max="30" value="' + lead + '" style="width:70px"></label><button class="b2" type="button" onclick="window.__mkLead=document.getElementById(\'mk-lead\').value;go(\'previsions\')">Recalculer</button></div>' +
      '<p><b>' + d.critical + '</b> critique(s) · <b>' + d.attention + '</b> à surveiller</p>' +
      tbl(['Produit', 'Stock', 'Vente / jour', 'Autonomie', 'Rupture le', 'Commander avant le', 'Niveau'], rows, [1, 2, 3]) +
      (d.no_sales.length ? '<div class="tr-sec">SANS VENTE RÉCENTE</div><p class="muted">' + d.no_sales.map(function (x) { return esc(x.name); }).join(', ') + '</p>' : '');
  };

  /* ───────── 4. Risque des quarts ───────── */
  VM.risque = async function () {
    var from = window.__mkRFrom || ago(14), to = window.__mkRTo || today(), d = await G('/risk/shifts?from=' + from + '&to=' + to);
    var rows = d.shifts.map(function (s) {
      return [fd(s.shift_date) + ' · n° ' + esc(s.number), esc(s.manager || '—'), f(s.cash_gap || 0), s.cancelled_count + ' / ' + s.sales_count, s.anomaly_count ? esc(s.anomaly_kinds || s.anomaly_count) : '—',
        '<b>' + s.score + '</b>/100 ' + lvl(s.level), '<small>' + esc((s.factors || []).map(function (x) { return x.label + ' : ' + x.detail + ' (+' + x.points + ')'; }).join(' · ')) + '</small>'];
    });
    return '<h2 style="margin-top:0">Risque des quarts</h2><p class="muted">Score de 0 à 100 expliqué : écart de caisse, annulations, anomalies et répétition. C’est une aide au contrôle, pas une accusation.</p>' +
      '<div class="bar"><input type="date" id="mk-rf" value="' + from + '"><input type="date" id="mk-rt" value="' + to + '"><button class="b2" type="button" onclick="window.__mkRFrom=document.getElementById(\'mk-rf\').value;window.__mkRTo=document.getElementById(\'mk-rt\').value;go(\'risque\')">Afficher</button></div>' +
      '<p><b>' + d.summary.a_controler + '</b> à contrôler · <b>' + d.summary.a_surveiller + '</b> à surveiller · ' + d.summary.normal + ' normaux (sur ' + d.summary.total + ' quarts)</p>' +
      tbl(['Quart', 'Responsable', 'Écart caisse', 'Annul. / ventes', 'Anomalies', 'Score', 'Raisons'], rows, [2]);
  };

  /* ───────── 3. Fidélité ───────── */
  VM.fidelite = async function () {
    var s = (window.__mkLoySearch || ''), d = await G('/loyalty/accounts?search=' + encodeURIComponent(s)), st = d.settings, adm = can_('settings.edit');
    var rows = d.accounts.map(function (a) {
      return [esc(a.name || '—'), esc(a.phone || '—'), esc(a.plate || '—'), '<b>' + a.points + '</b>', f(a.value),
        '<button type="button" class="b2" onclick="mkLoyOpen(' + a.id + ')">Détail</button>'];
    });
    return '<h2 style="margin-top:0">Fidélité (téléphone / plaque)</h2><p class="muted">Aucune carte : le client est reconnu par son numéro ou sa plaque. ' +
      (st.enabled ? 'Programme <b>actif</b> : 1 point par ' + f(st.earn_per_amount) + (st.fuel_only ? ' de carburant' : ' d’achat') + ', 1 point = ' + f(st.point_value) + '.' : 'Programme <b>désactivé</b>.') + '</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px"><input id="mk-ls" placeholder="Rechercher téléphone, plaque, nom" value="' + esc(s) + '"><button class="b2" type="button" onclick="window.__mkLoySearch=document.getElementById(\'mk-ls\').value;go(\'fidelite\')">Chercher</button>' +
      (st.enabled && can_('sale.create') ? '<button type="button" onclick="mkLoyEarn()">＋ Créditer une vente</button>' : '') + (adm ? '<button class="b2" type="button" onclick="mkLoySettings()">⚙ Réglages</button>' : '') + '</div>' +
      '<p>' + d.total_accounts + ' compte(s) · ' + d.total_points + ' point(s) en circulation (≈ ' + f(d.total_value) + ')</p>' +
      tbl(['Nom', 'Téléphone', 'Plaque', 'Points', 'Valeur', ''], rows, [3, 4]);
  };
  window.mkLoySettings = async function () {
    var s = await G('/loyalty/settings');
    modal('<h3>Réglages de fidélité</h3><label><input type="checkbox" id="ls-en"' + (s.enabled ? ' checked' : '') + '> Programme actif</label>' +
      '<label>1 point par (montant)<input id="ls-ea" type="number" min="1" value="' + s.earn_per_amount + '"></label><label>Valeur d’un point (FCFA)<input id="ls-pv" type="number" min="0" value="' + s.point_value + '"></label>' +
      '<label>Minimum de points à utiliser<input id="ls-mr" type="number" min="1" value="' + s.min_redeem + '"></label><label><input type="checkbox" id="ls-fo"' + (s.fuel_only ? ' checked' : '') + '> Points sur le carburant uniquement</label>' +
      '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="mkLoySettingsSave()">Enregistrer</button></div>');
  };
  window.mkLoySettingsSave = async function () {
    var v = function (id) { return document.getElementById(id); };
    try { await Pu('/loyalty/settings', { enabled: v('ls-en').checked, earn_per_amount: Number(v('ls-ea').value), point_value: Number(v('ls-pv').value), min_redeem: Number(v('ls-mr').value), fuel_only: v('ls-fo').checked });
      closeM(); toast('Réglages enregistrés', 'success'); go('fidelite'); } catch (e) { err(e); }
  };
  window.mkLoyEarn = async function () {
    try {
      var sales = (await G('/sales?limit=40')).filter(function (s) { return s.status === 'valide'; });
      modal('<h3>Créditer une vente</h3><label>Vente<select id="le-s">' + sales.map(function (s) { return '<option value="' + s.id + '">' + esc(s.invoice_no || ('#' + s.id)) + ' · ' + dt(s.sold_at) + ' · ' + f(s.total) + '</option>'; }).join('') + '</select></label>' +
        '<label>Téléphone<input id="le-p" inputmode="tel" placeholder="Ex. 70 11 22 33"></label><label>Plaque<input id="le-pl" placeholder="Ex. AB-123-CD"></label><label>Nom (facultatif)<input id="le-n"></label>' +
        '<div class="r"><button class="b2" type="button" onclick="closeM()">Annuler</button><button type="button" onclick="mkLoyEarnSave()">Créditer</button></div>');
    } catch (e) { err(e); }
  };
  window.mkLoyEarnSave = async function () {
    var v = function (id) { return document.getElementById(id).value.trim(); };
    try { var r = await Po('/loyalty/earn', { sale_id: Number(v('le-s')), phone: v('le-p') || null, plate: v('le-pl') || null, name: v('le-n') || null });
      closeM(); toast(r.already ? 'Cette vente a déjà été créditée' : r.points_earned + ' point(s) crédité(s) — solde ' + r.account.points, 'success'); go('fidelite'); } catch (e) { err(e); }
  };
  window.mkLoyOpen = async function (id) {
    try {
      var d = await G('/loyalty/accounts/' + id), a = d.account;
      var ev = d.events.map(function (e) { return [dt(e.created_at), esc(e.kind), (e.points > 0 ? '+' : '') + e.points, esc(e.note || '')]; });
      modal('<h3>' + esc(a.name || a.phone || a.plate) + '</h3><p>' + esc(a.phone || '') + ' ' + esc(a.plate || '') + ' — <b>' + a.points + ' point(s)</b> (≈ ' + f(a.value) + ')</p>' + tbl(['Date', 'Type', 'Points', 'Note'], ev, [2]) +
        '<div class="bar" style="flex-wrap:wrap;gap:8px;margin-top:10px">' + (can_('sale.create') ? '<button type="button" onclick="mkLoyRedeem(' + id + ')">Utiliser des points</button>' : '') +
        (can_('customer.edit') ? '<button class="b2" type="button" onclick="mkLoyAdjust(' + id + ')">Ajuster</button>' : '') + (a.phone ? '<button class="b2" type="button" onclick="mkLoyNotify(' + id + ')">Envoyer le solde (WhatsApp)</button>' : '') +
        '<button class="b2" type="button" onclick="closeM()">Fermer</button></div>');
    } catch (e) { err(e); }
  };
  window.mkLoyRedeem = async function (id) {
    var p = prompt('Nombre de points à utiliser :'); if (!p) return;
    try { var r = await Po('/loyalty/accounts/' + id + '/redeem', { points: Math.floor(Number(p)) }); toast('Remise à accorder : ' + f(r.value), 'success'); mkLoyOpen(id); } catch (e) { err(e); }
  };
  window.mkLoyAdjust = async function (id) {
    var p = prompt('Points à ajouter (négatif pour retirer) :'); if (!p) return; var n = prompt('Motif (obligatoire) :'); if (!n) return;
    try { await Po('/loyalty/accounts/' + id + '/adjust', { points: Math.trunc(Number(p)), note: n }); mkLoyOpen(id); } catch (e) { err(e); }
  };
  window.mkLoyNotify = async function (id) {
    try { var r = await Po('/loyalty/accounts/' + id + '/notify', {}); if (r.sent) toast('Message envoyé', 'success'); else window.open(r.wa_link, '_blank', 'noopener'); } catch (e) { err(e); }
  };

  /* ───────── 7. Espace client (liens) ───────── */
  VM.espaceclient = async function () {
    var links = await G('/portal/links'), cus = can_('customer.edit') ? await G('/customers') : [];
    var rows = links.map(function (l) {
      return [esc(l.customer), fd(l.created_on), fd(l.expires_on), l.views + (l.last_seen ? ' · ' + esc(l.last_seen) : ''), l.active ? tag('pt-green', 'Actif') : tag('pt-red', l.revoked ? 'Révoqué' : 'Expiré'),
        l.active && can_('customer.edit') ? '<button class="b2" type="button" onclick="mkPortalRevoke(' + l.id + ')">Révoquer</button>' : ''];
    });
    return '<h2 style="margin-top:0">Espace client</h2><p class="muted">Un lien privé (sans application ni mot de passe) où le client voit son solde, ses pleins, ses factures et ses paiements. Lecture seule. Le lien n’est montré qu’une fois.</p>' +
      (can_('customer.edit') ? '<div class="bar" style="flex-wrap:wrap;gap:8px"><select id="ec-c">' + cus.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</select>' +
        '<label>Validité <select id="ec-d"><option value="7">7 jours</option><option value="30" selected>30 jours</option><option value="90">90 jours</option><option value="365">1 an</option></select></label><button type="button" onclick="mkPortalNew()">Créer un lien</button></div>' : '') +
      tbl(['Client', 'Créé le', 'Expire le', 'Vues', 'État', ''], rows);
  };
  window.mkPortalNew = async function () {
    try {
      var r = await Po('/portal/links', { customer_id: Number(document.getElementById('ec-c').value), days: Number(document.getElementById('ec-d').value) });
      var wa = 'https://wa.me/?text=' + encodeURIComponent('Votre espace client : ' + r.url);
      modal('<h3>Lien créé pour ' + esc(r.customer) + '</h3><p>Copiez-le maintenant, il ne sera plus affiché :</p><input id="ec-u" readonly value="' + esc(r.url) + '" style="width:100%"><p class="muted">Valable jusqu’au ' + fd(r.expires_on) + '.</p>' +
        '<div class="r"><a class="b2" href="' + esc(wa) + '" target="_blank" rel="noopener">Envoyer par WhatsApp</a><button type="button" onclick="mkCopy()">Copier</button><button class="b2" type="button" onclick="closeM();go(\'espaceclient\')">Fermer</button></div>');
    } catch (e) { err(e); }
  };
  window.mkCopy = function () { var i = document.getElementById('ec-u'); i.select(); try { navigator.clipboard.writeText(i.value); toast('Lien copié', 'success'); } catch (_) { document.execCommand && document.execCommand('copy'); } };
  window.mkPortalRevoke = function (id) { ask('Révoquer ce lien ? Le client ne pourra plus l’ouvrir.', async function () { await Po('/portal/links/' + id + '/revoke', {}); go('espaceclient'); }); };

  /* ───────── 2. Rapprochement relevé ↔ ventes (depuis la fenêtre de rapprochement) ───────── */
  window.mkSalesRec = async function (accId, from, to) {
    try {
      from = from || ago(6); to = to || today();
      var d = await G('/money/sales-reconcile?account_id=' + accId + '&from=' + from + '&to=' + to), s = d.summary;
      var a = d.declared_not_received.map(function (p) { return [fd(p.moved_on), esc(p.invoice_no || ''), esc(p.employee || '—'), esc(p.reference || ''), f(p.amount)]; });
      var b = d.received_not_declared.map(function (l) { return [fd(l.line_date), esc(l.label || ''), esc(l.reference || ''), f(l.amount)]; });
      var days = d.by_day.map(function (x) { return [fd(x.day), f(x.declared), f(x.received), f(x.gap)]; });
      var emp = d.by_employee.map(function (x) { return [esc(x.employee), x.count, f(x.amount)]; });
      modal('<h3>Relevé ↔ ventes — ' + esc(d.account.name) + '</h3><div class="bar"><input type="date" id="sr-f" value="' + d.from + '"><input type="date" id="sr-t" value="' + d.to + '"><button class="b2" type="button" onclick="mkSalesRec(' + accId + ',document.getElementById(\'sr-f\').value,document.getElementById(\'sr-t\').value)">Afficher</button></div>' +
        '<p>Déclaré en caisse : <b>' + f(s.declared) + '</b> · Reçu sur le compte : <b>' + f(s.received) + '</b> · Rapprochés : <b>' + s.matched_count + '</b></p>' +
        '<p>Déclarés <b>non reçus</b> : <b class="pt-red">' + s.declared_not_received_count + ' (' + f(s.declared_not_received) + ')</b> · Reçus <b>non déclarés</b> : <b>' + s.received_not_declared_count + ' (' + f(s.received_not_declared) + ')</b></p>' +
        '<div class="tr-sec">DÉCLARÉS MAIS NON REÇUS</div>' + tbl(['Date', 'Vente', 'Pompiste', 'Référence', 'Montant'], a, [4]) +
        '<div class="tr-sec">REÇUS MAIS NON DÉCLARÉS</div>' + tbl(['Date', 'Libellé', 'Référence', 'Montant'], b, [3]) +
        '<div class="tr-sec">PAR POMPISTE</div>' + tbl(['Pompiste', 'Nombre', 'Montant'], emp, [1, 2]) + '<div class="tr-sec">PAR JOUR</div>' + tbl(['Jour', 'Déclaré', 'Reçu', 'Écart'], days, [1, 2, 3]) +
        '<div class="r"><button type="button" class="b2" onclick="treLines(' + accId + ')">← Retour au relevé</button><button type="button" class="b2" onclick="closeM()">Fermer</button></div>');
    } catch (e) { err(e); }
  };
  // ajoute le bouton dans la fenêtre existante de rapprochement
  if (typeof window.treLines === 'function') {
    var orig = window.treLines;
    window.treLines = async function (accId) {
      var r = await orig(accId);
      try {
        var bars = document.querySelectorAll('#m .r'), bar = bars[bars.length - 1];
        if (bar && !bar.querySelector('[data-mk-sales]') && (can_('money.manage') || can_('finance.view'))) {
          var b = document.createElement('button'); b.type = 'button'; b.className = 'b2'; b.setAttribute('data-mk-sales', '1'); b.textContent = 'Rapprocher avec les ventes';
          b.onclick = function () { mkSalesRec(accId); }; bar.insertBefore(b, bar.firstChild);
        }
      } catch (_) { /* bouton facultatif */ }
      return r;
    };
  }

  V.prixjour = ['Prix du jour', 'price.edit|report.view|sale.create'];
  V.previsions = ['Prévision de rupture', 'report.view|stock.adjust'];
  V.risque = ['Risque des quarts', 'report.view|shift.close'];
  V.fidelite = ['Fidélité', 'customer.view|sale.create'];
  V.espaceclient = ['Espace client', 'customer.view|customer.edit'];
  if (typeof NAV_ICONS !== 'undefined') Object.assign(NAV_ICONS, { prixjour: '⛽', previsions: '📉', risque: '🛡️', fidelite: '🎁', espaceclient: '🔗' });
})();
