/* espace-client.js — page publique en lecture seule (lien privé /c/<jeton>). Aucune donnée interne, aucun cookie. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var tok = (location.pathname.match(/^\/c\/([^/]+)/) || [])[1] || '';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n = function (v) { return Number(v || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 }); };
  var d = function (s) { return s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—'; };
  var today = new Date().toISOString().slice(0, 10);
  var LAB = { emise: 'Émise', partielle: 'Partielle', payee: 'Payée' };

  function fail(msg) { app.innerHTML = '<div class="card err"><b>' + esc(msg) + '</b><p class="mut">Demandez un nouveau lien à votre station.</p></div>'; }
  function table(head, rows) {
    return '<div class="tw"><table><thead><tr>' + head.map(function (h, i) { return '<th' + (h[1] ? ' class="n"' : '') + '>' + esc(h[0]) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  fetch('/api/public/portal/' + encodeURIComponent(tok), { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
    if (!x.ok) return fail((x.j && x.j.error) || 'Lien invalide ou expiré');
    var p = x.j, cur = p.station.currency || 'FCFA';
    document.getElementById('who').textContent = p.customer.name;
    document.getElementById('st').textContent = p.station.name + (p.station.phone ? ' · ' + p.station.phone : '');
    document.title = 'Espace client — ' + p.station.name;
    var h = '<div class="card"><div class="kpis"><div class="kpi"><small>Solde à régler</small><b class="' + (p.balance > 0 ? 'due' : 'ok') + '">' + n(p.balance) + ' ' + esc(cur) + '</b></div>' +
      (p.credit_limit > 0 ? '<div class="kpi"><small>Limite de crédit</small><b>' + n(p.credit_limit) + '</b></div><div class="kpi"><small>Crédit disponible</small><b>' + n(p.available) + '</b></div>' : '') + '</div></div>';
    h += '<div class="card"><h2>Factures</h2>' + (p.invoices.length ? table([['N°'], ['Date'], ['Échéance'], ['Total', 1], ['Payé', 1], ['Reste', 1], ['Statut']], p.invoices.map(function (i) {
      var rest = Math.max(0, i.total - i.paid), late = i.status !== 'payee' && i.due_date && i.due_date < today;
      return '<tr><td>' + esc(i.invoice_no) + '</td><td>' + d(i.issued_on) + '</td><td class="' + (late ? 'due' : '') + '">' + d(i.due_date) + (late ? ' (échue)' : '') + '</td><td class="n">' + n(i.total) + '</td><td class="n">' + n(i.paid) + '</td><td class="n">' + n(rest) + '</td><td><span class="tag ' + esc(i.status) + '">' + esc(LAB[i.status] || i.status) + '</span></td></tr>';
    })) : '<p class="mut">Aucune facture.</p>') + '</div>';
    h += '<div class="card"><h2>Mes achats (90 derniers jours)</h2>' + (p.purchases.length ? p.purchases.map(function (s) {
      return '<details><summary>' + esc(s.at) + ' · <b>' + n(s.total) + ' ' + esc(cur) + '</b>' + (s.invoice_no ? ' <span class="mut">' + esc(s.invoice_no) + '</span>' : '') + '</summary><ul>' + (s.lines || []).map(function (l) { return '<li>' + esc(l.product) + ' — ' + n(l.qty) + ' ' + esc(l.unit || '') + ' · ' + n(l.amount) + '</li>'; }).join('') + '</ul></details>';
    }).join('<hr style="border:0;border-top:1px solid var(--br);margin:8px 0">') : '<p class="mut">Aucun achat sur la période.</p>') + '</div>';
    h += '<div class="card"><h2>Mes règlements</h2>' + (p.payments.length ? table([['Date'], ['Montant', 1], ['Mode']], p.payments.map(function (y) { return '<tr><td>' + d(y.at) + '</td><td class="n">' + n(y.amount) + '</td><td>' + esc(y.method) + '</td></tr>'; })) : '<p class="mut">Aucun règlement enregistré.</p>') + '</div>';
    app.innerHTML = h;
    document.getElementById('foot').textContent = 'Lien personnel, en lecture seule — valable jusqu\'au ' + d(p.expires_on) + '. Ne le partagez pas.';
  }).catch(function () { fail('Connexion impossible. Réessayez plus tard.'); });
})();
