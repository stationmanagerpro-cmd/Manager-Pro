/* Cuves et jaugeage : liste des cuves, saisie de jauge, tableau d'écarts (stock mesuré vs théorique). CORR-038 / CORR-039 */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  var LEVEL = {
    ok: { t: 'Conforme', s: 'background:color-mix(in srgb,var(--g) 15%,transparent);color:var(--g)' },
    warning: { t: 'À surveiller', s: 'background:color-mix(in srgb,#d97706 18%,transparent);color:#b45309' },
    critical: { t: 'Critique', s: 'background:color-mix(in srgb,var(--r) 15%,transparent);color:var(--r)' },
    info: { t: 'Incomplet', s: 'background:color-mix(in srgb,#64748b 15%,transparent);color:#475569' }
  };
  var state = { from: null, to: null };

  function L(n) { return n == null ? '—' : Number(n).toLocaleString(typeof loc === 'function' ? loc() : 'fr-FR', { maximumFractionDigits: 1 }) + ' L'; }
  function badge(level) { var l = LEVEL[level] || LEVEL.info; return '<span class="tag" style="' + l.s + '">' + l.t + '</span>'; }
  function localInput(d) { var p = function (x) { return String(x).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function canEdit() { return typeof can === 'function' && can('settings.edit'); }
  function canMeasure() { return typeof can === 'function' && (can('stock.adjust') || can('shift.close') || can('settings.edit')); }

  function reconRows(res) {
    if (!res.products.length) return '<tr><td colspan="10" class="muted">Aucune cuve active : créez d’abord vos cuves.</td></tr>';
    return res.products.map(function (p) {
      if (p.status !== 'calcule') {
        var miss = (p.missing || []).map(function (m) { return esc(m.name) + ' (jauge de ' + m.what + ')'; }).join(', ');
        return '<tr><td>' + esc(p.product_name) + '</td><td colspan="8" class="muted">' + (p.status === 'sans_cuve' ? 'Aucune cuve.' : 'Jauges manquantes : ' + (miss || '—')) + '</td><td>' + badge('info') + '</td></tr>';
      }
      var col = p.level === 'critical' ? 'var(--r)' : p.level === 'warning' ? '#b45309' : 'inherit';
      return '<tr><td><b>' + esc(p.product_name) + '</b>' + (p.tanks.length > 1 ? '<br><span class="muted">' + p.tanks.length + ' cuves</span>' : '') + '</td>' +
        '<td>' + L(p.opening) + '</td><td>+ ' + L(p.received) + '</td><td>' + (p.other ? (p.other > 0 ? '+ ' : '− ') + L(Math.abs(p.other)) : '—') + '</td><td>− ' + L(p.pumped) + '</td>' +
        '<td>' + L(p.theoretical) + '</td><td>' + L(p.closing) + '</td>' +
        '<td style="color:' + col + ';font-weight:600">' + (p.variance > 0 ? '+' : '') + L(p.variance) + (p.variance_pct != null ? '<br><span class="muted">' + p.variance_pct + ' %</span>' : '') + '</td>' +
        '<td>± ' + L(p.tolerance) + '</td><td>' + badge(p.level) + (p.diagnosis ? '<div class="muted" style="font-size:12px;margin-top:4px">' + esc(p.diagnosis) + '</div>' : '') + '</td></tr>';
    }).join('');
  }

  async function vCuves() {
    var tanks = await G('/tanks');
    if (!state.to) { var n = new Date(); state.to = localInput(n); state.from = localInput(new Date(n.getTime() - 864e5)); }
    var html = '<h2 style="margin-top:0">Cuves et jaugeage</h2>' +
      '<p class="muted">Saisissez la jauge de chaque cuve à l’ouverture et à la clôture du quart (en litres). Le système compare le stock mesuré au stock théorique : jauge d’ouverture + réceptions − litres pompés.</p>' +
      '<div class="bar" style="flex-wrap:wrap;gap:8px"><button class="b2" onclick="go(\'cuves\')">Actualiser</button>' + (canEdit() ? '<button class="b1" onclick="tankAdd()">Nouvelle cuve</button>' : '') + '</div>' +
      '<div class="card"><table><thead><tr><th>Cuve</th><th>Produit</th><th>Capacité</th><th>Dernière jauge</th><th>Remplissage</th><th>Date</th><th></th></tr></thead><tbody>' +
      (tanks.length ? tanks.map(function (t) {
        var low = t.alert_threshold > 0 && t.last_quantity != null && Number(t.last_quantity) < Number(t.alert_threshold);
        return '<tr><td><b>' + esc(t.name) + '</b></td><td>' + esc(t.product_name) + '</td><td>' + L(t.capacity_liters) + '</td><td>' + L(t.last_quantity) + (low ? ' <span class="tag x">Niveau bas</span>' : '') + '</td><td>' +
          (t.fill_pct != null ? t.fill_pct + ' %' : '—') + '</td><td>' + (t.last_measured_at ? dt(t.last_measured_at) : 'Jamais jaugée') + '</td><td>' +
          (canMeasure() ? '<button class="b2" onclick="tankMeasure(' + t.id + ',\'' + esc(String(t.name).replace(/'/g, '’')) + '\')">Jauger</button> ' : '') +
          '<button class="b2" onclick="tankHistory(' + t.id + ')">Historique</button></td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">Aucune cuve enregistrée.' + (canEdit() ? ' Cliquez sur « Nouvelle cuve ».' : '') + '</td></tr>') +
      '</tbody></table></div>' +
      '<h3>Écarts de stock en cuve</h3><div class="bar" style="flex-wrap:wrap;gap:8px;align-items:end">' +
      '<label>Du<input type="datetime-local" id="tk_from" value="' + state.from + '"></label><label>Au<input type="datetime-local" id="tk_to" value="' + state.to + '"></label>' +
      '<button class="b1" onclick="tankReconcile()">Calculer</button></div><div id="tk_res" class="muted" style="margin-top:8px">Choisissez la période puis cliquez sur « Calculer ».</div>';
    setTimeout(function () { if (document.getElementById('tk_res')) window.tankReconcile(); }, 0);
    return html;
  }

  window.tankReconcile = async function () {
    var box = document.getElementById('tk_res'); if (!box) return;
    var f = document.getElementById('tk_from').value, t = document.getElementById('tk_to').value;
    state.from = f; state.to = t;
    try {
      var res = await G('/tanks/reconcile?from=' + encodeURIComponent(new Date(f).toISOString()) + '&to=' + encodeURIComponent(new Date(t).toISOString()));
      box.className = '';
      box.innerHTML = '<div class="card"><p style="margin:0 0 8px">Résultat global : ' + badge(res.level) + ' <span class="muted">· tolérance ' + res.tolerance_pct + ' % des litres pompés</span></p>' +
        '<div style="overflow:auto"><table><thead><tr><th>Produit</th><th>Ouverture</th><th>Réceptions</th><th>Autres</th><th>Pompé</th><th>Théorique</th><th>Mesuré</th><th>Écart</th><th>Tolérance</th><th>Statut</th></tr></thead><tbody>' + reconRows(res) + '</tbody></table></div>' +
        '<p class="muted" style="font-size:12px;margin:8px 0 0">Les jauges d’ouverture et de clôture sont la dernière jauge de chaque cuve avant le début et avant la fin de la période. Litres pompés : compteurs des quarts clôturés dans la période.</p></div>';
    } catch (e) { box.className = 'warn'; box.textContent = typeof errMsg === 'function' ? errMsg(e) : (e.message || e); }
  };

  window.tankMeasure = function (id, name) {
    form('Jauge — cuve ' + name, [['quantity', 'Jauge (litres)', 'number'], ['notes', 'Observation (facultatif)']], {}, async function (d) {
      if (!(d.quantity >= 0) || d.quantity === 0 && !confirm('Confirmer une jauge à 0 litre (cuve vide) ?')) throw new Error('Jauge non enregistrée');
      var r = await Po('/tanks/' + id + '/measurements', { quantity: d.quantity, notes: d.notes || undefined });
      closeM();
      var rec = r.reconciliation;
      if (rec && rec.status === 'calcule' && rec.level !== 'ok') toast('Jauge enregistrée — écart de ' + L(rec.variance) + ' (' + (LEVEL[rec.level] || LEVEL.info).t.toLowerCase() + ')' + (r.alert && r.alert.sent ? ' · gérant alerté' : ''), 'error');
      else toast('Jauge enregistrée' + (rec && rec.status === 'calcule' ? ' — écart conforme' : ''), 'success');
      go('cuves');
    });
  };

  window.tankAdd = async function () {
    var products = await G('/products').catch(function () { return []; });
    var fuels = (products || []).filter(function (p) { return p.category_has_meter; });   // carburants : catégories à compteur
    var opts = (fuels.length ? fuels : products || []).map(function (p) { return [p.id, p.name]; });
    if (!opts.length) { toast('Créez d’abord un produit carburant', 'error'); return; }
    form('Nouvelle cuve', [['product_id', 'Produit', 's', opts], ['name', 'Nom de la cuve'], ['capacity_liters', 'Capacité (litres)', 'number'], ['alert_threshold', 'Seuil de niveau bas (litres)', 'number']], {}, async function (d) {
      await Po('/tanks', { product_id: Number(d.product_id), name: d.name, capacity_liters: d.capacity_liters || undefined, alert_threshold: d.alert_threshold || 0 });
      closeM(); toast('Cuve créée', 'success'); go('cuves');
    });
  };

  window.tankHistory = async function (id) {
    var rows = await G('/tanks/' + id + '/measurements?limit=30');
    modal('<h3>Historique des jauges</h3><div style="max-height:55vh;overflow:auto"><table><thead><tr><th>Date</th><th>Jauge</th><th>Observation</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (m) { return '<tr><td>' + dt(m.measured_at) + '</td><td>' + L(m.quantity) + '</td><td>' + esc(m.notes || '') + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="muted">Aucune jauge.</td></tr>') +
      '</tbody></table></div><div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
  };

  V.cuves = ['Cuves et jaugeage', 'report.view|stock.adjust|shift.close|settings.edit'];
  VM.cuves = vCuves;
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.cuves = '🛢️';
})();
