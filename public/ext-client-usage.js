/* Utilisation d'un client (Superadmin) : score d'accrochage, stations, comptes, rythme et heures.
   Lecture seule. Données : GET /admin/clients/:id/usage (agrégats calculés côté serveur à partir des tables d'usage). */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const sv = v => (typeof esc === 'function' ? esc(v == null ? '' : String(v)) : String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const dur = s => { s = Math.max(0, Number(s) || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`; };
  const ago = x => { if (!x) return 'jamais'; const m = Math.round((Date.now() - new Date(x)) / 60000); if (m < 2) return 'à l’instant'; if (m < 60) return `il y a ${m} min`; if (m < 1440) return `il y a ${Math.round(m / 60)} h`; return `il y a ${Math.round(m / 1440)} j`; };
  const fr = iso => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Africa/Bamako', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const dateFr = ymd => (ymd ? ymd.split('-').reverse().join('/') : '—');
  const pctTxt = x => (x > 0 ? '+' : '') + String(x).replace('.', ',') + ' %';
  const initials = s => String(s || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const label = v => (!v ? 'Écran non identifié' : (typeof TITLES !== 'undefined' && TITLES && TITLES[v]) || v);
  const LEVEL = { Fort: ['#16A34A', 'rgba(22,163,74,.14)'], Moyen: ['#2563EB', 'rgba(37,99,235,.14)'], Faible: ['#D97706', 'rgba(217,119,6,.16)'], Dormant: ['#BD3F0D', 'rgba(189,63,13,.14)'], 'Sans temps mesuré': ['#7c3aed', 'rgba(124,58,237,.14)'], 'Aucune activité': ['#64748b', 'rgba(100,116,139,.16)'], 'Aucune donnée': ['#64748b', 'rgba(100,116,139,.16)'] };
  const pill = (lvl, cls = '') => { const c = LEVEL[lvl] || LEVEL['Aucune donnée']; return `<span class="cu-pill ${cls}" style="color:${c[0]};background:${c[1]}">${sv(lvl)}</span>`; };
  const levelOf = v => (v >= 75 ? 'Fort' : v >= 50 ? 'Moyen' : v >= 25 ? 'Faible' : 'Dormant');
  const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const accScore = (days, activeDays, seconds, views) => (!activeDays ? 0 : Math.round(100 * (0.4 * Math.min(1, activeDays / days) + 0.35 * Math.min(1, (seconds / 60 / activeDays) / 60) + 0.25 * Math.min(1, views / 8))));

  function injectStyle() {
    if (document.getElementById('cu-style')) return;
    const s = document.createElement('style'); s.id = 'cu-style';
    s.textContent = `
.cu-wrap{display:flex;flex-direction:column;gap:16px;text-align:left;color:var(--fg,#0f172a)}
.cu-hero{position:relative;overflow:hidden;border-radius:22px;padding:24px;color:#fff;background:radial-gradient(120% 140% at 100% 0%,#3b82f6 0%,rgba(59,130,246,0) 55%),linear-gradient(135deg,#081432 0%,#1e3a8a 55%,#2563EB 100%);display:grid;grid-template-columns:minmax(170px,210px) 1fr;gap:22px;align-items:center}
.cu-hero h3,.cu-hero .cu-title{margin:0;font-size:20px;letter-spacing:.2px;color:#fff!important}
.cu-hero .cu-sub{opacity:.82;font-size:12.5px;margin-top:4px;color:#fff}
.cu-ringbox{position:relative;width:190px;height:190px;margin:auto}
.cu-ring{width:100%;height:100%;filter:drop-shadow(0 6px 18px rgba(0,0,0,.25))}
.cu-ring-bg{fill:none;stroke:rgba(255,255,255,.14);stroke-width:10}
.cu-ring-fg{fill:none;stroke-width:10;stroke-linecap:round}
.cu-ringval{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.cu-ringval b{font-size:46px;line-height:1;font-weight:800;color:#fff}
.cu-ringval span{font-size:11px;letter-spacing:1.4px;text-transform:uppercase;opacity:.8;margin-top:4px;color:#fff}
.cu-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px}
.cu-kpi{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:14px 14px 12px;backdrop-filter:blur(6px)}
.cu-kpi small{opacity:.85;font-size:11.5px;text-transform:uppercase;letter-spacing:.9px;color:#fff}
.cu-kpi b{display:block;font-size:24px;margin-top:6px;font-weight:750;color:#fff}
.cu-kpi em{font-style:normal;font-size:12px;opacity:.88;color:#fff}
.cu-periods{display:flex;gap:6px;flex-wrap:wrap;margin-top:14px}
.cu-periods button{border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer}
.cu-periods button.on{background:#fff;color:#081432;border-color:#fff;font-weight:700}
.cu-note{border-radius:14px;padding:12px 14px;font-size:13px;line-height:1.5;border:1px solid rgba(124,58,237,.3);background:rgba(124,58,237,.08)}
.cu-stations{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cu-stations span.cu-lbl{font-size:12px;color:var(--m,#64748b);margin-right:4px}
.cu-stations button{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:999px;padding:6px 14px;font-size:12.5px;cursor:pointer}
.cu-stations button.on{background:#2563EB;color:#fff;border-color:#2563EB;font-weight:600}
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
.cu-modrow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;margin:10px 0}
.cu-modrow .cu-mlabel{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cu-modrow .cu-mval{font-size:12px;color:var(--m,#64748b);text-align:right;white-space:nowrap}
.cu-bar{height:8px;border-radius:99px;background:rgba(127,127,127,.16);overflow:hidden}
.cu-bar>i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#60a5fa,#2563EB)}
.cu-modrow .cu-bar{grid-column:1/-1}
.cu-table-wrap{overflow-x:auto;margin:0 -4px}
.cu-table{width:100%;border-collapse:collapse;font-size:13px}
.cu-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--m,#64748b);font-weight:700;padding:8px;border-bottom:1px solid rgba(127,127,127,.2);white-space:nowrap}
.cu-table td{padding:10px 8px;border-bottom:1px solid rgba(127,127,127,.12);vertical-align:middle}
.cu-table tr.cu-link{cursor:pointer}
.cu-table tr.cu-link:hover td{background:rgba(37,99,235,.06)}
.cu-table tr.cu-sel td{background:rgba(37,99,235,.08)}
.cu-av{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#2563EB,#081432);color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex:0 0 auto}
.cu-who{display:flex;align-items:center;gap:10px}
.cu-who small{display:block;color:var(--m,#64748b);font-size:11.5px}
.cu-chips{display:flex;gap:4px;flex-wrap:wrap}
.cu-chip{font-size:11.5px;border:1px solid rgba(127,127,127,.3);border-radius:999px;padding:2px 8px;white-space:nowrap}
.cu-scorebar{display:flex;align-items:center;gap:8px;min-width:120px}
.cu-scorebar .cu-bar{flex:1}
.cu-scorebar b{font-size:14px;min-width:26px;text-align:right}
.cu-pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.cu-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--m,#64748b);margin-top:8px;align-items:center}
.cu-legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:4px;vertical-align:-2px}
.cu-method{font-size:12.5px;color:var(--m,#64748b);margin-top:12px}
.cu-method table{width:100%;border-collapse:collapse;margin-top:8px}
.cu-method td{padding:6px 4px;border-bottom:1px solid rgba(127,127,127,.14)}
.cu-sources{font-size:12.5px;color:var(--m,#64748b);line-height:1.6;display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.cu-sources ul{margin:6px 0 0 18px;padding:0}
.cu-empty{padding:22px;text-align:center;color:var(--m,#64748b);border:1px dashed rgba(127,127,127,.35);border-radius:16px}
.cu-btn{border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;border-radius:10px;padding:6px 12px;font-size:12.5px;cursor:pointer;white-space:nowrap}
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
    return `<div class="cu-ringbox"><svg viewBox="0 0 190 190" class="cu-ring" aria-hidden="true"><defs><linearGradient id="cuRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#4ade80"/></linearGradient></defs><circle cx="95" cy="95" r="${R}" class="cu-ring-bg"/><circle cx="95" cy="95" r="${R}" class="cu-ring-fg" stroke="${v == null ? 'rgba(255,255,255,.25)' : 'url(#cuRingG)'}" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 95 95)"/></svg><div class="cu-ringval"><b>${v == null ? '—' : v}</b><span>${v == null ? 'non calculé' : 'sur 100'}</span></div></div>`;
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
    const xl = daily.map((d, i) => (i % every === 0 || i === n - 1) ? `<text x="${pts[i][0].toFixed(1)}" y="${H - 8}" text-anchor="middle" class="cu-axis">${dateFr(d.day).slice(0, 5)}</text>` : '').join('');
    const dots = daily.map((d, i) => `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="${d.seconds ? 4 : 2.5}" class="cu-dot"><title>${dateFr(d.day)} : ${dur(d.seconds)} · ${d.accounts} compte(s) actif(s)</title></circle>`).join('');
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
        g += `<rect x="${left + h * cw + 2}" y="${top + row * ch + 2}" width="${cw - 4}" height="${ch - 4}" rx="5" fill="${fill}"><title>${DAYS[dow]} ${String(h).padStart(2, '0')} h : ${dur(v * 60)}</title></rect>`;
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

  function modules(views) {
    if (!views.length) return '<div class="cu-empty">Aucun écran n’a été utilisé sur la période.</div>';
    const max = Math.max(1, ...views.map(v => v.minutes));
    return views.slice(0, 12).map(v => `<div class="cu-modrow"><span class="cu-mlabel" title="${sv(v.view)}">${sv(label(v.view))}</span><span class="cu-mval">${sv(dur(v.minutes * 60))} · ${v.share} % du temps · ${v.accounts} compte(s)</span><div class="cu-bar"><i style="width:${(v.minutes / max * 100).toFixed(1)}%"></i></div></div>`).join('');
  }

  // Niveau affiché pour un compte : distingue « connecté sans temps mesuré » d'un compte réellement dormant.
  function accountLevel(seconds, logins, score) {
    if (!seconds && !logins) return 'Aucune activité';
    if (!seconds) return 'Sans temps mesuré';
    return levelOf(score);
  }

  function stationsBlock(d, clientId, sel) {
    if (!d.stations || !d.stations.length) return '<div class="cu-empty">Aucune station rattachée à ce client.</div>';
    const rows = d.stations.map(s => {
      const cls = String(s.id) === String(sel) ? 'cu-sel' : '';
      const lvl = s.score && s.score.value != null ? levelOf(s.score.value) : 'Aucune donnée';
      const sc = s.score && s.score.value != null ? `<div class="cu-scorebar"><div class="cu-bar"><i style="width:${s.score.value}%"></i></div><b>${s.score.value}</b></div>` : '<span style="color:var(--m,#64748b)">—</span>';
      return `<tr class="cu-link ${cls}" onclick="clientUsageStation(${clientId},'${s.id}')"><td><b>${sv(s.name)}</b>${s.active === false ? ' <span class="cu-chip">inactive</span>' : ''}</td><td><b>${sv(dur(s.seconds))}</b></td><td>${s.active_users} / ${s.users_attached}</td><td>${s.active_days}/${d.days}</td><td>${s.distinct_views}</td><td>${sc}</td><td>${s.score && s.score.value != null ? pill(lvl) : '—'}</td></tr>`;
    }).join('');
    return `<div class="cu-table-wrap"><table class="cu-table"><thead><tr><th>Station</th><th>Temps</th><th>Comptes actifs / rattachés</th><th>Jours actifs</th><th>Écrans</th><th>Accrochage</th><th>Niveau</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function accountsBlock(d, clientId, sel) {
    if (!d.users.length) return '<div class="cu-empty">Aucun compte n’est rattaché à ce client.</div>';
    let list = d.users.map(u => {
      const st = sel !== 'all' ? (u.by_station && u.by_station[sel]) || { seconds: 0, days: 0, views: 0 } : null;
      const seconds = st ? st.seconds : u.seconds, days = st ? st.days : u.active_days, views = st ? st.views : u.distinct_views;
      const score = st ? accScore(d.days, st.days, st.seconds, st.views) : u.score;
      return { u, seconds, days, views, score, logins: u.logins };
    });
    if (sel !== 'all') list = list.sort((a, b) => b.seconds - a.seconds || b.u.logins - a.u.logins);
    const rows = list.map(({ u, seconds, days, score, logins }) => {
      const link = u.role_code === 'ADMIN' ? ` class="cu-link" onclick="go('clientuserdetail','${clientId}:${u.id}')" title="Ouvrir le profil du compte"` : '';
      const chips = u.stations_attached.length ? `<div class="cu-chips">${u.stations_attached.map(x => `<span class="cu-chip">${sv(x.name)}</span>`).join('')}</div>` : '<span style="color:var(--m,#64748b)">Aucune station</span>';
      const perSt = Object.keys(u.by_station || {}).filter(k => u.by_station[k].seconds > 0).map(k => { const nm = (d.stations.find(s => String(s.id) === k) || {}).name || 'Station'; return `${sv(nm)} : ${sv(dur(u.by_station[k].seconds))}`; }).join('<br>') || '—';
      const top = u.top_views.length ? u.top_views.map(v => sv(label(v.view))).join(', ') : '—';
      const lvl = accountLevel(seconds, logins, score);
      return `<tr${link}><td><div class="cu-who"><span class="cu-av">${sv(initials(u.display_name))}</span><div><b>${sv(u.display_name)}</b><small>${sv(u.login)}${u.job_title ? ' · ' + sv(u.job_title) : ''}</small></div></div></td>
        <td>${sv(u.role_label || '—')}</td>
        <td>${chips}</td>
        <td><b>${sv(dur(seconds))}</b>${sel === 'all' ? `<div style="font-size:11.5px;color:var(--m,#64748b);margin-top:3px">${perSt}</div>` : ''}</td>
        <td>${logins}</td>
        <td>${days}/${d.days}</td>
        <td style="white-space:nowrap">${sv(ago(u.last_activity))}</td>
        <td>${seconds || logins ? `<div class="cu-scorebar"><div class="cu-bar"><i style="width:${score}%"></i></div><b>${score}</b></div>` : '<span style="color:var(--m,#64748b)">—</span>'}</td>
        <td style="font-size:12px;color:var(--m,#64748b)">${top}</td>
        <td>${pill(lvl)}</td></tr>`;
    }).join('');
    return `<div class="cu-table-wrap"><table class="cu-table"><thead><tr><th>Compte</th><th>Rôle</th><th>Stations rattachées</th><th>Temps${sel === 'all' ? ' (par station)' : ' dans cette station'}</th><th>Connexions</th><th>Jours actifs</th><th>Dernière activité</th><th>Accrochage</th><th>Écrans principaux</th><th>Niveau</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function methodBlock(d) {
    const s = d.score;
    if (!s.components || !s.components.length) return '';
    return `<details class="cu-method"><summary style="cursor:pointer;font-weight:600;color:var(--fg,#0f172a)">Comment le score est calculé</summary>
      <p style="margin:8px 0 0">Score de 0 à 100 sur ${d.days} jours : chaque composante est ramenée entre 0 et 1, puis pondérée.</p>
      <table><tbody>${s.components.map(c => `<tr><td><b>${sv(c.label)}</b><br><small>${sv(c.detail)}</small></td><td style="text-align:right;white-space:nowrap">${c.score} / 100</td><td style="text-align:right;white-space:nowrap">poids ${c.weight} %</td></tr>`).join('')}</tbody></table>
      <p style="margin:10px 0 0">Niveaux : Fort ≥ 75 · Moyen ≥ 50 · Faible ≥ 25 · Dormant &lt; 25. Score d’un compte : régularité 40 %, intensité 35 %, écrans 25 %.</p></details>`;
  }

  function sourcesBlock(d, clientId) {
    const c = d.coverage || {};
    return `<div class="cu-card"><div class="cu-sources"><div><b style="color:var(--fg,#0f172a)">D’où viennent ces chiffres</b>
      <ul><li>Temps et jours actifs : mesure toutes les minutes tant que l’application est ouverte et visible (table <code>user_usage</code>).</li>
      <li>Connexions : sessions ouvertes à la connexion (table <code>user_sessions</code>).</li>
      <li>Stations, écrans et heures : mesure par station et par écran (table <code>usage_detail</code>, depuis la mise en service).</li></ul>
      <div style="margin-top:6px">Lu à l’instant dans la base : ${c.usage_rows ?? 0} enregistrement(s) d’usage, ${c.sessions ?? 0} connexion(s), ${c.days_with_data ?? 0} jour(s) actif(s), ${c.stations ?? 0} station(s), ${c.users ?? 0} compte(s). Calculé le ${sv(fr(d.generated_at))} (heure de Bamako).</div></div>
      <button class="cu-btn" onclick="clientUsageRefresh(${clientId})">Actualiser</button></div></div>`;
  }

  function heroHtml(d, clientId, periods, kpis) {
    const s = d.score;
    const period = d.since ? `Mesuré du ${dateFr(d.since)} au ${dateFr(d.generated_at.slice(0, 10))}` : 'Aucune mesure enregistrée pour ce client';
    return `<section class="cu-hero" aria-label="Score d’accrochage">
      <div>${ring(s.value)}<div style="text-align:center;margin-top:6px">${s.value == null ? '<span class="cu-pill cu-pill-hero">Score non calculé</span>' : `<span class="cu-pill cu-pill-hero">${sv(s.level)}</span>`}</div></div>
      <div><div class="cu-title">Accrochage à la plateforme</div>
        <div class="cu-sub">${sv(d.client.name)} · ${d.days} derniers jours · ${sv(period)}</div>
        <div class="cu-periods">${periods}</div>${kpis}</div></section>`;
  }

  function renderPane(d, clientId, sel) {
    sel = sel == null ? 'all' : String(sel);
    window.__cuLast = window.__cuLast || {}; window.__cuLast[clientId] = d;
    const t = d.totals, lg = d.login_hours, peakH = lg.indexOf(Math.max(...lg));
    const peak = Math.max(...lg) > 0 ? `${String(peakH).padStart(2, '0')} h – ${String((peakH + 1) % 24).padStart(2, '0')} h` : null;
    const periods = [7, 30, 90].map(n => `<button class="${d.days === n ? 'on' : ''}" onclick="clientUsageSetPeriod(${clientId},${n})">${n} jours</button>`).join('');
    const st = sel !== 'all' ? d.stations.find(x => String(x.id) === sel) : null;
    const stName = st ? st.name : null;
    const dispSeconds = st ? st.seconds : t.seconds;
    const dispActive = st ? st.active_users : t.active_users, dispTotal = st ? st.users_attached : t.total_users;
    const dispViews = st ? st.distinct_views : t.distinct_views, dispDays = st ? st.active_days : t.active_days;
    const trend = !st && d.trend_pct != null ? `${pctTxt(d.trend_pct)} vs période précédente` : (!st ? 'Pas de période précédente à comparer' : `Dans ${sv(stName)}`);
    const kpis = `<div class="cu-kpis">
      <div class="cu-kpi"><small>Temps passé</small><b>${sv(dur(dispSeconds))}</b><em>${trend}</em></div>
      <div class="cu-kpi"><small>Comptes actifs</small><b>${dispActive} / ${dispTotal}</b><em>${st ? 'rattachés à cette station' : 'ont ouvert l’application'}</em></div>
      <div class="cu-kpi"><small>Connexions</small><b>${st ? '—' : t.logins}</b><em>${st ? 'non ventilées par station' : (peak ? 'pic : ' + sv(peak) : 'aucune connexion')}</em></div>
      <div class="cu-kpi"><small>Écrans utilisés</small><b>${dispViews}</b><em>${dispDays} jour(s) avec activité</em></div></div>`;
    const selBtns = `<div class="cu-stations"><span class="cu-lbl">Vue :</span><button class="${sel === 'all' ? 'on' : ''}" onclick="clientUsageStation(${clientId},'all')">Tout le client</button>${d.stations.map(s => `<button class="${String(s.id) === sel ? 'on' : ''}" onclick="clientUsageStation(${clientId},'${s.id}')">${sv(s.name)}</button>`).join('')}</div>`;
    const empty = !t.seconds && !t.logins ? '<div class="cu-note">Aucune activité enregistrée sur la période pour ce client.</div>'
      : !t.seconds ? `<div class="cu-note"><b>${t.logins} connexion(s) enregistrée(s), aucun temps d’utilisation mesuré.</b> Le temps n’est compté que lorsque l’application est ouverte et visible, par battement d’une minute. Une connexion sans temps signifie que l’application n’a pas envoyé de mesure sur la période.</div>` : '';
    if (!d.totals.total_users) return `<div class="cu-wrap" id="cu-root-${clientId}-inner">${heroHtml(d, clientId, periods, '')}<div class="cu-empty">Ce client n’a encore aucun compte utilisateur.</div></div>`;
    const stEmpty = st && !st.seconds ? '<div class="cu-note">Aucune activité enregistrée dans cette station sur la période.</div>' : '';
    return `<div class="cu-wrap">
      ${heroHtml(d, clientId, periods, kpis)}
      ${selBtns}
      ${st ? '' : empty}${stEmpty}
      <div class="cu-card"><h4>Stations <span class="cu-hint" style="margin:0">une station = une structure du client, sous-stations incluses · cliquer pour filtrer</span></h4>${stationsBlock(d, clientId, sel)}</div>
      <div class="cu-card"><h4>Comptes du client <button class="cu-btn" onclick="clientUsageCsv(${clientId})">Exporter CSV</button></h4><p class="cu-hint">Tous les comptes rattachés, classés par temps. ${st ? 'Temps affiché pour cette station uniquement.' : 'Temps par station affiché sous chaque compte.'} Cliquer sur un administrateur ouvre son profil.</p>${accountsBlock(d, clientId, sel)}</div>
      <div class="cu-grid">
        <div class="cu-card"><h4>Rythme journalier <span class="cu-hint" style="margin:0">${st ? 'ensemble du client' : 'temps cumulé des comptes'}</span></h4><p class="cu-hint">Survolez un point pour le détail du jour.</p>${areaChart(d.daily)}</div>
        <div class="cu-card"><h4>Modules et écrans</h4><p class="cu-hint">Temps par écran, part du total. ${st ? 'Ensemble du client (non ventilé par station).' : ''}</p>${modules(d.views)}</div>
      </div>
      <div class="cu-grid">
        <div class="cu-card"><h4>Rythme hebdomadaire</h4><p class="cu-hint">Minutes d’utilisation par jour et par heure, heure de Bamako.</p>${heatChart(d.heatmap)}</div>
        <div class="cu-card"><h4>Heures de connexion</h4><p class="cu-hint">Nombre de connexions par heure.</p>${hourBars(d.login_hours, '#60a5fa', v => v + ' connexion(s)')}
          <div class="cu-legend" style="margin-top:12px"><span><i style="background:#2563EB"></i>${peak ? 'Pic de connexions : ' + sv(peak) : 'Aucune connexion sur la période'}</span></div></div>
      </div>
      <div class="cu-grid even">
        <div class="cu-card"><h4>Score d’accrochage</h4><p class="cu-hint">Quatre composantes, notées de 0 à 100.</p>
          <div class="cu-mini">${d.score.components.length ? d.score.components.map(c => `<div><small>${sv(c.label)}</small><b>${c.score}</b><div class="cu-bar"><i style="width:${c.score}%"></i></div></div>`).join('') : '<div style="grid-column:1/-1"><small>Score non calculable : aucun temps mesuré sur la période.</small></div>'}</div>
          ${methodBlock(d)}</div>
        <div class="cu-card"><h4>Lecture</h4><p class="cu-hint">Résumé du client sur la période.</p>
          <div class="cu-mini"><div><small>Comptes</small><b>${t.total_users}</b></div><div><small>Stations</small><b>${d.stations.length}</b></div><div><small>Temps / compte actif</small><b>${sv(dur(t.active_users ? t.seconds / t.active_users : 0))}</b></div><div><small>Jours avec activité</small><b>${t.active_days}</b></div></div></div>
      </div>
      ${sourcesBlock(d, clientId)}
    </div>`;
  }

  async function load(clientId, days) {
    return G('/admin/clients/' + Number(clientId) + '/usage?days=' + (Number(days) || 30));
  }

  window.renderClientUsagePane = async function (clientId, days) {
    injectStyle();
    window.__cuSel = window.__cuSel || {};
    try {
      const d = await load(clientId, days || 30);
      return `<div id="cu-root-${Number(clientId)}">${renderPane(d, Number(clientId), window.__cuSel[clientId] || 'all')}</div>`;
    } catch (e) {
      return `<p class="warn">Utilisation indisponible : ${sv(e.message || e)}</p>`;
    }
  };

  function rerender(clientId, data, sel) {
    const root = document.getElementById('cu-root-' + Number(clientId));
    if (root) root.innerHTML = renderPane(data, Number(clientId), sel);
  }

  window.clientUsageSetPeriod = async function (clientId, days) {
    const root = document.getElementById('cu-root-' + Number(clientId));
    if (!root) return;
    root.style.opacity = '.5';
    try { rerender(clientId, await load(clientId, days), (window.__cuSel || {})[clientId] || 'all'); }
    catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
    finally { root.style.opacity = ''; }
  };

  window.clientUsageStation = function (clientId, stationId) {
    window.__cuSel = window.__cuSel || {};
    window.__cuSel[clientId] = String(stationId);
    const d = (window.__cuLast || {})[clientId];
    if (d) rerender(clientId, d, String(stationId));
  };

  window.clientUsageRefresh = async function (clientId) {
    const d = (window.__cuLast || {})[clientId];
    try { rerender(clientId, await load(clientId, d ? d.days : 30), (window.__cuSel || {})[clientId] || 'all'); toast('Chiffres recalculés à partir de la base', 'success'); }
    catch (e) { toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error'); }
  };

  window.clientUsageCsv = function (clientId) {
    const d = (window.__cuLast || {})[clientId];
    if (!d) return toast('Données non chargées', 'error');
    const head = ['Compte', 'Identifiant', 'Rôle', 'Stations rattachées', 'Temps total (min)', 'Temps par station', 'Connexions', 'Jours actifs', 'Dernière activité', 'Score'];
    const rows = d.users.map(u => [u.display_name, u.login, u.role_label || '', u.stations_attached.map(x => x.name).join(' | '), Math.round(u.seconds / 60),
      Object.keys(u.by_station || {}).map(k => `${((d.stations.find(s => String(s.id) === k) || {}).name) || 'Station'}=${Math.round(u.by_station[k].seconds / 60)} min`).join(' | '),
      u.logins, u.active_days, u.last_activity || '', u.score]);
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
    const stList = u.stations_attached.length ? u.stations_attached.map(x => sv(x.name)).join(', ') : 'aucune';
    const lvl = accountLevel(u.seconds, u.logins, u.score);
    return `<div class="card" style="text-align:left;margin-top:12px"><h3>Utilisation de ce compte <small style="font-weight:400;color:var(--m,#64748b)">· 30 derniers jours</small></h3>
      <div class="cu-mini" style="margin:10px 0 12px"><div><small>Temps</small><b>${sv(dur(u.seconds))}</b></div><div><small>Connexions</small><b>${u.logins}</b></div><div><small>Jours actifs</small><b>${u.active_days}/30</b></div><div><small>Niveau</small><b style="font-size:14px">${pill(lvl)}</b></div></div>
      <p class="detail-meta" style="margin:0 0 6px">Stations rattachées : ${stList}</p>
      <p class="detail-meta" style="margin:0 0 6px">Écrans principaux : ${top}</p>
      <p class="detail-meta" style="margin:0">Dernière activité : ${sv(ago(u.last_activity))}. <a href="#" onclick="event.preventDefault();go('clientdetail',${Number(clientId)})">Voir l’utilisation complète du client</a></p></div>`;
  };
})();
