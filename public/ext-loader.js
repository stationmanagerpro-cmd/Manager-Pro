/* Icône d'actualisation : visible tant que l'écran n'est pas repris (réponse lente du serveur, redémarrage après déploiement).
 * Masquée dès que le contenu de la page est affiché, ou si l'écran de connexion apparaît. Après 8 s : bouton « Recharger ». */
(function () {
  'use strict';
  var tk = null; try { tk = localStorage.getItem('smp-tk'); } catch (_) {}
  if (!tk) return;   // pas de session : l'écran de connexion s'affiche, rien à attendre
  var el, t0 = Date.now(), timer;
  function build() {
    if (el || !document.body) return;
    el = document.createElement('div');
    el.id = 'smp-loader'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    var src = '/icons/icon-192.png'; try { src = localStorage.getItem('smp-ld-logo') || src; } catch (_) {}
    el.innerHTML = '<span class="smp-ld-ring" aria-hidden="true"><img class="smp-ld-logo" alt="" src="' + src + '"></span><b>Actualisation en cours…</b>' +
      '<small class="smp-ld-diag"></small><button type="button" class="smp-ld-btn" onclick="location.reload()">Recharger la page</button>';
    document.body.appendChild(el);
  }
  /* Logo actif de la PLATEFORME (administré par le Super Admin) — jamais celui d'une station/client. Mémorisé pour l'affichage immédiat suivant. */
  function loadLogo() {
    try {
      fetch('/api/branding', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (b) {
        if (!b) return;
        var u = b.has_logo ? '/api/branding/logo?v=' + encodeURIComponent(b.v == null ? '' : b.v) : '/icons/icon-192.png';
        try { localStorage.setItem('smp-ld-logo', u); } catch (_) {}
        var im = el && el.querySelector('.smp-ld-logo'); if (im && im.getAttribute('src') !== u) im.src = u;
      }).catch(function () {});
    } catch (_) {}
  }
  /* Diagnostic affiché seulement quand c'est lent : fichiers chargés + appels les plus longs (en cours ou terminés). */
  function diag() {
    var d = el && el.querySelector('.smp-ld-diag'); if (!d) return;
    var now = performance.now(), L = (window.__apiLog || []).map(function (x) { return { p: x.p, s: ((x.t1 || now) - x.t0) / 1000, w: !x.t1 }; });
    L.sort(function (a, b) { return b.s - a.s; });
    var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
    var f = nav && nav.loadEventEnd > 0 ? 'Fichiers : ' + (nav.loadEventEnd / 1000).toFixed(1) + ' s' : 'Fichiers : en cours';
    d.textContent = f + (L.length ? ' · ' + L.slice(0, 3).map(function (x) { return x.p + ' ' + x.s.toFixed(1) + ' s' + (x.w ? ' (attente)' : ''); }).join(' · ') : ' · aucun appel serveur');
  }
  function ready() {
    var pg = document.getElementById('pg'), lg = document.getElementById('login');
    if (lg && lg.querySelector('.login-shell')) return true;   // connexion demandée
    if (document.documentElement.dataset.heroPending) return false;
    return !!(pg && pg.children.length && !pg.querySelector('.skeleton'));
  }
  function tick() {
    build();
    if (ready()) { if (el) el.remove(); clearInterval(timer); return; }
    if (el && Date.now() - t0 > 8000) { el.classList.add('slow'); diag(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { build(); loadLogo(); timer = setInterval(tick, 250); });
  else { build(); loadLogo(); timer = setInterval(tick, 250); }
})();
