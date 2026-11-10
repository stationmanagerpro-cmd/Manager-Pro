/* ext-time24.js — heures toujours affichées au format 24 h (18:34 et non 06:34 PM), quelle que soit la langue du navigateur.
   Chargé avant tous les autres scripts : complète les options de Date#toLocaleTimeString / Date#toLocaleString
   (messagerie, journaux, rapports…) avec hourCycle « h23 », sauf si le code appelant impose déjà hour12 / hourCycle. */
(function () {
  'use strict';
  if (window.__time24) return; window.__time24 = true;
  const P = Date.prototype;
  const withH23 = o => {
    const x = Object.assign({}, o || {});
    if (x.hour12 === undefined && x.hourCycle === undefined) x.hourCycle = 'h23';
    return x;
  };
  ['toLocaleTimeString', 'toLocaleString'].forEach(m => {
    const orig = P[m];
    P[m] = function (loc, opts) { return orig.call(this, loc, withH23(opts)); };
  });
})();
