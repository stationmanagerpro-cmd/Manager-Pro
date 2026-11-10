/* Enveloppe automatiquement tout tableau non protégé dans un conteneur à défilement horizontal (petits écrans). */
(function () {
  'use strict';
  const SKIP = '.tw, .dv2-tw, .tw-auto, .wa-app';
  function wrap(t) {
    if (t.dataset.rwd || t.closest(SKIP) || t.closest('#app-header')) return;
    t.dataset.rwd = '1';
    const w = document.createElement('div'); w.className = 'tw-auto';
    t.parentNode.insertBefore(w, t); w.appendChild(t);
  }
  const scan = root => (root.querySelectorAll ? root.querySelectorAll('table') : []).forEach(wrap);
  let queued = false;
  const obs = new MutationObserver(() => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; scan(document); });
  });
  function start() { scan(document); obs.observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
