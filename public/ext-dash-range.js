/* ext-dash-range.js — Filtre « entre 2 dates » du Tableau de bord.
   Un seul bouton (« 01-11-2026 - 08-11-2026 ») ouvre un panneau : raccourcis (Défaut, Aujourd'hui, Hier, 7 / 30 derniers jours,
   Ce mois-ci, Le mois dernier, …) + « Gamme personnalisée » (deux calendriers Du / Au) + Appliquer / Annuler.
   Liaison aux données : « Appliquer » écrit la période dans les variables globales du tableau de bord (P, CA, CB — lues par range()),
   puis relance go('dash') : tous les blocs (KPI, indicateurs financiers, agrégats détaillés, graphique, dernières ventes)
   sont alors rechargés côté serveur avec ?from=AAAA-MM-JJ&to=AAAA-MM-JJ. */
(function () {
  'use strict';
  if (window.DashRange) return;

  const MAX_DAYS = 366;   // même plafond que le serveur (dashboardRange : 365 jours après la date de début)
  const ITEMS = [
    ['default', 'Défaut'], ['today', "Aujourd'hui"], ['yday', 'Hier'], ['d7', 'Les 7 derniers jours'], ['d30', 'Les 30 derniers jours'],
    ['month', 'Ce mois-ci'], ['lastmonth', 'Le mois dernier'], ['week', 'Cette semaine'], ['quarter', 'Ce trimestre'], ['year', 'Cette année'],
    ['custom', 'Gamme personnalisée']
  ];
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const todayIso = () => iso(new Date());
  const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && iso(new Date(v + 'T12:00:00')) === v;
  const fmt = s => (validDay(s) ? s.slice(8, 10) + '-' + s.slice(5, 7) + '-' + s.slice(0, 4) : '');
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) + 1;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const code = c => (c === 'default' ? 'today' : c);
  // Configuration de l'écran qui affiche le sélecteur (par défaut : Tableau de bord → variables globales P / CA / CB).
  //   opts = { get: () => code, rng: code => [du, au], set: (code, du, au) => void }
  const DEFAULT_CFG = {
    get: () => (typeof P === 'string' ? P : 'today'),
    rng: c => (typeof range === 'function' ? range(c) : [todayIso(), todayIso()]),
    set: (c, a, b) => { if (c === 'custom') { CA = a; CB = b; } P = c; go('dash'); }
  };
  let cfg = DEFAULT_CFG;
  const rng = c => cfg.rng(code(c));
  const cur = () => cfg.get();

  let sel = null;   // raccourci en cours de sélection dans le panneau (pas encore appliqué)

  function label() { const [a, b] = rng(cur()); return fmt(a) + ' - ' + fmt(b); }

  function html(opts) {
    cfg = opts ? Object.assign({}, DEFAULT_CFG, opts) : DEFAULT_CFG;
    sel = cur();
    const [a, b] = rng(sel);
    const items = ITEMS.map(([k, l]) => `<button type="button" class="dr-it ${k === sel ? 'on' : ''}" data-k="${k}" onclick="DashRange.pick('${k}')">${esc(l)}</button>`).join('');
    return `<div class="dr" id="dr-root">
  <button type="button" class="dr-btn" aria-haspopup="dialog" aria-expanded="false" aria-label="Période du tableau de bord" onclick="DashRange.toggle(event)"><span class="pi" aria-hidden="true">📅</span><span class="dr-txt">${esc(label())}</span><span class="dr-car" aria-hidden="true">▾</span></button>
  <div class="dr-pop" role="dialog" aria-label="Choisir la période" hidden>
    <div class="dr-list">${items}</div>
    <div class="dr-fields">
      <label>Du<input type="date" class="dr-from" value="${esc(a)}" max="${todayIso()}" ${sel === 'custom' ? '' : 'disabled'}></label>
      <label>Au<input type="date" class="dr-to" value="${esc(b)}" max="${todayIso()}" ${sel === 'custom' ? '' : 'disabled'}></label>
    </div>
    <p class="dr-err" role="alert" hidden></p>
    <div class="dr-actions"><button type="button" class="dr-ok" onclick="DashRange.apply()">Appliquer</button><button type="button" class="dr-no" onclick="DashRange.close()">Annuler</button></div>
  </div>
</div>`;
  }

  const root = () => document.getElementById('dr-root');
  const pop = () => { const r = root(); return r ? r.querySelector('.dr-pop') : null; };
  const showErr = m => { const p = pop(); if (!p) return; const e = p.querySelector('.dr-err'); e.textContent = m || ''; e.hidden = !m; };

  function close() {
    const p = pop(); if (p) p.hidden = true;
    const b = root() && root().querySelector('.dr-btn'); if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggle(ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    const p = pop(), b = root() && root().querySelector('.dr-btn'); if (!p) return;
    if (!p.hidden) return close();
    sel = cur(); pick(sel, true); showErr('');
    p.hidden = false; b.setAttribute('aria-expanded', 'true');
    // Bascule à gauche si le panneau déborderait de l'écran (téléphone)
    p.style.left = 'auto'; p.style.right = '0';
    const r = p.getBoundingClientRect();
    if (r.left < 8) { p.style.right = 'auto'; p.style.left = '0'; }
  }
  // Choix d'un raccourci : on remplit les deux dates (lecture seule) ; « Gamme personnalisée » les rend modifiables.
  function pick(k, silent) {
    const p = pop(); if (!p) return;
    sel = k;
    p.querySelectorAll('.dr-it').forEach(x => x.classList.toggle('on', x.dataset.k === k));
    const f = p.querySelector('.dr-from'), t = p.querySelector('.dr-to'), custom = k === 'custom';
    if (!custom) { const [a, b] = rng(k); f.value = a; t.value = b; }
    else if (!silent) { if (!validDay(f.value)) f.value = todayIso(); if (!validDay(t.value)) t.value = todayIso(); }
    f.disabled = t.disabled = !custom;
    showErr('');
    if (custom && !silent) f.focus();
  }
  function apply() {
    const p = pop(); if (!p) return;
    if (sel !== 'custom') { const [x, y] = rng(sel); close(); return cfg.set(code(sel), x, y); }
    const a = p.querySelector('.dr-from').value, b = p.querySelector('.dr-to').value;
    if (!validDay(a) || !validDay(b)) return showErr('Choisissez les deux dates.');
    if (a > b) return showErr('La date de début doit précéder la date de fin.');
    if (b > todayIso()) return showErr('La date de fin ne peut pas être dans le futur.');
    if (daysBetween(a, b) > MAX_DAYS) return showErr('La période ne peut pas dépasser ' + MAX_DAYS + ' jours.');
    close(); cfg.set('custom', a, b);
  }

  document.addEventListener('click', ev => { if (!ev.target.closest || !ev.target.closest('#dr-root')) close(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });

  const css = document.createElement('style'); css.id = 'dr-style';
  css.textContent = `.dr{position:relative;display:inline-block}
.dr-btn{display:inline-flex;align-items:center;gap:10px;background:transparent;border:0;padding:0;font:inherit;font-weight:600;color:var(--t);cursor:pointer;min-height:24px;box-shadow:none}
.dr-btn .pi{font-size:18px}.dr-car{color:var(--m);font-size:11px}
.dr-pop{position:absolute;right:0;top:calc(100% + 14px);z-index:70;width:min(300px,92vw);background:var(--c,#fff);color:var(--t);border:1px solid var(--bd);border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:12px;display:flex;flex-direction:column;gap:10px}
.dr-pop[hidden]{display:none}
.dr-list{display:flex;flex-direction:column;gap:4px;max-height:min(60vh,450px);overflow:auto}
.dr-it{text-align:left;background:var(--bg,#f1f5f9);color:var(--p,#2563eb);border:0;border-radius:6px;padding:8px 12px;font-size:13.5px;font-weight:500;cursor:pointer;box-shadow:none;min-height:36px}
.dr-it:hover{filter:brightness(.96)}.dr-it.on{background:var(--p,#2563eb);color:#fff}
.dr-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dr-fields label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--m)}
.dr-fields input{font:inherit;padding:8px;border:1px solid var(--bd);border-radius:8px;background:transparent;color:inherit;min-height:38px;min-width:0}
.dr-fields input:disabled{opacity:.65}
.dr-err{margin:0;color:var(--r,#dc2626);font-size:12px}.dr-err[hidden]{display:none}
.dr-actions{display:flex;gap:8px}.dr-actions button{border:0;border-radius:6px;padding:8px 16px;font-weight:600;cursor:pointer;min-height:36px}
.dr-ok{background:var(--p,#2563eb);color:#fff}.dr-no{background:var(--bd,#e2e8f0);color:var(--t)}`;
  document.head.appendChild(css);

  window.DashRange = { html, toggle, close, pick, apply, label, fmt, ITEMS, MAX_DAYS };
})();
