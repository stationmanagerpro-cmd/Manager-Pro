/* CORR-044 — Relevé de fin de quart hors ligne (brouillon local).
 * La clôture reste faite par le serveur (aperçu, caisse attendue, écarts, verrouillage) : hors ligne, le pompiste saisit index finaux,
 * caisse comptée et paiements non espèces ; ces valeurs sont gardées sur l'appareil et préremplissent la clôture au retour du réseau.
 * Rien n'est jamais clôturé sans aperçu serveur. L'ouverture de quart exige le réseau. */
(function () {
  'use strict';
  var ID_RE = /^(c\d+|pm|pc|pk|cp|ec\d+|em\d+|ek\d+|er\d+|jus)$/, MAX_AGE_MS = 3 * 24 * 3600 * 1000;
  function sid() { return typeof SID !== 'undefined' && SID ? SID : 'x'; }
  var kShift = function () { return 'smp-close-shift:' + sid(); }, kDraft = function (shift) { return 'smp-close-draft:' + sid() + ':' + shift; };
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /** Valeurs saisies pertinentes d'un document : { id: valeur } (champs non vides uniquement). */
  function snapshot(doc) {
    var out = {}, els = doc.querySelectorAll('input[id],textarea[id]');
    for (var i = 0; i < els.length; i++) { var e = els[i]; if (ID_RE.test(e.id) && String(e.value).trim() !== '') out[e.id] = e.value; }
    return out;
  }
  function rememberShift(cu) {
    if (!cu || !cu.id || !Array.isArray(cu.counters)) return;
    lsSet(kShift(), { id: cu.id, number: cu.number, opened_at: cu.opened_at, counters: cu.counters, team: cu.team || [], cached_at: Date.now() });
  }
  function saveDraft() {
    if (typeof SH === 'undefined' || !SH || !SH.id) return false;
    var vals = snapshot(document);
    if (!Object.keys(vals).length) { lsDel(kDraft(SH.id)); return false; }
    return lsSet(kDraft(SH.id), { shift: SH.id, saved_at: Date.now(), values: vals });
  }
  function loadDraft(shiftId) { var d = lsGet(kDraft(shiftId)); if (!d || d.shift !== shiftId || Date.now() - d.saved_at > MAX_AGE_MS) return null; return d; }
  function applyDraft() {
    if (typeof SH === 'undefined' || !SH || !SH.id) return 0;
    var d = loadDraft(SH.id); if (!d) return 0;
    var n = 0; Object.keys(d.values).forEach(function (id) { if (!ID_RE.test(id)) return; var el = document.getElementById(id); if (el && el.value === '') { el.value = d.values[id]; n++; } });
    if (n && typeof toast === 'function') toast('Relevé hors ligne du ' + new Date(d.saved_at).toLocaleString('fr-FR') + ' rétabli (' + n + ' champs). Vérifiez avant de valider.', 'info');
    if (n && typeof pvd === 'function') pvd();
    return n;
  }
  function clearDraft(shiftId) { lsDel(kDraft(shiftId)); }

  function offlineForm() {
    var cu = lsGet(kShift());
    if (!cu) return '<div class="card"><b>Hors ligne</b><p>Le quart n’a jamais été chargé sur cet appareil : connectez-vous au réseau pour ouvrir l’écran de clôture une première fois.</p></div>';
    SH = cu;
    var multi = (cu.team || []).length >= 2, ex = typeof esc === 'function' ? esc : function (s) { return s; };
    var counters = cu.counters.map(function (c, i) { return '<tr><td>' + ex(c.pump) + '</td><td>' + c.counter_number + '</td><td>' + ex(c.product) + '</td><td>' + c.index_start + '</td><td><input id="c' + i + '" type="number" step="any" style="width:130px" oninput="pvd()"></td></tr>'; }).join('');
    var nonCash = multi && typeof empCloseBlock === 'function' ? empCloseBlock(cu, []) :
      '<h3>B. Carburant payé autrement qu’en espèces</h3><div class="g"><label>Mobile money<input id="pm" type="number" oninput="pvd()"></label><label>Carte<input id="pc" type="number" oninput="pvd()"></label><label>À crédit<input id="pk" type="number" oninput="pvd()"></label></div>';
    setTimeout(applyDraft, 50);
    return '<div class="card" style="border-left:4px solid var(--o)"><b>CLÔTURE DU QUART N° ' + ex(cu.number) + ' — RELEVÉ HORS LIGNE</b>' +
      '<p>Pas de réseau : saisissez vos relevés, ils sont <b>gardés sur cet appareil</b>. La clôture elle-même (aperçu, écarts, verrouillage) se fera au retour du réseau, relevés préremplis.</p>' +
      '<button class="b2" onclick="go(\'clot\')">Réessayer la connexion</button></div><h3>A. Compteurs</h3>' +
      '<div class="tw"><table><thead><tr><th>Pompe<th>Cpt<th>Produit<th>Initial<th>Final</tr></thead><tbody>' + counters + '</tbody></table></div>' + nonCash +
      '<h3>C. Caisse</h3><div class="g"><label>Caisse physique comptée<input id="cp" type="number" step="any" oninput="pvd()"></label></div>' +
      '<label>Justification des écarts et anomalies<textarea id="jus" rows="2" oninput="pvd()"></textarea></label>';
  }

  window.smpCloseDraft = { snapshot: snapshot, save: saveDraft, apply: applyDraft, clear: clearDraft, load: loadDraft, remember: rememberShift, offlineForm: offlineForm };
  window.smpCloseOfflineForm = offlineForm;

  // Mémorise le quart courant dès qu'il est lu avec succès (même hors de l'écran de clôture).
  var _api = window.api;
  if (typeof _api === 'function') {
    window.api = async function (m, p, b) {
      var r = await _api.apply(this, arguments);
      try { if (String(m || 'GET').toUpperCase() === 'GET' && String(p).split('?')[0] === '/shifts/current' && r) rememberShift(r); } catch (e) {}
      return r;
    };
  }
  window.addEventListener('online', function () { try { if (typeof cur !== 'undefined' && cur === 'clot' && typeof go === 'function') go('clot'); } catch (e) {} });
})();
