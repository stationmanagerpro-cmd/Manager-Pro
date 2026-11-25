/* Icône d'actualisation : réservée aux écrans VIDES (réponse lente du serveur, redémarrage après déploiement).
 * - Apparaît seulement si l'écran reste vide plus de 1,2 s (pas d'éclair à chaque actualisation rapide).
 * - Disparaît dès que la page est affichée, même si ses cartes attendent encore leurs données : les cases de chargement
 *   et le message « Chargement en cours… » (.sk-wait, après 6 s) prennent le relais.
 * - Après 8 s sur un écran vide : bouton « Recharger ». */
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
      '<button type="button" class="smp-ld-btn" onclick="location.reload()">Recharger la page</button>';
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
  function ready() {
    var pg = document.getElementById('pg'), lg = document.getElementById('login');
    if (lg && lg.querySelector('.login-shell')) return true;   // connexion demandée
    if (document.documentElement.dataset.heroPending) return false;
    return !!(pg && pg.children.length && !pg.querySelector('.skeleton'));
  }
  function shellShown() {   // page affichée (bandeau décidé, contenu ou cases de chargement présents)
    var pg = document.getElementById('pg');
    return !document.documentElement.dataset.heroPending && !!(pg && pg.children.length);
  }
  function tick() {
    if (ready()) { if (el) el.remove(); clearInterval(timer); return; }
    var age = Date.now() - t0, show;
    if (shellShown()) show = age > 8000 && !document.querySelector('.sk-wait');   // données lentes : .sk-wait s'en charge
    else show = age > 1200;                                                       // écran vide
    if (show) { build(); if (el && age > 8000) el.classList.add('slow'); }
    else if (el) { el.remove(); el = null; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { loadLogo(); timer = setInterval(tick, 250); });
  else { loadLogo(); timer = setInterval(tick, 250); }
})();
