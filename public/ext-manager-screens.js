/* ext-manager-screens.js — Écrans du lot gérant :
   1) Synthèse hebdo : résumé de la semaine (API GET /reports/weekly-summary), navigation semaine précédente / suivante, texte copiable.
   2) Justificatifs : consultation des dépenses de la période et de leurs justificatifs (API GET /treasury/expenses, GET /expenses/:id/receipts, GET /expenses/:id/receipts/:rid).
   Consultation seule : la pièce se joint à la saisie de la dépense (ext-manager-extras.js). */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof V === 'undefined') return;

  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function shiftWeek(ws, n) { var d = new Date(ws + 'T00:00:00'); d.setDate(d.getDate() + 7 * n); return iso(d); }
  function kpi(label, value, sub) {
    return '<div class="card"><small>' + esc(label) + '</small><b>' + value + '</b>' + (sub ? '<small class="muted">' + sub + '</small>' : '') + '</div>';
  }

  /* ---------- 1) Synthèse hebdomadaire ---------- */
  var SYN = { ws: null };
  var thisMonday = function () { return iso(mondayOf(new Date())); };

  VM.synthese = async function () {
    if (!SYN.ws) SYN.ws = iso(mondayOf(new Date(Date.now() - 7 * 864e5)));   // semaine écoulée par défaut
    var s = await G('/reports/weekly-summary?week_start=' + SYN.ws);
    var evo = s.evolution_pct == null ? 'Référence indisponible' : (s.evolution_pct > 0 ? '+' : '') + s.evolution_pct + ' %';
    var top = s.top_seller ? esc(s.top_seller.name) + ' — ' + f(s.top_seller.amount) : 'Aucun';
    var atLast = s.week_start >= thisMonday();
    return '<div class="bar" style="justify-content:space-between;flex-wrap:wrap;gap:8px">' +
        '<button class="b2" onclick="synthNav(-1)">‹ Semaine précédente</button>' +
        '<b>Semaine du ' + esc(s.week_start) + ' au ' + esc(s.week_end) + '</b>' +
        '<button class="b2" onclick="synthNav(1)"' + (atLast ? ' disabled' : '') + '>Semaine suivante ›</button></div>' +
      '<div class="cards">' +
        kpi('Ventes de la semaine', f(s.amount), 'Carburant ' + f(s.fuel_amount) + ' · Boutique ' + f(s.shop_amount)) +
        kpi('Carburant', fl(s.liters) + ' L') +
        kpi('Quarts clôturés', esc(s.shifts_closed)) +
        kpi('Écart de caisse cumulé', f(s.cash_gap)) +
        kpi('Évolution vs semaine précédente', esc(evo)) +
        kpi('Meilleur vendeur', top) +
      '</div>' +
      '<h4>Texte du résumé</h4>' +
      '<p class="muted">Ce texte est celui envoyé en notification le lundi.</p>' +
      '<textarea id="synth-text" readonly rows="4" style="width:100%">' + esc(s.text) + '</textarea>' +
      '<div class="bar"><button onclick="synthCopy()">Copier le texte</button></div>';
  };

  window.synthNav = function (n) {
    var next = shiftWeek(SYN.ws, n);
    if (next > thisMonday()) return;          // pas de semaine future
    SYN.ws = next;
    go('synthese');
  };
  window.synthCopy = async function () {
    var t = document.getElementById('synth-text');
    try {
      await navigator.clipboard.writeText(t.value);
      toast('Texte copié', 'success');
    } catch (e) { t.select(); toast('Copie impossible : sélectionnez le texte et copiez-le', 'error'); }
  };

  /* ---------- 2) Justificatifs ---------- */
  var JUS = null;
  VM.justificatifs = async function () {
    if (!JUS) { var now = new Date(); JUS = { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) }; }
    var d = await G('/treasury/expenses?from=' + JUS.from + '&to=' + JUS.to);
    var rows = d.lines.map(function (x) {
      return '<tr><td>' + esc(x.spent_on) + '</td><td>' + esc(x.category) + '</td><td>' + esc(x.beneficiary || x.comment || '—') + '</td>' +
        '<td style="text-align:right">' + f(x.amount) + '</td>' +
        '<td><button class="b2" onclick="justList(' + Number(x.id) + ')">Justificatifs</button></td></tr>';
    }).join('');
    return '<div class="bar" style="flex-wrap:wrap;gap:8px">' +
        '<label>Du <input type="date" id="jf" value="' + JUS.from + '"></label>' +
        '<label>au <input type="date" id="jt" value="' + JUS.to + '"></label>' +
        '<button onclick="justApply()">Appliquer</button></div>' +
      '<p class="muted">' + d.lines.length + ' dépense(s) · total ' + f(d.total) + '. Consultation seule : le justificatif se joint à la saisie de la dépense.</p>' +
      (rows
        ? '<div style="overflow:auto"><table><thead><tr><th>Date</th><th>Catégorie</th><th>Bénéficiaire / libellé</th><th style="text-align:right">Montant</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p>Aucune dépense sur cette période.</p>');
  };

  window.justApply = function () {
    var a = document.getElementById('jf').value, b = document.getElementById('jt').value;
    if (!a || !b || a > b) { toast('Période invalide', 'error'); return; }
    JUS = { from: a, to: b };
    go('justificatifs');
  };
  window.justList = async function (expenseId) {
    try {
      var list = await G('/expenses/' + expenseId + '/receipts');
      var body = list.length
        ? list.map(function (r) {
            return '<div class="bar" style="justify-content:space-between;gap:8px"><span>' + esc(r.filename) + ' <small class="muted">' + Math.round(r.size / 1024) + ' Ko</small></span>' +
              '<button class="b2" onclick="justOpen(' + Number(expenseId) + ',' + Number(r.id) + ')">Ouvrir</button></div>';
          }).join('')
        : '<p class="muted">Aucun justificatif joint à cette dépense.</p>';
      modal('<h3 style="margin-top:0">Justificatifs</h3>' + body + '<div class="bar" style="justify-content:flex-end"><button class="b2" onclick="closeM()">Fermer</button></div>');
    } catch (e) { toast((e && e.message) || 'Lecture impossible', 'error'); }
  };
  window.justOpen = async function (expenseId, receiptId) {
    var w = window.open('', '_blank');   // ouvert dans le geste utilisateur (évite le blocage des fenêtres)
    if (!w) { toast('Autorisez les fenêtres pop-up pour afficher le justificatif', 'error'); return; }
    try {
      var r = await fetch('/api/expenses/' + expenseId + '/receipts/' + receiptId, {
        headers: { ...(TK && { Authorization: 'Bearer ' + TK }), ...(SID && { 'X-Station-Id': SID }) }
      });
      if (!r.ok) throw new Error('Ouverture impossible (erreur ' + r.status + ')');
      var url = URL.createObjectURL(await r.blob());
      w.location.href = url;
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (e) { w.close(); toast((e && e.message) || 'Ouverture impossible', 'error'); }
  };

  /* ---------- Menu ---------- */
  V.synthese = ['Synthèse hebdo', 'report.view|finance.view'];
  V.justificatifs = ['Justificatifs', 'expense.create|report.view|finance.view'];
  if (typeof NAV_ICONS !== 'undefined') { NAV_ICONS.synthese = '📅'; NAV_ICONS.justificatifs = '📎'; }
})();
