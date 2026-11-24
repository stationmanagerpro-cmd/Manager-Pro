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
    el.innerHTML = '<span class="smp-ld-ico" aria-hidden="true">↻</span><b>Actualisation en cours…</b>' +
      '<button type="button" class="smp-ld-btn" onclick="location.reload()">Recharger la page</button>';
    document.body.appendChild(el);
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
    if (el && Date.now() - t0 > 8000) el.classList.add('slow');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { build(); timer = setInterval(tick, 250); });
  else { build(); timer = setInterval(tick, 250); }
})();
