/* ext-report-tools.js — Outils communs des écrans de rapport : filtre « entre deux dates » + export PDF.
   Utilisé par : Cartes flotte, Commissions Mobile Money, Journal financier, Fin de journée, Rapprochement (+ export PDF : Mes stations, Carte des stations).
   - RT.register(key, { view, defFrom, defTo, pdf })  : déclare l'écran (view = clé passée à go(), pdf() = options du rapport)
   - RT.bar(key)       : HTML « Date de début · Date de fin · Filtrer · Réinitialiser · Exporter en PDF »
   - RT.query(key)     : 'from=AAAA-MM-JJ&to=AAAA-MM-JJ' (période appliquée, sinon période par défaut de l'écran, sinon '')
   - RT.range(key)     : { from, to } | null      RT.label(key) : « du JJ/MM/AAAA au JJ/MM/AAAA »
   - RT.pdf(opts)      : génère le rapport via le moteur commun (POST /api/docs/render → logo, couleurs, pied de page, pagination A4)
   Règles de dates : début ≤ fin ; jours de début et de fin INCLUS (le serveur compare des jours entiers, heure locale).
   Le PDF reprend exactement la période et les filtres appliqués à l'écran. */
(function () {
  'use strict';
  if (window.RT) return;

  const REG = {}, STATE = {};
  const PDF_PERMS = ['report.view', 'finance.view', 'accounting.view', 'accounting.manage', 'money.manage', 'cash.manage', 'settings.edit', 'audit.view'];   // = droits acceptés par /api/docs/render
  const x = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const iso = d => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const today = () => iso(new Date());
  const valid = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(v + 'T00:00:00').getTime()) && iso(new Date(v + 'T00:00:00')) === v;
  const fr = v => (valid(v) ? v.split('-').reverse().join('/') : '');
  const slot = k => STATE[k] || (STATE[k] = { applied: null });
  const val = v => (typeof v === 'function' ? v() : v);
  const canPdf = () => typeof can === 'function' && PDF_PERMS.some(p => { try { return !!can(p); } catch (_) { return false; } });
  const msg = (m, t) => { if (typeof toast === 'function') toast(m, t); };

  function register(key, cfg) { REG[key] = cfg || {}; }
  function applied(key) { return slot(key).applied; }
  function range(key) {
    const a = applied(key); if (a) return a;
    const c = REG[key] || {}, f = val(c.defFrom), t = val(c.defTo);
    return valid(f) && valid(t) ? { from: f, to: t } : null;
  }
  const query = key => { const r = range(key); return r ? 'from=' + r.from + '&to=' + r.to : ''; };
  const label = key => { const r = range(key); return r ? (r.from === r.to ? 'le ' + fr(r.from) : 'du ' + fr(r.from) + ' au ' + fr(r.to)) : 'Toutes les dates'; };

  /** Valide un couple de dates : renvoie un message d'erreur ou ''. */
  function check(from, to) {
    if (!valid(from) || !valid(to)) return 'Renseignez la date de début et la date de fin.';
    if (from > to) return 'La date de début ne peut pas être postérieure à la date de fin.';
    return '';
  }

  function bar(key, opts) {
    opts = opts || {};
    const r = range(key), a = applied(key);
    const from = r ? r.from : '', to = r ? r.to : '';
    const state = a ? 'Filtre actif : ' + label(key) : (r ? 'Période par défaut : ' + label(key) : 'Aucun filtre : toutes les dates');
    return '<div class="rt-bar card" data-rt="' + x(key) + '" role="group" aria-label="Filtre par période">' +
      '<label>Date de début<input type="date" class="rt-from" value="' + x(from) + '"></label>' +
      '<label>Date de fin<input type="date" class="rt-to" value="' + x(to) + '"></label>' +
      '<button type="button" class="rt-go" onclick="RT.apply(\'' + x(key) + '\')">Filtrer</button>' +
      '<button type="button" class="b2 rt-reset" onclick="RT.reset(\'' + x(key) + '\')">Réinitialiser</button>' +
      (opts.noPdf || !canPdf() ? '' : '<button type="button" class="b2 rt-pdf" onclick="RT.exportPdf(\'' + x(key) + '\',this)" title="Générer un PDF des données affichées">📄 Exporter en PDF</button>') +
      '<span class="rt-state' + (a ? ' on' : '') + '">' + x(state) + '</span>' +
      '<p class="rt-err" role="alert" hidden></p></div>';
  }

  function apply(key) {
    const box = document.querySelector('.rt-bar[data-rt="' + key + '"]'); if (!box) return;
    const from = box.querySelector('.rt-from').value, to = box.querySelector('.rt-to').value;
    const err = box.querySelector('.rt-err'), e = check(from, to);
    if (e) { err.textContent = e; err.hidden = false; return; }
    err.hidden = true;
    slot(key).applied = { from, to };
    reload(key);
  }
  function reset(key) { slot(key).applied = null; reload(key); }
  function reload(key) { const c = REG[key]; if (c && c.view && typeof go === 'function') go(c.view); }

  async function exportPdf(key, btn) {
    const c = REG[key]; if (!c || typeof c.pdf !== 'function') return;
    if (!canPdf()) { msg('Droit insuffisant pour exporter ce rapport.', 'error'); return; }
    if (btn) btn.disabled = true;
    try {
      const o = await c.pdf();
      if (!o) return;
      await pdf(o);
    } catch (e) { msg((typeof errMsg === 'function' ? errMsg(e) : e && e.message) || 'Export PDF impossible', 'error'); }
    finally { if (btn) btn.disabled = false; }
  }

  /** Rapport PDF via le moteur commun. opts : { title, subtitle?, period?, ref?, sections, landscape?, filename? } */
  async function pdf(opts) {
    if (typeof window.brandedPdf !== 'function') { msg('Moteur PDF indisponible', 'error'); return false; }
    if (!opts || !opts.sections || !opts.sections.length) { msg('Rien à exporter', 'info'); return false; }
    const stamp = new Date(); const p2 = n => String(n).padStart(2, '0');
    const file = (opts.filename || opts.title || 'rapport') + '_' + iso(stamp);
    return window.brandedPdf(Object.assign({ ref: 'RPT-' + iso(stamp).replace(/-/g, '') + '-' + p2(stamp.getHours()) + p2(stamp.getMinutes()) }, opts, { filename: file }));
  }

  /** Aides de mise en forme des sections PDF. */
  const H = {
    cur: () => (typeof CUR !== 'undefined' ? CUR : 'FCFA'),
    num: v => Number(v) || 0,
    kv: (title, rows) => ({ type: 'kv', title, rows: rows.filter(Boolean).map(r => [r[0], r[1] == null || r[1] === '' ? '—' : r[1]]) }),
    kpis: (items, title) => ({ type: 'kpis', title, items }),
    dateTime: v => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
  };

  const css = document.createElement('style'); css.id = 'rt-style';
  css.textContent = '.rt-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;padding:12px 14px;margin:10px 0;text-align:left;position:relative}' +
    '.rt-bar label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--m)}' +
    '.rt-bar input[type=date]{font:inherit;padding:7px 8px;border:1px solid var(--bd);border-radius:8px;background:transparent;color:inherit;min-height:38px}' +
    '.rt-state{font-size:12px;color:var(--m);align-self:center}.rt-state.on{color:var(--p-text,var(--p));font-weight:700}' +
    '.rt-err{flex-basis:100%;margin:0;color:var(--r,#dc2626);font-size:12.5px;font-weight:600}.rt-err[hidden]{display:none}' +
    '.rt-bar .rt-pdf{margin-left:auto}@media (max-width:600px){.rt-bar .rt-pdf{margin-left:0}.rt-bar label{flex:1 1 130px}}' +
    '@media print{.rt-bar{display:none}}';
  document.head.appendChild(css);

  window.RT = { register, bar, apply, reset, range, query, label, applied, check, valid, fr, today, iso, exportPdf, pdf, canPdf, H };
})();
