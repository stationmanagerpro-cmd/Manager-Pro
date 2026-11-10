/* table-fit.js — tableaux lisibles sur téléphone
 * 1) Aligne les colonnes de montants à droite (libellé + valeurs) et laisse les textes longs revenir à la ligne
 * 2) Quand un tableau est plus large que l'écran : affiche sous le tableau un petit curseur (glisser / toucher /
 *    flèches ‹ ›) pour aller jusqu'au bout facilement. Le glissement du doigt sur le tableau fonctionne toujours.
 * Aucune dépendance. Ne touche ni aux données ni aux fonctions existantes.
 */
(function () {
  'use strict';
  if (window.__tableFit) return;
  window.__tableFit = true;

  var HOST_SEL = '.tw,.tw-auto,.dv2-tw,.table-wrap';
  var NUM = /^[-−+]?\d[\d\s\u00a0\u202f.,]*(\s?(FCFA|XOF|CFA|F|%|L|l|kg|€|\$))?$/;
  var SKIP_HEAD = /t[ée]l|phone|mobile|contact|n°|num[ée]ro|code|matricule|r[ée]f|\bid\b|date|heure|ann[ée]e|mois|jour|plaque/i;
  var LONG_TEXT = 38;
  var hasRO = typeof ResizeObserver === 'function';
  var ro = hasRO ? new ResizeObserver(function (entries) {
    entries.forEach(function (e) { var h = e.target.__tfHost || e.target; sync(h); });
  }) : null;

  function txt(c) { return (c.textContent || '').replace(/\s+/g, ' ').trim(); }

  /* ---------- 1) Alignement des colonnes ---------- */
  function alignTable(t) {
    var sig = t.rows.length + ':' + (t.textContent || '').length;
    if (t.__tfSig === sig) return;
    t.__tfSig = sig;
    var head = t.tHead && t.tHead.rows.length ? t.tHead.rows[t.tHead.rows.length - 1] : null;
    var body = [];
    Array.prototype.forEach.call(t.tBodies, function (tb) {
      Array.prototype.forEach.call(tb.rows, function (r) { body.push(r); });
    });
    if (!body.length) return;
    var n = head ? head.cells.length : body[0].cells.length;
    var rows = body.filter(function (r) {
      if (r.cells.length !== n) return false;
      for (var k = 0; k < r.cells.length; k++) if (r.cells[k].colSpan > 1) return false;
      return true;
    });
    for (var i = 0; i < n; i++) {
      var vals = [], cells = [];
      rows.forEach(function (r) { var c = r.cells[i]; cells.push(c); var v = txt(c); if (v) vals.push(v); });
      var h = head ? head.cells[i] : null;
      var isNum = vals.length > 0 && !(h && SKIP_HEAD.test(txt(h))) && vals.every(function (v) { return NUM.test(v); });
      if (h) h.classList.toggle('tf-num', isNum);
      cells.forEach(function (c) { c.classList.toggle('tf-num', isNum); });
    }
    rows.forEach(function (r) {
      Array.prototype.forEach.call(r.cells, function (c) {
        if (c.classList.contains('tf-num')) return;
        c.classList.toggle('tf-wrap', txt(c).length > LONG_TEXT && !c.querySelector('button,input,select,a.b,a.b2'));
      });
    });
  }

  /* ---------- 2) Curseur de défilement horizontal ---------- */
  function hostOf(t) {
    var p = t.parentElement;
    if (!p) return null;
    if (p.matches(HOST_SEL)) return p;
    var ox = getComputedStyle(p).overflowX;
    if ((ox === 'auto' || ox === 'scroll') && p !== document.body) return p;
    var w = document.createElement('div');
    w.className = 'table-wrap';
    p.insertBefore(w, t);
    w.appendChild(t);
    return w;
  }

  function buildRail(host) {
    var r = document.createElement('div');
    r.className = 'tf-rail';
    r.setAttribute('aria-hidden', 'true');
    r.innerHTML = '<button type="button" class="tf-btn" tabindex="-1" data-d="-1">‹</button>' +
      '<div class="tf-track"><div class="tf-thumb"></div></div>' +
      '<button type="button" class="tf-btn" tabindex="-1" data-d="1">›</button>';
    host.parentNode.insertBefore(r, host.nextSibling);
    host.__tfRail = r;

    var track = r.querySelector('.tf-track'), thumb = r.querySelector('.tf-thumb');
    r.querySelectorAll('.tf-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        host.scrollBy({ left: (+b.getAttribute('data-d')) * Math.max(120, host.clientWidth * 0.8), behavior: 'smooth' });
      });
    });
    function maxScroll() { return Math.max(0, host.scrollWidth - host.clientWidth); }
    function ratio() { var tw = track.clientWidth, w = thumb.offsetWidth; return (tw - w) > 0 ? maxScroll() / (tw - w) : 0; }
    var drag = null;
    thumb.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, left: host.scrollLeft };
      try { thumb.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    thumb.addEventListener('pointermove', function (e) {
      if (!drag) return;
      host.scrollLeft = drag.left + (e.clientX - drag.x) * ratio();
    });
    function end() { drag = null; }
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    track.addEventListener('pointerdown', function (e) {
      if (e.target === thumb) return;
      var rect = track.getBoundingClientRect(), w = thumb.offsetWidth;
      var x = Math.min(Math.max(e.clientX - rect.left - w / 2, 0), rect.width - w);
      host.scrollLeft = x * ratio();
    });
    host.addEventListener('scroll', function () { sync(host); }, { passive: true });
    return r;
  }

  function sync(host) {
    if (!host || !host.isConnected) return;
    var over = host.scrollWidth > host.clientWidth + 2;
    host.classList.toggle('tf-on', over);
    var r = host.__tfRail;
    if (!over) { if (r) r.hidden = true; return; }
    if (!r) r = buildRail(host);
    r.hidden = false;
    var track = r.querySelector('.tf-track'), thumb = r.querySelector('.tf-thumb');
    var tw = track.clientWidth;
    if (!tw) return;
    var w = Math.max(44, Math.min(tw, tw * host.clientWidth / host.scrollWidth));
    var max = host.scrollWidth - host.clientWidth;
    var x = max > 0 ? (host.scrollLeft / max) * (tw - w) : 0;
    thumb.style.width = w + 'px';
    thumb.style.transform = 'translateX(' + Math.max(0, x) + 'px)';
  }

  function fit(t) {
    if (t.hasAttribute('data-no-fit') || t.closest('#smp-calc,[data-no-fit]')) return;
    try { alignTable(t); } catch (_) {}
    var host = hostOf(t);
    if (!host) return;
    if (!host.__tfWatched) {
      host.__tfWatched = true;
      if (ro) { host.__tfHost = host; t.__tfHost = host; ro.observe(host); ro.observe(t); }
    }
    sync(host);
  }

  function scan() {
    var list = document.querySelectorAll('#pg table, #m table');
    for (var i = 0; i < list.length; i++) fit(list[i]);
  }

  var timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = 0; scan(); }, 80);
  }

  function start() {
    scan();
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.target && m.target.closest && m.target.closest('.tf-rail')) continue;
        schedule();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.addEventListener('load', schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  }

  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
