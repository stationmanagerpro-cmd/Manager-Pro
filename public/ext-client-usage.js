/* Utilisation d'un compte client (Superadmin) : score d'accrochage, rythme, heures, écrans et comptes.
   Lecture seule. Données : GET /admin/clients/:id/usage (agrégats uniquement). */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const sv = v => (typeof esc === 'function' ? esc(v == null ? '' : String(v)) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const dur = s => { s = Math.max(0, Number(s) || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`; };
  const mins = m => dur((Number(m) || 0) * 60);
  const ago = x => { if (!x) return 'jamais'; const m = Math.round((Date.now() - new Date(x)) / 60000); if (m < 2) return 'à l’instant'; if (m < 60) return `il y a ${m} min`; if (m < 1440) return `il y a ${Math.round(m / 60)} h`; return `il y a ${Math.round(m / 1440)} j`; };
  const pct = x => (x == null ? '—' : (x > 0 ? '+' : '') + String(x).replace('.', ',') + ' %');
  const initials = s => String(s || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const label = v => (!v ? 'Écran non identifié' : (typeof TITLES !== 'undefined' && TITLES && TITLES[v]) || v);
  const LEVEL = { Fort: ['#16A34A', 'rgba(22,163,74,.14)'], Moyen: ['#2563EB', 'rgba(37,99,235,.14)'], Faible: ['#D97706', 'rgba(217,119,6,.16)'], Dormant: ['#BD3F0D', 'rgba(189,63,13,.14)'], 'Aucune donnée': ['#64748b', 'rgba(100,116,139,.16)'] };
  const pill = (lvl, txt) => { const c = LEVEL[lvl] || LEVEL['Aucune donnée']; return `<span class="cu-pill" style="color:${c[0]};background:${c[1]}">${sv(txt || lvl)}</span>`; };
  const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];

  function injectStyle() {
    if (document.getElementById('cu-style')) return;
    const s = document.createElement('style'); s.id = 'cu-style';
    s.textContent = `
.cu-wrap{display:flex;flex-direction:column;gap:16px;text-align:left;color:var(--fg,#0f172a)}
.cu-hero{position:relative;overflow:hidden;border-radius:22px;padding:24px;color:#fff;background:radial-gradient(120% 140% at 100% 0%,#3b82f6 0%,rgba(59,130,246,0) 55%),linear-gradient(135deg,#081432 0%,#1e3a8a 55%,#2563EB 100%);display:grid;grid-template-columns:minmax(170px,210px) 1fr;gap:22px;align-items:center}
.cu-hero:after{content:"";position:absolute;inset:auto -60px -90px auto;width:260px;height:260px;border-radius:50%;background:rgba(255,255,255,.06)}
.cu-hero h3{margin:0;font-size:20px;letter-spacing:.2px}
.cu-hero .cu-sub{opacity:.78;font-size:12.5px;margin-top:4px}
.cu-ringbox{position:relative;width:190px;height:190px;margin:auto}
.cu-ring{width:100%;height:100%;filter:drop-shadow(0 6px 18px rgba(0,0,0,.25))}
.cu-ring-bg{fill:none;stroke:rgba(255,255,255,.14);stroke-width:10}
.cu-ring-fg{fill:none;stroke-width:10;stroke-linecap:round;transition:stroke-dasharray .8s cubic-bezier(.2,.8,.2,1)}
.cu-ringval{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.cu-ringval b{font-size:46px;line-height:1;font-weight:800}
.cu-ringval span{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;opacity:.8;margin-top:4px}
.cu-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.cu-kpi{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:14px 14px 12px;backdrop-filter:blur(6px)}
.cu-kpi small{opacity:.82;font-size:11.5px;text-transform:uppercase;letter-spacing:.9px}
.cu-kpi b{display:block;font-size:24px;margin-top:6px;font-weight:750}
.cu-kpi em{font-style:normal;font-size:12px;opacity:.86}
.cu-periods{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}
.cu-periods button{border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer}
.cu-periods button.on{background:#fff;color:#081432;border-color:#fff;font-weight:700}
.cu-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:16px}
.cu-grid.even{grid-template-columns:1fr 1fr}
.cu-card{background:var(--c,#fff);border:1px solid rgba(127,127,127,.18);border-radius:18px;padding:18px;box-shadow:0 1px 2px rgba(15,23,42,.05),0 8px 24px -16px rgba(15,23,42,.25);min-width:0}
.cu-card h4{margin:0 0 4px;font-size:15px;display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap}
.cu-card .cu-hint{font-size:12px;color:var(--m,#64748b);margin:0 0 12px}
.cu-chart{width:100%;height:auto;display:block;overflow:visible}
.cu-grid-line{stroke:rgba(127,127,127,.18);stroke-dasharray:3 5}
.cu-axis{fill:var(--m,#64748b);font-size:11px}
.cu-line{fill:none;stroke:#2563EB;stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round}
.cu-dot{fill:#fff;stroke:#2563EB;stroke-width:2}
.cu-bars rect{rx:3}
.cu-modrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;margin:10px 0}
.cu-modrow .cu-mlabel{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cu-modrow .cu-mval{font-size:12px;color:var(--m,#64748b);text-align:right;white-space:nowrap}
.cu-bar{height:8px;border-radius:99px;background:rgba(127,127,127,.16);overflow:hidden;grid-column:1/-1}
.cu-bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#60a5fa,#2563EB);transition:width .6s ease}
.cu-table-wrap{overflow-x:auto;margin:0 -4px}
.cu-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:0}
.cu-table th,.cu-table td{white-space:normal}
.cu-table td:nth-child(n+2){white-space:nowrap}
.cu-table td:last-child{white-space:normal}
.cu-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--m,#64748b);font-weight:700;padding:8px;border-bottom:1px solid rgba(127,127,127,.2)}
.cu-table td{padding:10px 8px;border-bottom:1px solid rgba(127,127,127,.12);vertical-align:middle}
.cu-table tr.cu-link{cursor:pointer}
.cu-table tr.cu-link:hover td{background:rgba(37,99,235,.06)}
.cu-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#081432);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex:0 0 auto}
.cu-who{display:flex;align-items:center;gap:10px}
.cu-who small{display:block;color:var(--m,#64748b);font-size:11.5px}
.cu-scorebar{display:flex;align-items:center;gap:10px;min-width:150px}
.cu-scorebar .cu-bar{flex:1;grid-column:auto}
.cu-scorebar b{font-size:14px;min-width:30px;text-align:right}
.cu-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--m,#64748b);margin-top:8px;align-items:center}
.cu-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-2px}
.cu-method{font-size:12.5px;color:var(--m,#64748b)}
.cu-method table{width:100%;border-collapse:collapse;margin-top:8px}
.cu-method td{padding:6px 4px;border-bottom:1px solid rgba(127,127,127,.14)}
.cu-pill-hero{background:#fff;color:#081432;font-weight:700;padding:4px 14px;font-size:13px}
.cu-empty{padding:22px;text-align:center;color:var(--m,#64748b);border:1px dashed rgba(127,127,127,.35);border-radius:16px}
.cu-btn{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:10px;padding:6px 12px;font-size:12.5px;cursor:pointer}
.cu-btn:hover{border-color:#2563EB;color:#2563EB}
.cu-mini{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px}
.cu-mini>div{border:1px solid rgba(127,127,127,.18);border-radius:14px;padding:12px}
.cu-mini small{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--m,#64748b)}
.cu-mini b{display:block;font-size:18px;margin-top:4px}
.cu-mini .cu-bar{margin-top:8px}
@media (max-width:860px){.cu-hero{grid-template-columns:1fr}.cu-grid,.cu-grid.even{grid-template-columns:1fr}}
`;
    document.head.appendChild(s);
  }

  function ring(v) {
    const R = 80, C = 2 * Math.PI * R, p = v == null ? 0 : Math.max(0, Math.min(100, v)) / 100;
    return `<div class="cu-ringbox"><svg viewBox="0 0 190 190" class="cu-ring" aria-hidden="true"><defs><linearGradient id="cuRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#4ade80"/></linearGradient></defs><circle cx="95" cy="95" r="${R}" class="cu-ring-bg"/><circle cx="95" cy="95" r="${R}" class="cu-ring-fg" stroke="url(#cuRingG)" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 95 95)"/></svg><div class="cu-ringval"><b>${v == null ? '—' : v}</b><span>sur 100</span></div></div>`;
  }

  function areaChart(daily) {
    const W = 900, H = 240, P = 30, n = daily.length;
    const max = Math.max(1, ...daily.map(d => d.seconds));
    const step = n > 1 ? (W - 2 * P) / (n - 1) : 0;
    const pts = daily.map((d, i) => [P + i * step, H - P - (d.seconds / max) * (H - 2 * P)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${line} L${pts[n - 1][0].toFixed(1)} ${H - P} L${P} ${H - P} Z`;
    const grid = [0, 1, 2, 3].map(k => { const y = P + k * (H - 2 * P) / 3; return `<line x1="${P}" x2="${W - P}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="cu-grid-line"/>`; }).join('');
    const every = Math.max(1, Math.ceil(n / 8));
    const xl = daily.map((d, i) => (i % every === 0 || i === n - 1) ? `<text x="${pts[i][0].toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cu-axis">${d.day.slice(8)}/${d.day.slice(5, 7)}</text>` : '').join('');
    const dots = daily.map((d, i) => `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${d.seconds ? 4 : 2.5}" class="cu-dot"><title>${d.day} : ${dur(d.seconds)} · ${d.accounts} compte(s)</title></circle>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="cu-chart" role="img" aria-label="Temps d'utilisation par jour"><defs><linearGradient id="cuArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2563EB" stop-opacity=".42"/><stop offset="1" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#cuArea)"/><path d="${line}" class="cu-line"/>${dots}${xl}</svg>`;
  }

  function heatChart(cells) {
    const W = 960, cw = 36, top = 22, ch = 26, left = 46;
    const max = Math.max(1, ...cells.flat());
    let g = '';
    ORDER.forEach((dow, row) => {
      g += `<text x="${left - 10}" y="${top + row * ch + 17}" text-anchor="end" class="cu-axis">${DAYS[dow]}</text>`;
      for (let h = 0; h < 24; h++) {
        const v = cells[dow][h], a = v ? (0.12 + 0.88 * v / max) : 0;
        const fill = v ? `rgba(37,99,235,${a.toFixed(2)})` : 'rgba(127,127,127,.10)';
        g += `<rect x="${left + h * cw + 2}" y="${top + row * ch + 2}" width="${cw - 4}" height="${ch - 4}" rx="5" fill="${fill}"><title>${DAYS[dow]} ${String(h).padStart(2, '0')} h : ${mins(v)}</title></rect>`;
      }
    });
    let hl = '';
    for (let h = 0; h < 24; h += 3) hl += `<text x="${left + h * cw + cw / 2}" y="${top - 6}" text-anchor="middle" class="cu-axis">${String(h).padStart(2, '0')}h</text>`;
    return `<svg viewBox="0 0 ${W} ${top + 7 * ch + 4}" class="cu-chart" role="img" aria-label="Rythme hebdomadaire d'utilisation">${hl}${g}</svg>`;
  }

  function hourBars(values, color, unit) {
    const W = 480, H = 170, P = 22, max = Math.max(1, ...values), bw = (W - 2 * P) / 24;
    const bars = values.map((v, h) => { const bh = (v / max) * (H - 2 * P); return `<rect x="${(P + h * bw + 2).toFixed(1)}" y="${(H - P - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(bh, v ? 2 : 0).toFixed(1)}" rx="3" fill="${color}" opacity="${v ? 1 : 0.18}"><title>${String(h).padStart(2, '0')} h : ${unit(v)}</title></rect>`; }).join('');
    const axis = [0, 6, 12, 18, 23].map(h => `<text x="${(P + h * bw + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="cu-axis">${String(h).padStart(2, '0')}h</text>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="cu-chart cu-bars" role="img">${bars}${axis}</svg>`;
  }

  function modules(views, total) {
    if (!views.length) return '<div class="cu-empty">Aucun écran enregistré sur la période.</div>';
    const max = Math.max(1, ...views.map(v => v.minutes));
    return views.slice(0, 12).map(v => `<div class="cu-modrow"><span class="cu-mlabel" title="${sv(v.view)}">${sv(label(v.view))}</span><span class="cu-mval">${sv(mins(v.minutes))} · ${v.share} % · ${v.accounts} compte(s)</span><div class="cu-bar"><i style="width:${(v.minutes / max * 100).toFixed(1)}%"></i></div></div>`).join('');
  }

  function accountsTable(d) {
    if (!d.users.length) return '<div class="cu-empty">Aucun compte rattaché à ce client.</div>';
    const rows = d.users.map(u => {
      const lvl = u.active_days === 0 && !u.logins ? 'Dormant' : u.score >= 75 ? 'Fort' : u.score >= 50 ? 'Moyen' : u.score >= 25 ? 'Faible' : 'Dormant';
      const link = u.role_code === 'ADMIN' ? ` class="cu-link" onclick="go('clientuserdetail','${d.client.id}:${u.id}')" title="Ouvrir le profil du compte"` : '';
      const top = u.top_views.length ? u.top_views.map(v => sv(label(v.view))).join(', ') : '—';
      return `<tr${link}><td><div class="cu-who"><span class="cu-av">${sv(initials(u.display_name))}</span><div><b>${sv(u.display_name)}</b><small>${sv(u.login)}${u.job_title ? ' · ' + sv(u.job_title) : ''}</small></div></div></td>
        <td>${sv(u.role_label || '—')}</td><td><b>${sv(dur(u.seconds))}</b></td><td>${u.logins}</td>
        <td>${u.active_days}/${d.days}<div class="cu-bar" style="width:90px;margin-top:4px"><i style="width:${(u.active_days / d.days * 100).toFixed(0)}%"></i></div></td>
        <td>${sv(ago(u.last_activity))}</td><td><div class="cu-scorebar"><div class="cu-bar"><i style="width:${u.score}%"></i></div><b>${u.score}</b></div></td>
        <td style="font-size:12px;color:var(--m,#64748b)">${top}</td><td>${pill(lvl)}</td></tr>`;
    }).join('');
    return `<div class="cu-table-wrap"><table class="cu-table"><thead><tr><th>Compte</th><th>Rôle</th><th>Temps</th><th>Connexions</th><th>Jours actifs</th><th>Dernière activité</th><th>Accrochage</th><th>Écrans principaux</th><th>Niveau</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function methodBlock(d) {
    const s = d.score;
    if (!s.components || !s.components.length) return '';
    return `<details class="cu-method"><summary style="cursor:pointer;font-weight:600;color:var(--fg,#0f172a)">Comment le score d’accrochage est calculé</summary>
      <p>Score de 0 à 100 : chaque composante est ramenée entre 0 et 1, puis pondérée. Mesure sur ${d.days} jours.</p>
      <table><tbody>${s.components.map(c => `<tr><td><b>${sv(c.label)}</b><br><small>${sv(c.detail)}</small></td><td style="text-align:right;white-space:nowrap">${c.score} / 100</td><td style="text-align:right;white-space:nowrap;color:var(--m,#64748b)">poids ${c.weight} %</td></tr>`).join('')}</tbody></table>
      <p style="margin-top:10px">Niveaux : <b>Fort</b> ≥ 75 · <b>Moyen</b> ≥ 50 · <b>Faible</b> ≥ 25 · <b>Dormant</b> &lt; 25. Score d’un compte : régularité 40 %, intensité 35 %, profondeur 25 %.</p>
      <p>${d.since ? `Mesure disponible depuis le ${sv(d.since.split('-').reverse().join('/'))}.` : 'Aucune mesure encore enregistrée pour ce client.'} Les données ne couvrent que la période depuis la mise en service de la mesure.</p></details>`;
  }

  function renderPane(d, clientId) {
    const t = d.totals, s = d.score;
    const lg = d.login_hours, peakH = lg.indexOf(Math.max(...lg));
    const peak = Math.max(...lg) > 0 ? `${String(peakH).padStart(2, '0')} h – ${String((peakH + 1) % 24).padStart(2, '0')} h` : '—';
    const periods = [7, 30, 90].map(n => `<button class="${d.days === n ? 'on' : ''}" onclick="clientUsageSetPeriod(${clientId},${n})">${n} jours</button>`).join('');
    const lvlColor = s.level && LEVEL[s.level] ? LEVEL[s.level][0] : '#fff';
    window.__cuLast = window.__cuLast || {}; window.__cuLast[clientId] = d;
    if (!d.totals.total_users) return `<div class="cu-wrap">${heroHtml(d, clientId, periods, lvlColor, '')}<div class="cu-empty">Ce client n’a encore aucun compte utilisateur.</div></div>`;
    const hasData = t.seconds > 0;
    return `<div class="cu-wrap">
      ${heroHtml(d, clientId, periods, lvlColor, `<div class="cu-kpis">
        <div class="cu-kpi"><small>Temps d’utilisation</small><b>${sv(dur(t.seconds))}</b><em>${d.trend_pct == null ? 'Pas de comparaison' : sv(pct(d.trend_pct)) + ' vs période précédente'}</em></div>
        <div class="cu-kpi"><small>Comptes actifs</small><b>${t.active_users} / ${t.total_users}</b><em>sur la période</em></div>
        <div class="cu-kpi"><small>Connexions</small><b>${t.logins}</b><em>pic à ${sv(peak)}</em></div>
        <div class="cu-kpi"><small>Écrans utilisés</small><b>${t.distinct_views}</b><em>${t.active_days} jour(s) actif(s)</em></div></div>`)}
      ${hasData ? '' : '<div class="cu-empty">Aucune utilisation enregistrée sur cette période.</div>'}
      <div class="cu-grid">
        <div class="cu-card"><h4>Rythme journalier <span class="cu-hint" style="margin:0">temps cumulé des comptes</span></h4><p class="cu-hint">Survolez un point pour le détail du jour.</p>${areaChart(d.daily)}</div>
        <div class="cu-card"><h4>Modules et écrans</h4><p class="cu-hint">Temps passé par écran, classé. Part du temps total.</p>${modules(d.views, t)}</div>
      </div>
      <div class="cu-grid">
        <div class="cu-card"><h4>Rythme hebdomadaire</h4><p class="cu-hint">Minutes d’utilisation par jour de semaine et par heure (heure de Bamako).</p>${heatChart(d.heatmap)}</div>
        <div class="cu-card"><h4>Heures de connexion</h4><p class="cu-hint">Nombre de connexions par heure.</p>${hourBars(d.login_hours, '#60a5fa', v => v + ' connexion(s)')}
          <div class="cu-legend" style="margin-top:12px"><span><i style="background:#2563EB"></i>Pic de connexions : ${sv(peak)}</span></div></div>
      </div>
      <div class="cu-grid even">
        <div class="cu-card"><h4>Score d’accrochage</h4><p class="cu-hint">Synthèse des quatre composantes (0 à 100).</p>
          <div class="cu-mini">${s.components.map(c => `<div><small>${sv(c.label)}</small><b>${c.score}</b><div class="cu-bar" style="margin-top:8px"><i style="width:${c.score}%"></i></div></div>`).join('')}</div>
          ${methodBlock(d)}</div>
        <div class="cu-card"><h4>Synthèse des comptes</h4><p class="cu-hint">Comptes classés par temps d’utilisation.</p>
          <div class="cu-mini"><div><small>Comptes</small><b>${t.total_users}</b></div><div><small>Actifs</small><b>${t.active_users}</b></div><div><small>Score moyen</small><b>${d.users.length ? Math.round(d.users.reduce((a, u) => a + u.score, 0) / d.users.length) : '—'}</b></div><div><small>Temps moyen / compte actif</small><b>${sv(dur(t.active_users ? t.seconds / t.active_users : 0))}</b></div></div></div>
      </div>
      <div class="cu-card"><h4>Comptes et utilisation <button class="cu-btn" onclick="clientUsageCsv(${clientId})">Exporter CSV</button></h4><p class="cu-hint">Cliquer sur un administrateur ouvre son profil. Tri : temps décroissant.</p>${accountsTable(d)}</div>
    </div>`;
  }

  function heroHtml(d, clientId, periods, lvlColor, kpis) {
    const s = d.score;
    return `<section class="cu-hero" aria-label="Score d’accrochage">
      <div>${ring(s.value)}<div style="text-align:center;margin-top:6px"><span class="cu-pill cu-pill-hero">${sv(s.level)}</span></div></div>
      <div><h3>Accrochage à la plateforme · ${sv(d.client.name)}</h3>
        <div class="cu-sub">Période : ${d.days} derniers jours${d.since ? ' · mesure depuis le ' + sv(d.since.split('-').reverse().join('/')) : ''}</div>
        <div class="cu-periods">${periods}</div>${kpis}</div></section>`;
  }

  async function load(clientId, days) {
    return G('/admin/clients/' + Number(clientId) + '/usage?days=' + (Number(days) || 30));
  }

  window.renderClientUsagePane = async function (clientId, days) {
    injectStyle();
    try {
      const d = await load(clientId, days || 30);
      return `<div id="cu-root-${Number(clientId)}">${renderPane(d, Number(clientId))}</div>`;
    } catch (e) {
      return `<p class="warn">Utilisation indisponible : ${sv(e.message || e)}</p>`;
    }
  };

  window.clientUsageSetPeriod = async function (clientId, days) {
    const root = document.getElementById('cu-root-' + Number(clientId));
    if (!root) return;
    root.style.opacity = '.5';
    try { root.innerHTML = renderPane(await load(clientId, days), Number(clientId)); }
    catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
    finally { root.style.opacity = ''; }
  };

  window.clientUsageCsv = function (clientId) {
    const d = (window.__cuLast || {})[clientId];
    if (!d) return toast('Données non chargées', 'error');
    const head = ['Compte', 'Identifiant', 'Rôle', 'Temps (min)', 'Connexions', 'Jours actifs', 'Dernière activité', 'Score'];
    const rows = d.users.map(u => [u.display_name, u.login, u.role_label || '', Math.round(u.seconds / 60), u.logins, u.active_days, u.last_activity || '', u.score]);
    const csv = [head, ...rows].map(r => r.map(x => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `utilisation-${String(d.client.name || 'client').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${d.days}j.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  };

  // Carte résumée sur le profil d'un compte administrateur.
  window.clientUserUsageCard = async function (clientId, userId) {
    injectStyle();
    let d; try { d = await load(clientId, 30); } catch (_) { return ''; }
    const u = d.users.find(x => Number(x.id) === Number(userId));
    if (!u) return '';
    const top = u.top_views.length ? u.top_views.map(v => `<span class="tag">${sv(label(v.view))}</span>`).join(' ') : 'Aucun écran sur la période';
    return `<div class="card" style="text-align:left;margin-top:12px"><h3>Utilisation de ce compte <small style="font-weight:400;color:var(--m,#64748b)">· 30 derniers jours</small></h3>
      <div class="cu-mini" style="margin:10px 0 12px"><div><small>Temps</small><b>${sv(dur(u.seconds))}</b></div><div><small>Connexions</small><b>${u.logins}</b></div><div><small>Jours actifs</small><b>${u.active_days}/30</b></div><div><small>Accrochage</small><b>${u.score}</b></div></div>
      <p class="detail-meta" style="margin:0 0 8px">Écrans principaux : ${top}</p>
      <p class="detail-meta" style="margin:0">Dernière activité : ${sv(ago(u.last_activity))}. <a href="#" onclick="event.preventDefault();go('clientdetail',${Number(clientId)})">Voir l’utilisation complète du client</a></p></div>`;
  };
})();
