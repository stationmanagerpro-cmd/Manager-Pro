/* ext-magasins.js — Interface moderne « Mes stations » (ex. Magasins & dépôts)
   Gestion multi-sites : stocks indépendants, caisses par magasin et comparaison des performances.
   Remplace / enrichit la page « Mes stations ». */
(function () {
  'use strict';

  let magState = { period: 'month', tab: 'compare', q: '' }; // sites | caisses | compare

  function periodBounds(key) {
    const n = new Date();
    const y = n.getFullYear(), m = n.getMonth(), d = n.getDate();
    const iso = (dt) => {
      const z = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);
      return z.toISOString().slice(0, 10);
    };
    if (key === 'today') return [iso(n), iso(n)];
    if (key === '7d') { const f = new Date(n); f.setDate(d - 6); return [iso(f), iso(n)]; }
    if (key === 'month') return [iso(new Date(y, m, 1)), iso(n)];
    if (key === 'lastmonth') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
    if (key === 'quarter') {
      const q = Math.floor(m / 3) * 3;
      return [iso(new Date(y, q, 1)), iso(n)];
    }
    if (key === 'year') return [iso(new Date(y, 0, 1)), iso(n)];
    return [null, null];
  }

  function money(v) {
    const n = Number(v) || 0;
    if (typeof f === 'function') return f(n);
    return n.toLocaleString('fr-FR') + ' FCFA';
  }

  function barPct(val, max) {
    const p = max > 0 ? Math.round((Number(val) || 0) / max * 100) : 0;
    return Math.max(0, Math.min(100, p));
  }

  window.magSetPeriod = function (p) {
    magState.period = p;
    if (typeof go === 'function') go('stations');
  };
  window.magSetTab = function (t) {
    magState.tab = t;
    if (typeof go === 'function') go('stations');
  };

  window.magSetQ = function (el) {
    magState.q = (el && el.value || '').trim();
    // Filtrage instantané des lignes / cartes marquées data-mag-name
    var q = magState.q.toLowerCase();
    document.querySelectorAll('[data-mag-name]').forEach(function (node) {
      var hay = (node.getAttribute('data-mag-name') || '').toLowerCase();
      node.style.display = (!q || hay.indexOf(q) !== -1) ? '' : 'none';
    });
  };

  /** Partage résumé Mes stations (Web Share API ou presse-papiers) */
  window.magShare = async function () {
    try {
      var title = 'Mes stations — ManagePro';
      var lines = [];
      var periodEl = document.querySelector('.pc-subtitle');
      var kpis = [];
      document.querySelectorAll('.dv2-kpi .val').forEach(function (el) {
        var label = el.parentElement && el.parentElement.querySelector('.lbl');
        if (label) kpis.push(label.textContent.trim() + ' : ' + el.textContent.trim());
      });
      var rows = [];
      document.querySelectorAll('[data-mag-name]').forEach(function (node) {
        if (node.style.display === 'none') return;
        var name = node.getAttribute('data-mag-name');
        if (name && rows.indexOf(name) === -1) rows.push(name);
      });
      lines.push(title);
      if (periodEl) lines.push(periodEl.textContent.trim());
      if (kpis.length) {
        lines.push('');
        lines.push('Indicateurs :');
        kpis.forEach(function (k) { lines.push('• ' + k); });
      }
      if (rows.length) {
        lines.push('');
        lines.push('Stations (' + rows.length + ') : ' + rows.join(', '));
      }
      lines.push('');
      lines.push(typeof location !== 'undefined' ? location.href : '');
      var text = lines.filter(Boolean).join('\n');
      if (navigator.share) {
        await navigator.share({ title: title, text: text, url: location.href });
        if (typeof toast === 'function') toast('Partage effectué', 'success');
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        if (typeof toast === 'function') toast('Résumé copié dans le presse-papiers', 'success');
        return;
      }
      // Fallback ultime
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof toast === 'function') toast('Résumé copié', 'success');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      if (typeof toast === 'function') toast((e && e.message) || 'Partage impossible', 'error');
    }
  };


  window.__magExportData = { stations: [], from: null, to: null, period: null };

  function magFmtNum(v) {
    var n = Number(v) || 0;
    return (Math.round(n * 100) / 100).toLocaleString('fr-FR');
  }

  function magDownloadBlob(filename, mime, content) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /** Export Excel (CSV UTF-8 BOM, ouvre correctement dans Excel) */
  window.magExportExcel = function () {
    try {
      var d = window.__magExportData || {};
      var list = d.stations || [];
      if (!list.length) {
        if (typeof toast === 'function') toast('Aucune donnée à exporter', 'error');
        return;
      }
      var headers = ['Site', 'Devise', 'Ventes', 'CA TTC', 'Part %', 'Marge brute', 'Taux marge %', 'Achats', 'Stock valorisé', 'Articles', 'Quarts ouverts', 'Stock bas', 'Employés', 'Station active'];
      var caTotal = list.reduce(function (a, s) { return a + (Number(s.ca_ttc) || 0); }, 0);
      var lines = [headers.join(';')];
      list.forEach(function (s) {
        var ca = Number(s.ca_ttc) || 0;
        var part = caTotal > 0 ? ((ca / caTotal) * 100).toFixed(2) : '0';
        var taux = s.taux_marge != null && s.taux_marge !== 0
          ? Number(s.taux_marge).toFixed(2)
          : (s.marge_brute && ca ? ((Number(s.marge_brute) / ca) * 100).toFixed(2) : '');
        lines.push([
          '"' + String(s.name || '').replace(/"/g, '""') + '"',
          s.currency || 'FCFA',
          s.ventes != null ? s.ventes : '',
          String(ca).replace('.', ','),
          String(part).replace('.', ','),
          String(Number(s.marge_brute) || 0).replace('.', ','),
          String(taux).replace('.', ','),
          String(Number(s.achats) || 0).replace('.', ','),
          String(Number(s.stock_valorise) || 0).replace('.', ','),
          s.articles != null ? s.articles : '',
          s.open_shifts != null ? s.open_shifts : '',
          s.low_stock != null ? s.low_stock : '',
          s.employees != null ? s.employees : '',
          s.is_current ? 'Oui' : 'Non'
        ].join(';'));
      });
      // Totaux
      lines.push([
        '"TOTAL"',
        '',
        list.reduce(function (a, s) { return a + (Number(s.ventes) || 0); }, 0),
        String(caTotal).replace('.', ','),
        '100',
        String(list.reduce(function (a, s) { return a + (Number(s.marge_brute) || 0); }, 0)).replace('.', ','),
        '',
        String(list.reduce(function (a, s) { return a + (Number(s.achats) || 0); }, 0)).replace('.', ','),
        String(list.reduce(function (a, s) { return a + (Number(s.stock_valorise) || 0); }, 0)).replace('.', ','),
        '', '', '', '', ''
      ].join(';'));
      var period = (d.from && d.to) ? (d.from + '_' + d.to) : (d.period || 'periode');
      var fname = 'mes-stations_' + period + '.csv';
      var bom = '\uFEFF';
      magDownloadBlob(fname, 'text/csv;charset=utf-8', bom + lines.join('\r\n'));
      if (typeof toast === 'function') toast('Export Excel (CSV) téléchargé', 'success');
    } catch (e) {
      if (typeof toast === 'function') toast((e && e.message) || 'Export Excel impossible', 'error');
    }
  };

  /** Export PDF : moteur de rapports commun (logo, couleurs, pied de page, pagination A4 — identique aux autres rapports).
   *  Reprend fidèlement l'état de l'écran : onglet affiché, période choisie, recherche ; les sélections sont rendues en cases cochées + libellés explicites. */
  var MAG_PERIODS = [['today', 'Aujourd\u2019hui'], ['7d', '7 jours'], ['month', 'Ce mois'], ['lastmonth', 'Mois dernier'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout']];
  var MAG_TABS = [['sites', 'Sites'], ['caisses', 'Caisses'], ['compare', 'Comparaison des performances']];
  window.magExportPdf = async function () {
    try {
      var d = window.__magExportData || {}, rt = window.RT;
      if (!rt) { toast('Moteur PDF indisponible', 'error'); return; }
      if (!rt.canPdf()) { toast('Droit insuffisant pour exporter ce rapport.', 'error'); return; }
      var q = (magState.q || '').trim().toLowerCase();
      var list = (d.all || d.stations || []).filter(function (s) { return !q || String(s.name || '').toLowerCase().indexOf(q) !== -1; });
      if (!list.length) { toast('Aucune donnée à exporter', 'error'); return; }
      var cur = rt.H.cur(), nm = function (v) { return Number(v) || 0; }, sum = function (k) { return Math.round(list.reduce(function (a, s) { return a + nm(s[k]); }, 0) * 100) / 100; };
      var periodLabel = (d.from && d.to) ? ('du ' + rt.fr(d.from) + ' au ' + rt.fr(d.to)) : 'Toutes les dates';
      var perName = (MAG_PERIODS.filter(function (x) { return x[0] === magState.period; })[0] || ['', ''])[1];
      var tabName = (MAG_TABS.filter(function (x) { return x[0] === magState.tab; })[0] || ['', ''])[1];
      var sections = [];
      sections.push(rt.H.kv('Sélection active', [['Onglet', tabName], ['Période', perName + ' (' + periodLabel + ')'], ['Recherche', q ? magState.q : 'Aucune'], ['Stations listées', String(list.length)]]));
      sections.push({ type: 'options', title: 'Période sélectionnée', items: MAG_PERIODS.map(function (x) { return { label: x[1], selected: x[0] === magState.period }; }) });
      sections.push({ type: 'options', title: 'Onglet affiché', items: MAG_TABS.map(function (x) { return { label: x[1], selected: x[0] === magState.tab }; }) });
      if (magState.tab === 'sites') {
        sections.push({ type: 'table', title: 'Sites', head: ['Site', 'Devise', 'Quarts ouverts', 'Stock bas', 'Employés', 'Statut'],
          rows: list.map(function (s) { return [s.name, s.currency || 'FCFA', s.open_shifts != null ? s.open_shifts : '—', s.low_stock != null ? s.low_stock : '—', s.employees != null ? s.employees : '—', s.is_current ? 'Active (en cours)' : 'Disponible']; }) });
      } else if (magState.tab === 'caisses') {
        sections.push({ type: 'table', title: 'Caisses par site', head: ['Site', 'Caisse'], rows: list.map(function (s) { return [s.name, s.is_current ? 'Caisse active' : '—']; }) });
      } else {
        var ca = sum('ca_ttc'), marge = sum('marge_brute'), achats = sum('achats'), stock = sum('stock_valorise');
        sections.push(rt.H.kpis([{ label: 'CA global TTC (' + cur + ')', value: ca, note: list.length + ' site(s)' }, { label: 'Marge brute globale (' + cur + ')', value: marge }, { label: 'Achats globaux (' + cur + ')', value: achats }, { label: 'Valeur du stock global (' + cur + ')', value: stock }], 'Synthèse'));
        sections.push({ type: 'table', title: 'Comparaison des performances', head: ['Site', 'Ventes', 'CA TTC', 'Part %', 'Marge brute', 'Taux de marge %', 'Achats', 'Stock valorisé', 'Articles'],
          rows: list.map(function (s) {
            var c = nm(s.ca_ttc), taux = s.taux_marge ? nm(s.taux_marge) : (s.marge_brute && c ? nm(s.marge_brute) / c * 100 : null);
            return [s.name + (s.is_current ? ' (active)' : ''), nm(s.ventes), c, ca > 0 ? Math.round(c / ca * 10000) / 100 : 0, nm(s.marge_brute), taux != null ? Math.round(taux * 100) / 100 : '—', nm(s.achats), nm(s.stock_valorise), nm(s.articles)];
          }),
          totals: ['TOTAL', sum('ventes'), ca, ca > 0 ? 100 : 0, marge, ca > 0 ? Math.round(marge / ca * 10000) / 100 : '—', achats, stock, ''],
          notes: ['Montants en ' + cur + '. Part = CA du site / CA global ; taux de marge = marge brute / CA TTC.'] });
      }
      await rt.pdf({ title: 'Mes stations', subtitle: tabName, period: periodLabel, sections: sections, landscape: magState.tab === 'compare' ? true : undefined, filename: 'mes-stations' });
    } catch (e) {
      toast((e && e.message) || 'Export PDF impossible', 'error');
    }
  };

  async function vMagasins() {
    const [from, to] = periodBounds(magState.period);
    let list = [];
    let overview = null;
    // Performance période (nouvel endpoint) — repli sur overview existant
    try {
      const q = [];
      if (from) q.push('from=' + encodeURIComponent(from));
      if (to) q.push('to=' + encodeURIComponent(to));
      const perf = await G('/stations/performance' + (q.length ? '?' + q.join('&') : '')).catch(() => null);
      if (perf && Array.isArray(perf.stations) && perf.stations.length) {
        list = perf.stations;
      }
    } catch (_) {}
    try {
      overview = await G('/stations/overview').catch(() => null);
      if (!list.length && overview && Array.isArray(overview.stations)) list = overview.stations;
      if (!list.length) {
        const me = await G('/me').catch(() => null);
        list = (me && me.stations) || (typeof ME !== 'undefined' && ME.stations) || [];
      }
    } catch (_) {
      if (!list.length) list = (typeof ME !== 'undefined' && ME.stations) || [];
    }

    // Fusionner overview (quarts, stock bas, employés) avec performance (CA, achats, stock valorisé)
    const ovMap = {};
    if (overview && Array.isArray(overview.stations)) {
      overview.stations.forEach(s => { ovMap[s.id] = s; });
    }

    let stations = list.map(s => {
      const ov = ovMap[s.id] || {};
      return {
        id: s.id,
        name: s.name || ('Station #' + s.id),
        currency: s.currency || ov.currency || 'FCFA',
        is_current: s.is_current || ov.is_current || String(s.id) === String(typeof SID !== 'undefined' ? SID : ''),
        ventes: Number(s.ventes) || Number(s.sales_count) || 0,
        ca_ttc: Number(s.ca_ttc) || Number(s.sales_today) || Number(s.revenue) || 0,
        marge_brute: Number(s.marge_brute) || Number(s.gross_margin) || 0,
        taux_marge: Number(s.taux_marge) || Number(s.margin_pct) || 0,
        achats: Number(s.achats) || Number(s.purchases) || 0,
        stock_valorise: Number(s.stock_valorise) || Number(s.stock_value) || 0,
        articles: Number(s.articles) || Number(s.products_count) || 0,
        open_shifts: s.open_shifts != null ? s.open_shifts : ov.open_shifts,
        low_stock: s.low_stock != null ? s.low_stock : ov.low_stock,
        employees: s.employees != null ? s.employees : ov.employees
      };
    });

    const allStations = stations.slice();   // liste complète pour l'export PDF (la recherche courante y est réappliquée)
    if ((magState.q || '').trim()) {
      const qn = magState.q.trim().toLowerCase();
      stations = stations.filter(s => String(s.name || '').toLowerCase().includes(qn));
    }


    window.__magExportData = {
      all: allStations,
      stations: stations.slice(),
      from: from,
      to: to,
      period: magState.period
    };
    const caGlobal = stations.reduce((a, s) => a + s.ca_ttc, 0);
    const margeGlobal = stations.reduce((a, s) => a + s.marge_brute, 0);
    const achatsGlobal = stations.reduce((a, s) => a + s.achats, 0);
    const stockGlobal = stations.reduce((a, s) => a + s.stock_valorise, 0);
    const maxCa = Math.max(1, ...stations.map(s => s.ca_ttc));
    const maxStock = Math.max(1, ...stations.map(s => s.stock_valorise));
    const periodLabel = from && to ? `Du ${from} au ${to}` : '';

    const periodBtns = [
      ['today', "Aujourd'hui"], ['7d', '7 jours'], ['month', 'Ce mois'],
      ['lastmonth', 'Mois dernier'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout']
    ].map(([k, lab]) =>
      `<button type="button" class="b2 ${magState.period === k ? 'on' : ''}" onclick="magSetPeriod('${k}')">${lab}</button>`
    ).join('');

    // Onglets
    const tabs = [
      ['sites', 'Sites', stations.length],
      ['caisses', 'Caisses', null],
      ['compare', 'Comparaison des performances', null]
    ].map(([k, lab, n]) =>
      `<a class="${magState.tab === k ? 'on' : ''}" href="javascript:void(0)" onclick="magSetTab('${k}')">${lab}${n != null ? ' <span class="tag" style="margin-left:4px">' + n + '</span>' : ''}</a>`
    ).join('');

    // Barres CA par site
    const caBars = stations.map(s => {
      const pct = barPct(s.ca_ttc, maxCa);
      return `<div data-mag-name="${esc(s.name)}" style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="width:140px;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div>
        <div style="flex:1;height:10px;background:var(--bd);border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:#2563eb;border-radius:6px"></div>
        </div>
        <div style="width:120px;text-align:right;font-weight:700;font-size:13px">${money(s.ca_ttc)}</div>
      </div>`;
    }).join('');

    // Barres stock par site
    const stockBars = stations.map(s => {
      const pct = barPct(s.stock_valorise, maxStock);
      return `<div data-mag-name="${esc(s.name)}" style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="width:140px;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div>
        <div style="flex:1;height:10px;background:var(--bd);border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:#ea580c;border-radius:6px"></div>
        </div>
        <div style="width:120px;text-align:right;font-weight:700;font-size:13px">${money(s.stock_valorise)}</div>
      </div>`;
    }).join('');

    // Table détail
    const tableRows = stations.map(s => {
      const part = caGlobal > 0 ? ((s.ca_ttc / caGlobal) * 100).toFixed(2) : '0';
      const taux = s.taux_marge ? s.taux_marge.toFixed(2) + ' %' : (s.marge_brute && s.ca_ttc ? ((s.marge_brute / s.ca_ttc) * 100).toFixed(2) + ' %' : '—');
      return `<tr data-mag-name="${esc(s.name)}">
        <td><b>${esc(s.name)}</b>${s.is_current ? ' <span class="tag ok">Active</span>' : ''}<br><small style="color:var(--m)">Magasin</small></td>
        <td class="pc-num">${s.ventes || '—'}</td>
        <td class="pc-num">${money(s.ca_ttc)}</td>
        <td class="pc-num">${part} %</td>
        <td class="pc-num">${money(s.marge_brute)}</td>
        <td class="pc-num">${taux}</td>
        <td class="pc-num">${money(s.achats)}</td>
        <td class="pc-num">${money(s.stock_valorise)}</td>
        <td class="pc-num">${s.articles || '—'}</td>
      </tr>`;
    }).join('');

    let body = '';
    if (magState.tab === 'sites') {
      body = `
        <div class="bar" style="margin:12px 0;flex-wrap:wrap;gap:8px">
          ${can('user.manage') ? `<button onclick="typeof msCreateStation==='function'?msCreateStation():(typeof newStation==='function'&&newStation())">+ Nouveau magasin / dépôt</button>` : ''}
          <button class="b2" onclick="go('stock')">Transfert de stock</button>
        </div>
        <div class="pc-tw"><table class="pc-tbl">
          <thead><tr><th>SITE</th><th>DEVISE</th><th>QUARTS OUVERTS</th><th>STOCK BAS</th><th>EMPLOYÉS</th><th>ACTIONS</th></tr></thead>
          <tbody>
            ${stations.map(s => `<tr data-mag-name="${esc(s.name)}">
              <td><b>${esc(s.name)}</b>${s.is_current ? ' <span class="tag ok">Active</span>' : ''}</td>
              <td>${esc(s.currency)}</td>
              <td>${s.open_shifts != null ? s.open_shifts : '—'}</td>
              <td>${s.low_stock != null ? s.low_stock : '—'}</td>
              <td>${s.employees != null ? s.employees : '—'}</td>
              <td>${s.is_current ? '<span style="color:var(--m);font-size:12px">En cours</span>' : `<button class="b2" onclick="chSt(${Number(s.id)})">Basculer</button>`}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`;
    } else if (magState.tab === 'caisses') {
      body = `
        <p style="color:var(--m);font-size:13px">Vue consolidée des caisses par magasin. Ouvrez un magasin pour gérer sa caisse au quotidien.</p>
        <div class="cards" style="margin-top:12px">
          ${stations.map(s => `
            <div class="card" data-mag-name="${esc(s.name)}">
              <small>${esc(s.name)}</small>
              <b>${s.is_current ? 'Caisse active' : '—'}</b>
              <div style="margin-top:8px">
                ${s.is_current ? `<button class="b2" onclick="go('caisse')">Ouvrir la caisse</button>` : `<button class="b2" onclick="chSt(${Number(s.id)})">Basculer vers ce magasin</button>`}
              </div>
            </div>`).join('')}
        </div>`;
    } else {
      // Comparaison des performances (défaut)
      body = `
        <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">
          ${periodBtns}
          ${periodLabel ? `<span style="font-size:12px;color:var(--m);margin-left:8px">${esc(periodLabel)}</span>` : ''}
        </div>

        <div class="dv2-kpis" style="margin-bottom:20px">
          <div class="dv2-kpi" style="background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;border:none">
            <div>
              <small style="color:rgba(255,255,255,.85)">CA GLOBAL TTC</small>
              <span class="val" style="color:#fff">${money(caGlobal)}</span>
              <small style="color:rgba(255,255,255,.75)">${stations.length} site(s)</small>
            </div>
          </div>
          <div class="dv2-kpi" style="background:linear-gradient(135deg,#15803d,#16a34a);color:#fff;border:none">
            <div>
              <small style="color:rgba(255,255,255,.85)">MARGE BRUTE GLOBALE</small>
              <span class="val" style="color:#fff">${money(margeGlobal)}</span>
            </div>
          </div>
          <div class="dv2-kpi">
            <div>
              <small>ACHATS GLOBAUX</small>
              <span class="val">${money(achatsGlobal)}</span>
            </div>
          </div>
          <div class="dv2-kpi" style="background:linear-gradient(135deg,#c2410c,#ea580c);color:#fff;border:none">
            <div>
              <small style="color:rgba(255,255,255,.85)">VALEUR DU STOCK GLOBAL</small>
              <span class="val" style="color:#fff">${money(stockGlobal)}</span>
            </div>
          </div>
        </div>

        <div class="mag-perf-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-bottom:24px">
          <div class="card" style="padding:16px">
            <h3 style="margin:0 0 14px;font-size:14px">Chiffre d'affaires par site</h3>
            ${caBars || '<p style="color:var(--m)">Aucune donnée</p>'}
          </div>
          <div class="card" style="padding:16px">
            <h3 style="margin:0 0 14px;font-size:14px">Valeur du stock par site</h3>
            ${stockBars || '<p style="color:var(--m)">Aucune donnée</p>'}
          </div>
        </div>

        <div class="pc-tw" style="overflow:auto">
          <table class="pc-tbl">
            <thead>
              <tr>
                <th>SITE</th>
                <th class="pc-num">VENTES</th>
                <th class="pc-num">CA TTC</th>
                <th class="pc-num">PART</th>
                <th class="pc-num">MARGE BRUTE</th>
                <th class="pc-num">TAUX DE MARGE</th>
                <th class="pc-num">ACHATS</th>
                <th class="pc-num">STOCK VALORISÉ</th>
                <th class="pc-num">ARTICLES EN STOCK</th>
              </tr>
            </thead>
            <tbody>${tableRows || '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--m)">Aucun magasin</td></tr>'}</tbody>
          </table>
        </div>
      `;
    }

    return `
      <div class="pc-head" style="margin-bottom:8px">
        <div>
          <h2 class="pc-title" style="margin:0">Mes stations</h2>
          <div class="pc-subtitle">Gestion multi-sites : stocks indépendants, caisses par magasin et comparaison des performances</div>
        </div>
        <div class="pc-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          ${can('user.manage') ? `<button onclick="typeof msCreateStation==='function'?msCreateStation():(typeof newStation==='function'&&newStation())">+ Nouveau magasin / dépôt</button>` : ''}
          <button class="b2" onclick="go('stock')" title="Ouvrir la vue stocks (transferts selon permissions)">⇄ Stocks / transferts</button>
          <button class="b2" onclick="magShare()" title="Partager le résumé des stations">↗ Partager</button>
          <button class="b2" onclick="magExportPdf()" title="Exporter en PDF">📄 Exporter en PDF</button>
          <button class="b2" onclick="magExportExcel()" title="Exporter en Excel (CSV)">📊 Excel</button>
        </div>
      </div>

      <div class="subtabs" style="margin-bottom:12px">${tabs}</div>
      <div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">
        <input class="q" type="search" id="mag-search" placeholder="Rechercher une station…" value="${esc(magState.q || '')}" oninput="magSetQ(this)" style="min-width:220px;flex:1;max-width:360px" aria-label="Rechercher une station">
      </div>
      ${body}
    `;
  }

  // Remplace la page stations existante
  if (typeof VM !== 'undefined') {
    VM.stations = vMagasins;
  }
  if (typeof V !== 'undefined') {
    V.stations = ['Mes stations', 'settings.edit|user.manage|report.view'];
  }
  if (typeof NAV_ICONS !== 'undefined') {
    NAV_ICONS.stations = '🏪';
  }
})();
