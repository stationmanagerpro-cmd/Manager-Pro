/* Calculatrice flottante : bouton accessible à tout moment dans la navigation (raccourci clavier Alt+C).
 * - Évaluateur maison (aucun eval : compatible avec la CSP du serveur).
 * - Clavier complet, historique de session (en mémoire uniquement, rien n'est stocké), copie et insertion du résultat dans le dernier champ utilisé.
 * - Visible uniquement une fois connecté (#app.ready) ; masqué à l'impression. */
(function () {
  'use strict';

  // ---------- Évaluateur : + − × ÷ ( ) et %, virgule ou point décimal ----------
  // « 200 + 10% » = 220 (pourcentage du premier terme) ; « 50 × 10% » = 5.
  class CalcError extends Error {}
  function evaluate(src) {
    const s = String(src).replace(/\s+/g, '').replace(/−|–|—/g, '-').replace(/[×x*]/gi, '*').replace(/÷/g, '/').replace(/,/g, '.');
    if (!s) throw new CalcError('Expression vide');
    if (!/^[0-9.+\-*/()%]+$/.test(s)) throw new CalcError('Expression invalide');
    let i = 0;
    const peek = () => s[i];
    function number() {
      const m = /^\d*\.?\d*/.exec(s.slice(i))[0];
      if (!m || m === '.') throw new CalcError('Expression invalide');
      i += m.length;
      return { v: Number(m), pct: false };
    }
    function primary() {
      if (peek() === '(') {
        i++; const r = expr(); if (peek() !== ')') throw new CalcError('Parenthèse manquante'); i++;
        return { v: r.v, pct: false };
      }
      return number();
    }
    function postfix() {
      let r = primary();
      while (peek() === '%') { i++; r = { v: r.v / 100, pct: true }; }
      return r;
    }
    function unary() {
      if (peek() === '-') { i++; const r = unary(); return { v: -r.v, pct: r.pct }; }
      if (peek() === '+') { i++; return unary(); }
      return postfix();
    }
    function term() {
      let l = unary();
      while (peek() === '*' || peek() === '/') {
        const op = s[i++], r = unary();
        if (op === '/' && r.v === 0) throw new CalcError('Division par 0');
        l = { v: op === '*' ? l.v * r.v : l.v / r.v, pct: false };
      }
      return l;
    }
    function expr() {
      let l = term();
      while (peek() === '+' || peek() === '-') {
        const op = s[i++], r = term();
        const rv = r.pct ? l.v * r.v : r.v;           // 200 + 10% → 200 + 20
        l = { v: op === '+' ? l.v + rv : l.v - rv, pct: false };
      }
      return l;
    }
    const out = expr();
    if (i < s.length) throw new CalcError('Expression invalide');
    if (!Number.isFinite(out.v)) throw new CalcError('Résultat invalide');
    return parseFloat(out.v.toPrecision(12));         // supprime les artefacts binaires (0,1 + 0,2)
  }
  const plain = n => { const t = String(n); if (/e/i.test(t)) throw new CalcError('Résultat trop grand'); return t.replace('.', ','); };
  const pretty = n => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 10 }).format(n);

  if (typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = { evaluate, plain }; return; }

  // ---------- Interface ----------
  const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="7" y="5" width="10" height="4" rx="1"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></svg>';
  const KEYS = [['C', 'C', 'op'], ['⌫', 'BK', 'op'], ['(', '(', 'op'], [')', ')', 'op'],
    ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '÷', 'op'], ['4', '4'], ['5', '5'], ['6', '6'], ['×', '×', 'op'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['−', '−', 'op'], ['0', '0'], [',', ','], ['%', '%', 'op'], ['+', '+', 'op'], ['=', '=', 'eq']];
  const st = { expr: '', done: false, label: '', hist: [], field: null };
  let btn, box, exprEl, resEl, insBtn, histEl;

  const isOp = c => '+−×÷'.includes(c);
  function press(k) {
    if (k === 'C') { st.expr = ''; st.done = false; return render(); }
    if (k === 'BK') { st.expr = st.done ? '' : st.expr.slice(0, -1); st.done = false; return render(); }
    if (k === '=') return equals();
    if (st.expr.length >= 120) return;
    const last = st.expr.slice(-1);
    if (/^[0-9]$/.test(k) || k === '(') {
      if (st.done) { st.expr = ''; st.done = false; }
      if (last === ')' || last === '%') { if (/^[0-9]$/.test(k)) st.expr += '×'; }
      st.expr += k;
    } else if (k === ',') {
      if (st.done) { st.expr = ''; st.done = false; }
      const seg = st.expr.split(/[+−×÷()%]/).pop();
      if (seg.includes(',')) return;
      st.expr += seg === '' ? '0,' : ',';
    } else if (k === ')') {
      if ((st.expr.match(/\(/g) || []).length > (st.expr.match(/\)/g) || []).length && !isOp(last) && last !== '(') st.expr += ')';
    } else if (k === '%') {
      if (/[0-9)]/.test(last)) { st.expr += '%'; st.done = false; }
    } else if (isOp(k)) {
      st.done = false;
      if (st.expr === '') { if (k === '−') st.expr = '−'; }
      else if (last === '(') { if (k === '−') st.expr += k; }
      else if (isOp(last)) st.expr = st.expr.slice(0, -1) + k;
      else st.expr += k;
    }
    render();
  }
  function equals() {
    if (!st.expr || st.done) return;
    try {
      const v = evaluate(st.expr), r = plain(v);
      st.hist.unshift([st.expr, r]); st.hist.length = Math.min(st.hist.length, 6);
      st.label = st.expr + ' ='; st.expr = r; st.done = true; render(null, v);
    } catch (e) { render(e instanceof CalcError ? e.message : 'Expression invalide'); }
  }
  function preview() {            // résultat en direct pendant la saisie
    if (!st.expr || st.done) return null;
    try { return evaluate(st.expr.replace(/[+−×÷(]+$/, '')); } catch (_) { return null; }
  }
  function fieldOk() { const f = st.field; return !!(f && f.isConnected && !f.disabled && !f.readOnly); }
  function render(err, final) {
    exprEl.textContent = st.done ? st.label : st.expr;
    resEl.classList.toggle('err', !!err);
    if (err) resEl.textContent = err;
    else if (st.done) resEl.textContent = pretty(final != null ? final : evaluate(st.expr));
    else { const p = preview(); resEl.textContent = p == null ? (st.expr ? '' : '0') : pretty(p); }
    insBtn.disabled = !fieldOk() || !(st.done || preview() != null);
    histEl.replaceChildren(...st.hist.map(([e, r]) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `${e} = ${pretty(Number(r.replace(',', '.')))}`; b.title = 'Réutiliser ce résultat';
      b.onclick = () => { st.label = e + ' ='; st.expr = r; st.done = true; render(null, Number(r.replace(',', '.'))); box.focus(); };
      return b;
    }));
  }
  function currentValue() { if (!st.done) equals(); return st.done ? plain(evaluate(st.expr)) : null; }
  async function copy() {
    const v = currentValue(); if (v == null) return;
    try { await navigator.clipboard.writeText(v); typeof toast === 'function' && toast('Résultat copié'); }
    catch (_) { typeof toast === 'function' && toast('Copie impossible : sélectionnez le résultat manuellement'); }
  }
  function insert() {
    const v = currentValue(); if (v == null || !fieldOk()) return;
    const f = st.field; f.focus();
    f.value = v.replace(',', '.');                   // les champs numériques et montants attendent le point décimal
    f.dispatchEvent(new Event('input', { bubbles: true })); f.dispatchEvent(new Event('change', { bubbles: true }));
    typeof toast === 'function' && toast('Résultat inséré dans le champ');
  }

  function open() { box.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); render(); box.focus(); }
  function close() { box.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); if (st.field && st.field.isConnected) st.field.focus(); else btn.focus(); }
  const toggle = () => (box.classList.contains('open') ? close() : open());

  function build() {
    btn = document.createElement('button'); btn.id = 'smp-calc-btn'; btn.type = 'button'; btn.innerHTML = ICON;
    btn.title = 'Calculatrice (Alt+C)'; btn.setAttribute('aria-label', 'Ouvrir la calculatrice'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'smp-calc');
    btn.onclick = toggle;
    box = document.createElement('div'); box.id = 'smp-calc'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Calculatrice'); box.tabIndex = -1;
    box.innerHTML = '<div class="cc-head"><span>Calculatrice</span><button type="button" class="cc-x" aria-label="Fermer">×</button></div>'
      + '<div class="cc-screen"><div class="cc-expr"></div><div class="cc-res" aria-live="polite">0</div></div>'
      + '<div class="cc-keys">' + KEYS.map(([l, k, c]) => `<button type="button" data-k="${k}" class="${c || ''}">${l}</button>`).join('') + '</div>'
      + '<div class="cc-act"><button type="button" class="cc-copy">Copier</button><button type="button" class="cc-ins" title="Insère le résultat dans le dernier champ utilisé">Insérer dans le champ</button></div>'
      + '<div class="cc-hist" aria-label="Historique de la session"></div>';
    exprEl = box.querySelector('.cc-expr'); resEl = box.querySelector('.cc-res'); insBtn = box.querySelector('.cc-ins'); histEl = box.querySelector('.cc-hist');
    box.querySelector('.cc-x').onclick = close; box.querySelector('.cc-copy').onclick = copy; insBtn.onclick = insert;
    box.querySelector('.cc-keys').onclick = e => { const b = e.target.closest('button[data-k]'); if (b) press(b.dataset.k); };
    // Garde le focus (et donc le dernier champ actif) lors d'un clic sur le clavier à l'écran
    box.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    box.addEventListener('paste', e => {
      const t = (e.clipboardData || window.clipboardData).getData('text').replace(/\s/g, '').replace(/\./g, ',');
      if (/^[0-9,+\-−×÷*/()%x]+$/i.test(t)) { e.preventDefault(); st.expr = t.replace(/-/g, '−').replace(/[*x]/gi, '×').replace(/\//g, '÷').slice(0, 120); st.done = false; render(); }
    });
    document.body.append(btn, box);
  }

  const MAP = { '*': '×', x: '×', X: '×', '/': '÷', '-': '−', '.': ',', ',': ',', '+': '+', '(': '(', ')': ')', '%': '%', Enter: '=', '=': '=', Backspace: 'BK', c: 'C', C: 'C' };
  document.addEventListener('keydown', e => {
    if (!btn) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'c' || e.key === 'C')) { if (btn.classList.contains('on')) { e.preventDefault(); toggle(); } return; }
    if (!box.classList.contains('open')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    // Ne capte les touches que si le focus est dans la calculatrice : on ne gêne jamais la saisie d'un formulaire
    if (!box.contains(document.activeElement) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = /^[0-9]$/.test(e.key) ? e.key : MAP[e.key];
    if (k) { e.preventDefault(); press(k); }
  });
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (!t || !t.matches || !t.matches('input, textarea') || (box && box.contains(t))) return;
    if (['checkbox', 'radio', 'file', 'button', 'submit', 'password', 'date', 'time', 'datetime-local', 'month', 'color', 'range'].includes(t.type)) { st.field = null; return; }
    st.field = t;
  });

  function sync() {
    const app = document.getElementById('app'), on = !!(app && app.classList.contains('ready'));
    if (!btn) build();
    btn.classList.toggle('on', on);
    if (!on && box.classList.contains('open')) { box.classList.remove('open'); st.expr = ''; st.done = false; st.hist = []; st.field = null; }   // déconnexion : on efface la session
  }
  function init() {
    sync();
    const app = document.getElementById('app');
    if (app) new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
