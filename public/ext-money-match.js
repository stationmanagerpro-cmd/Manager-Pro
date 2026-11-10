/* ext-money-match.js — rapprochement ligne à ligne d'un compte Mobile Money / banque (voir src/money_match.js).
   Ouvre une fenêtre depuis Trésorerie › Rapprochement : import du relevé (texte collé), lignes, mouvements non rapprochés. */
(function () {
  'use strict';
  if (typeof G === 'undefined' || typeof Po === 'undefined') return;
  var can_ = function (p) { try { return can(p); } catch (_) { return false; } };
  var fd = function (s) { return s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—'; };
  var money = function (v) { var n = Number(v) || 0; return (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n)); };
  var ST = { rapprochee_auto: ['Rapprochée (auto)', 'pt-green'], rapprochee_manuelle: ['Rapprochée (manuel)', 'pt-green'], a_rapprocher: ['À rapprocher', 'pt-red'], ignoree: ['Ignorée', 'pt-zero'] };
  var cur = null;

  async function render(accId) {
    cur = accId;
    var d = await G('/money/reconcile-lines?account_id=' + accId + '&from=' + (window.__mmFrom || '2000-01-01'));
    var s = d.summary, mg = can_('money.manage');
    var lines = d.lines.map(function (l) {
      var st = ST[l.status] || [l.status, ''];
      var act = !mg ? '' : l.status === 'a_rapprocher'
        ? '<button type="button" class="b2" onclick="mmPick(' + l.id + ',' + l.amount + ')">Rapprocher…</button> <button type="button" class="b2" onclick="mmIgnore(' + l.id + ')">Ignorer</button>'
        : l.status === 'ignoree' ? '<button type="button" class="b2" onclick="mmUnmatch(' + l.id + ')">Rouvrir</button>'
        : '<button type="button" class="b2" onclick="mmUnmatch(' + l.id + ')">Annuler</button>';
      return '<tr><td>' + fd(l.line_date) + '</td><td>' + esc(l.label || '') + '<small class="pt-sub">' + esc(l.reference || '') + (l.note ? ' · ' + esc(l.note) : '') + '</small></td><td class="pc-num">' + money(l.amount) + '</td><td><span class="' + st[1] + '">' + st[0] + '</span></td><td>' + act + '</td></tr>';
    }).join('');
    var mv = d.unmatched_movements.map(function (m) {
      return '<tr><td>' + fd(m.moved_on) + '</td><td>' + esc(m.label || m.kind) + '<small class="pt-sub">' + esc(m.reference || '') + '</small></td><td class="pc-num">' + money(m.amount) + '</td></tr>';
    }).join('');
    modal('<h3>Rapprochement — ' + esc(d.account.name) + '</h3>' +
      '<p class="pc-empty" style="text-align:left">À rapprocher : <b>' + s.pending_lines + '</b> ligne(s) (' + money(s.pending_amount) + ') · Rapprochées : <b>' + s.matched_lines + '</b> · Écritures absentes du relevé : <b>' + s.unmatched_movements + '</b> (' + money(s.unmatched_movements_amount) + ')</p>' +
      (mg ? '<label>Coller le relevé de l’opérateur (une ligne par opération : <code>date ; libellé ; référence ; montant</code>, montant négatif pour une sortie)<textarea id="mm-txt" rows="4" placeholder="06/11/2026;Paiement client;MP123;5000"></textarea></label><div class="r"><button type="button" onclick="mmImport()">Importer et rapprocher</button></div>' : '') +
      '<div class="tr-sec">LIGNES DU RELEVÉ</div>' + (lines ? '<div class="pc-tw"><table class="pc-tbl"><thead><tr><th>Date</th><th>Libellé</th><th class="pc-num">Montant</th><th>Statut</th><th></th></tr></thead><tbody>' + lines + '</tbody></table></div>' : '<p class="pc-empty">Aucune ligne importée.</p>') +
      '<div class="tr-sec">ÉCRITURES ABSENTES DU RELEVÉ</div>' + (mv ? '<div class="pc-tw"><table class="pc-tbl"><thead><tr><th>Date</th><th>Libellé</th><th class="pc-num">Montant</th></tr></thead><tbody>' + mv + '</tbody></table></div>' : '<p class="pc-empty">Aucune.</p>') +
      '<div class="r" style="margin-top:12px"><button type="button" class="b2" onclick="closeM()">Fermer</button></div>');
  }
  window.treLines = function (accId) { return render(accId).catch(function (e) { toast(e.message || String(e), 'error'); }); };
  window.mmImport = async function () {
    var t = document.getElementById('mm-txt'); if (!t || !t.value.trim()) return toast('Collez le relevé', 'error');
    try { var r = await Po('/money/statement-lines/import', { account_id: cur, text: t.value });
      toast(r.inserted + ' ligne(s) importée(s), ' + r.matched + ' rapprochée(s)' + (r.duplicates ? ', ' + r.duplicates + ' déjà connue(s)' : '') + (r.rejected && r.rejected.length ? ', ' + r.rejected.length + ' rejetée(s) : ' + r.rejected[0].error : ''), r.rejected && r.rejected.length ? 'error' : 'success');
      render(cur); } catch (e) { toast(e.message || String(e), 'error'); }
  };
  window.mmPick = async function (lineId, amount) {
    try {
      var d = await G('/money/reconcile-lines?account_id=' + cur);
      var same = d.unmatched_movements.filter(function (m) { return Number(m.amount) === Number(amount); });
      if (!same.length) return toast('Aucune écriture de ' + money(amount) + ' à rapprocher. Saisissez l’écriture manquante ou ignorez la ligne.', 'error');
      var m = same[0];
      if (same.length > 1 && !confirm(same.length + ' écritures ont ce montant. Rapprocher avec la plus récente (' + fd(m.moved_on) + ' — ' + (m.label || m.kind) + ') ?')) return;
      await Po('/money/statement-lines/' + lineId + '/match', { movement_id: Number(m.id) }); toast('Rapprochée', 'success'); render(cur);
    } catch (e) { toast(e.message || String(e), 'error'); }
  };
  window.mmIgnore = async function (lineId) {
    var why = prompt('Motif (obligatoire) — ex. frais opérateur, erreur du relevé :'); if (!why) return;
    try { await Po('/money/statement-lines/' + lineId + '/ignore', { reason: why }); render(cur); } catch (e) { toast(e.message || String(e), 'error'); }
  };
  window.mmUnmatch = async function (lineId) {
    try { await Po('/money/statement-lines/' + lineId + '/unmatch', {}); render(cur); } catch (e) { toast(e.message || String(e), 'error'); }
  };
})();
