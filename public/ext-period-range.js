/* ext-period-range.js — Période commune des profils (produit, client, fournisseur, employé) :
   raccourcis « 30 j · 3 mois · 12 mois · Tout » + bouton « 📅 Personnalisé » (calendrier : du … au …).
   État partagé : la période choisie reste la même d'une fiche à l'autre pendant la session.
   Les dates sont envoyées au serveur sous la forme ?period=custom&from=AAAA-MM-JJ&to=AAAA-MM-JJ. */
(function () {
  'use strict';
  if (window.PRange) return;

  const PRESETS = { '30d': '30 j', '3m': '3 mois', '12m': '12 mois', all: 'Tout' };
  const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const today = () => iso(new Date());
  const esc2 = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const validDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T00:00:00').getTime());

  const state = { period: '12m', from: null, to: null };

  function query() {
    if (state.period === 'custom' && validDay(state.from) && validDay(state.to)) {
      return 'period=custom&from=' + state.from + '&to=' + state.to;
    }
    return 'period=' + (PRESETS[state.period] ? state.period : '12m');
  }
  // Après une réponse du serveur : on s'aligne sur la période réellement appliquée
  function sync(meta) {
    if (!meta) return;
    if (meta.period === 'custom' && meta.from && meta.to) { state.period = 'custom'; state.from = meta.from; state.to = meta.to; }
    else { state.period = PRESETS[meta.period] ? meta.period : '12m'; state.from = state.to = null; }
  }
  const key = () => (state.period === 'custom' ? 'du-' + state.from + '-au-' + state.to : state.period);

  // Raccourcis de dates pour le calendrier
  function quick(name) {
    const n = new Date(), y = n.getFullYear(), m = n.getMonth();
    if (name === 'month') return [iso(new Date(y, m, 1)), today()];
    if (name === 'lastmonth') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (name === 'year') return [iso(new Date(y, 0, 1)), today()];
    if (name === 'lastyear') return [iso(new Date(y - 1, 0, 1)), iso(new Date(y - 1, 11, 31))];
    return [today(), today()];
  }

  /* HTML du sélecteur. onPreset / onCustom = noms de fonctions globales :
       onPreset('30d')   onCustom('2026-01-01', '2026-03-31')
     extra = tableau d'arguments supplémentaires (ex. ['customers', 12]) placés avant la valeur. */
  function seg(meta, onPreset, onCustom, extra) {
    const cur = meta && meta.period, list = Array.isArray(extra) ? extra : [];
    const ex = list.length ? JSON.stringify(list).slice(1, -1).replace(/"/g, "'") + ',' : '';
    const btns = Object.keys(PRESETS).map(p => `<button type="button" class="${p === cur ? 'on' : ''}" aria-pressed="${p === cur}" onclick="${onPreset}(${ex}'${p}')">${PRESETS[p]}</button>`).join('');
    const isC = cur === 'custom';
    const from = isC && meta.from ? meta.from : quick('month')[0], to = isC && meta.to ? meta.to : today();
    return `<div class="ps-seg" role="group" aria-label="Période">${btns}<button type="button" class="pr-cal-btn ${isC ? 'on' : ''}" aria-pressed="${isC}" aria-haspopup="dialog" onclick="PRange.toggle(this)" title="Choisir deux dates dans le calendrier">📅 <span>${isC ? esc2(meta.label) : 'Personnalisé'}</span></button></div>
      <div class="pr-pop" role="dialog" aria-label="Période personnalisée" hidden data-on-custom="${onCustom}" data-extra="${esc2(JSON.stringify(list))}">
        <div class="pr-fields">
          <label>Du<input type="date" class="pr-from" value="${esc2(from)}" max="${today()}"></label>
          <label>Au<input type="date" class="pr-to" value="${esc2(to)}" max="${today()}"></label>
        </div>
        <div class="pr-quick" aria-label="Raccourcis">
          <button type="button" class="b2" onclick="PRange.fill(this,'month')">Ce mois</button>
          <button type="button" class="b2" onclick="PRange.fill(this,'lastmonth')">Mois dernier</button>
          <button type="button" class="b2" onclick="PRange.fill(this,'year')">Cette année</button>
          <button type="button" class="b2" onclick="PRange.fill(this,'lastyear')">Année dernière</button>
        </div>
        <p class="pr-err" hidden></p>
        <div class="pr-actions"><button type="button" class="b2" onclick="PRange.close()">Annuler</button><button type="button" onclick="PRange.apply(this)">Appliquer</button></div>
      </div>`;
  }

  function popOf(el) { const tools = el.closest('.ps-tools') || el.closest('.ps-head') || document; return tools.querySelector('.pr-pop'); }
  function toggle(btn) {
    const pop = popOf(btn); if (!pop) return;
    const open = pop.hidden; close();
    if (open) { pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); const f = pop.querySelector('.pr-from'); if (f) f.focus(); }
  }
  function close() {
    document.querySelectorAll('.pr-pop').forEach(p => { p.hidden = true; });
    document.querySelectorAll('.pr-cal-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  }
  function fill(btn, name) {
    const pop = btn.closest('.pr-pop'); if (!pop) return;
    const [a, b] = quick(name);
    pop.querySelector('.pr-from').value = a; pop.querySelector('.pr-to').value = b;
  }
  function apply(btn) {
    const pop = btn.closest('.pr-pop'); if (!pop) return;
    const from = pop.querySelector('.pr-from').value, to = pop.querySelector('.pr-to').value, err = pop.querySelector('.pr-err');
    const fail = m => { err.textContent = m; err.hidden = false; };
    if (!validDay(from) || !validDay(to)) return fail('Choisissez les deux dates.');
    if (from > to) return fail('La date de début doit précéder la date de fin.');
    if (to > today()) return fail('La date de fin ne peut pas être dans le futur.');
    err.hidden = true;
    const fn = window[pop.dataset.onCustom];
    close();
    let extra = [];
    try { extra = JSON.parse(pop.dataset.extra || '[]'); } catch (_) { extra = []; }
    if (typeof fn === 'function') fn.apply(null, extra.concat([from, to]));
  }

  document.addEventListener('click', ev => { if (!ev.target.closest('.pr-pop') && !ev.target.closest('.pr-cal-btn')) close(); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });

  const css = document.createElement('style'); css.id = 'pr-style';
  css.textContent = `.ps-tools{position:relative}.ps-seg{flex-wrap:wrap}.pr-cal-btn{white-space:nowrap}.pr-pop{position:absolute;right:0;top:calc(100% + 6px);z-index:60;width:min(340px,92vw);background:var(--c,#fff);color:inherit;border:1px solid var(--bd);border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.22);padding:14px;display:flex;flex-direction:column;gap:10px}
.pr-pop[hidden]{display:none}.pr-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pr-fields label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--m)}.pr-fields input{font:inherit;padding:8px;border:1px solid var(--bd);border-radius:8px;background:transparent;color:inherit;min-height:38px}
.pr-quick{display:flex;flex-wrap:wrap;gap:6px}.pr-quick button{font-size:12px;padding:4px 10px}.pr-actions{display:flex;justify-content:flex-end;gap:8px}.pr-err{margin:0;color:var(--r,#dc2626);font-size:12px}
@media (max-width:600px){.pr-pop{left:0;right:0;width:auto}}`;
  document.head.appendChild(css);

  window.PRange = { state, query, sync, key, seg, toggle, close, fill, apply, PRESETS };
})();
