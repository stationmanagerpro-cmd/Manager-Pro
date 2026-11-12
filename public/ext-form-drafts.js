/* ext-form-drafts.js — brouillons automatiques des formulaires + bouton « Initialiser ».
   • Tout formulaire ouvert en fenêtre (#m) garde ce qui est saisi sur l'appareil : si on le quitte par erreur
     (retour, clic à côté, actualisation, fermeture de l'application), la saisie est rétablie à la réouverture.
   • Le brouillon est effacé dès que l'enregistrement réussit (requête d'écriture acceptée par le serveur).
   • « ↺ Initialiser » remet le formulaire à son état de départ et supprime le brouillon (aussi sur l'écran de clôture de quart).
   • Jamais sauvegardés : mots de passe, codes PIN, fichiers, champs en lecture seule ; ni les écrans de modification d'une fiche existante. */
(function () {
  'use strict';
  var MAX_AGE = 3 * 24 * 3600 * 1000;
  var SKIP_TITLE = /modifi|éditer|editer|\bedit|renomm|supprim|connexion|mot de passe|password|\bpin\b/i;
  var SKIP_FIELD = /pass|mdp|pin|secret|token|otp/i;
  var tstate = { key: null, struct: '', timer: null, done: false, restored: false, ready: false };
  var sid = function () { try { return typeof SID !== 'undefined' && SID ? SID : 'x'; } catch (_) { return 'x'; } };
  var uid = function () { try { return typeof ME !== 'undefined' && ME && ME.id ? ME.id : 'u'; } catch (_) { return 'u'; } };
  var lsGet = function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (_) { return null; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* stockage plein ou indisponible */ } };
  var lsDel = function (k) { try { localStorage.removeItem(k); } catch (_) { /* rien */ } };
  var $m = function () { return document.getElementById('m'); };
  var visible = function () { var m = $m(); return !!(m && m.style.display !== 'none' && m.innerHTML.trim()); };

  function fields(root) {
    return [].filter.call(root.querySelectorAll('input,textarea,select'), function (e) {
      if (e.disabled || e.readOnly) return false;
      var t = (e.type || '').toLowerCase();
      if (/^(password|file|hidden|button|submit|reset|image)$/.test(t)) return false;
      return !SKIP_FIELD.test((e.id || '') + ' ' + (e.name || '') + ' ' + (e.autocomplete || ''));
    });
  }
  var fid = function (e, i) { return e.id || e.name || ('#' + i); };
  var isDirty = function (e) {
    if (e.tagName === 'SELECT') return [].some.call(e.options, function (o) { return o.selected !== o.defaultSelected; });
    if (e.type === 'checkbox' || e.type === 'radio') return e.checked !== e.defaultChecked;
    return e.value !== e.defaultValue;
  };
  function titleOf(root) { var h = root.querySelector('h2,h3,h4'); return h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) : ''; }

  function snap(root) {
    var out = {}; fields(root).forEach(function (e, i) {
      if (!isDirty(e)) return;
      out[fid(e, i)] = (e.type === 'checkbox' || e.type === 'radio') ? e.checked : e.value;
    });
    return out;
  }
  function save() {
    var m = $m(); if (!tstate.key || tstate.done || !tstate.ready || !m || !visible()) return;   // « ready » : après la tentative de rétablissement, pour ne pas effacer le brouillon d'un formulaire à peine rouvert
    var vals = snap(m);
    if (!Object.keys(vals).length) { lsDel(tstate.key); return; }
    lsSet(tstate.key, { saved_at: Date.now(), struct: tstate.struct, values: vals });
  }
  function fire(e) { try { e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) { /* vieux moteur */ } }

  function resetForm(root) {
    fields(root).forEach(function (e) {
      if (e.tagName === 'SELECT') [].forEach.call(e.options, function (o) { o.selected = o.defaultSelected; });
      else if (e.type === 'checkbox' || e.type === 'radio') e.checked = e.defaultChecked;
      else e.value = e.defaultValue;
      fire(e);
    });
    if (tstate.key) lsDel(tstate.key);
    var b = root.querySelector('[data-draft-note]'); if (b) b.remove();
    if (typeof toast === 'function') toast('Formulaire initialisé', 'success');
  }

  function setup() {
    var m = $m(); tstate.restored = false;
    if (!m || !visible()) { tstate.key = null; return; }
    var inner = m.firstElementChild || m, title = titleOf(inner), fs = fields(inner);
    if (!fs.length || !title || SKIP_TITLE.test(title)) { tstate.key = null; return; }
    var struct = fs.map(fid).join('|');
    var key = 'smp-fdraft:' + sid() + ':' + uid() + ':' + title;
    if (tstate.key === key && tstate.struct === struct && inner.querySelector('[data-draft-reset]')) return;   // déjà équipé
    tstate = { key: key, struct: struct, timer: null, done: false, restored: false, ready: false };

    // bouton « Initialiser » dans la rangée d'actions
    var row = inner.querySelector('.r:last-of-type') || inner.querySelector('.r');
    if (row && fs.length >= 2 && !row.querySelector('[data-draft-reset]')) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'b2'; b.setAttribute('data-draft-reset', '1');
      b.textContent = '↺ Initialiser'; b.title = 'Vider la saisie et repartir de zéro'; b.onclick = function () { resetForm(inner); };
      row.insertBefore(b, row.firstChild);
    }
    // rétablissement différé : laisse les formulaires finir de charger leurs valeurs par défaut
    setTimeout(function () {
      if (tstate.key !== key || !visible()) return;
      var d = lsGet(key);
      if (!d || Date.now() - d.saved_at > MAX_AGE) { if (d) lsDel(key); tstate.ready = true; return; }
      if (d.struct !== struct) { lsDel(key); tstate.ready = true; return; }
      var n = 0;
      fields(inner).forEach(function (e, i) {
        var id = fid(e, i); if (!(id in d.values) || isDirty(e)) return;
        if (e.type === 'checkbox' || e.type === 'radio') e.checked = !!d.values[id]; else e.value = d.values[id];
        fire(e); n++;
      });
      if (n) {
        tstate.restored = true;
        var note = document.createElement('div'); note.setAttribute('data-draft-note', '1'); note.className = 'noprint';
        note.style.cssText = 'background:#fff7e0;border:1px solid #f0c36d;color:#7a5200;border-radius:8px;padding:6px 10px;margin:0 0 8px;font-size:12px';
        note.textContent = '📝 Votre saisie précédente (' + new Date(d.saved_at).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ') a été rétablie. Utilisez « ↺ Initialiser » pour repartir de zéro.';
        inner.insertBefore(note, inner.firstChild.nextSibling || null);
      }
      tstate.ready = true;
    }, 450);
  }

  // saisie → brouillon
  document.addEventListener('input', function (ev) {
    if (!tstate.key || !ev.target.closest || !ev.target.closest('#m')) return;
    clearTimeout(tstate.timer); tstate.timer = setTimeout(save, 300);
  }, true);
  document.addEventListener('change', function (ev) {
    if (!tstate.key || !ev.target.closest || !ev.target.closest('#m')) return;
    clearTimeout(tstate.timer); tstate.timer = setTimeout(save, 300);
  }, true);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); });

  // enregistrement réussi → brouillon effacé
  var of = window.fetch;
  if (typeof of === 'function') window.fetch = function (input, init) {
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    var url = String(typeof input === 'string' ? input : (input && input.url) || '');
    var p = of.apply(this, arguments);
    if (method !== 'GET' && method !== 'HEAD' && /\/api\//.test(url) && !/docs\/render|\/auth\/|\/log\b|\/track|\/push\//.test(url)) {
      var key = tstate.key;
      p.then(function (r) { if (r && r.ok && key && tstate.key === key) { tstate.done = true; lsDel(key); } }, function () { /* hors ligne : brouillon conservé */ });
    }
    return p;
  };

  var mo = new MutationObserver(function () { clearTimeout(setup.t); setup.t = setTimeout(setup, 60); });
  function arm() { var m = $m(); if (m) mo.observe(m, { childList: true, attributes: true, attributeFilter: ['style'] }); else setTimeout(arm, 500); }
  arm();

  // Écran de clôture de quart : bouton « Initialiser » (le brouillon propre à la clôture est géré par smpCloseDraft)
  var ID_RE = /^(c\d+|pm|pc|pk|cp|ec\d+|em\d+|ek\d+|er\d+|jus|obs|s\d+)$/;
  function closeBtn() {
    var pg = document.getElementById('pg'), box = pg && pg.querySelector('#pvbox');
    if (!box || pg.querySelector('#smp-close-reset')) return;
    var b = document.createElement('button'); b.type = 'button'; b.id = 'smp-close-reset'; b.className = 'b2 noprint'; b.textContent = '↺ Initialiser la saisie';
    b.style.margin = '6px 0'; b.title = 'Vider tous les index et montants saisis';
    b.onclick = function () {
      var run = function () {
        pg.querySelectorAll('input,textarea,select').forEach(function (e) { if (e.id && ID_RE.test(e.id)) { e.value = ''; } });
        try { if (window.smpCloseDraft && typeof SH !== 'undefined' && SH) smpCloseDraft.clear(SH.id); } catch (_) { /* rien */ }
        try { if (typeof pvd === 'function') pvd(); } catch (_) { /* rien */ }
        if (typeof toast === 'function') toast('Saisie de clôture initialisée', 'success');
      };
      if (typeof ask === 'function') ask('Vider tous les index et montants saisis sur cet écran ?', run); else run();
    };
    box.parentNode.insertBefore(b, box);
  }
  var pgObs = new MutationObserver(function () { clearTimeout(closeBtn.t); closeBtn.t = setTimeout(closeBtn, 200); });
  (function armPg() { var pg = document.getElementById('pg'); if (pg) pgObs.observe(pg, { childList: true, subtree: true }); else setTimeout(armPg, 500); })();

  window.smpFormDrafts = { reset: function () { var m = $m(); if (m && m.firstElementChild) resetForm(m.firstElementChild); }, state: function () { return tstate; } };
})();
