/* ext-sa-dash.js — Tableau de bord plateforme du Superadmin (vue d'ensemble : licences, clients, finances, cohérence).
   Alimente l'onglet « Vue d'ensemble » du Centre de contrôle (ext-p12.js). Lecture seule, aucune donnée de station. */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const MOD = { sales: 'Sales', stocks: 'Stocks', purchases: 'Achats', suppliers: 'Fournisseurs', customers: 'Customers', shifts: 'Shifts', employees: 'Employees', fuel: 'Fuel' };
  const LIC = { ACTIVE: 'Actifs', INDEFINIE: 'Durée indéfinie', EXPIRANT_BIENTOT: 'Expirent bientôt', EXPIREE: 'Expirés', SUSPENDUE: 'Suspendus' };
  const LIC_COL = { ACTIVE: '#22c55e', INDEFINIE: '#14b8a6', EXPIRANT_BIENTOT: '#f59e0b', EXPIREE: '#ef4444', SUSPENDUE: '#94a3b8' };
  let charts = [];

  const kpi = (ico, label, val, sub) => `<div class="sad-kpi"><span class="sad-ico">${ico}</span><div><small>${esc(label)}</small><b>${val}</b><small>${sub || ''}</small></div></div>`;
  const mini = (ico, label, val) => `<div class="sad-mini"><small><i>${ico}</i>${esc(label)}</small><b>${val}</b></div>`;
  const dayTag = d => d == null ? '' : `<span class="sad-days ${d <= 7 ? 'x' : d <= 30 ? 'o' : ''}">${d} j restants</span>`;
  const dshort = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

  function drawCharts(lic, sum) {
    if (typeof Chart === 'undefined') return;
    charts.forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } }); charts = [];
    const mk = (id, cfg) => { const cv = document.getElementById(id); if (cv) charts.push(new Chart(cv, cfg)); };
    const grid = { color: 'rgba(148,163,184,.25)' };
    const base = { responsive: true, maintainAspectRatio: false };
    const clients = lic.clients || [];

    // 1) Échéances sur 6 mois
    const now = new Date(), months = [], counts = [];
    for (let i = 0; i < 6; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); months.push(d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })); counts.push(0); }
    clients.forEach(c => { if (c.is_indefinite || !c.expires_at) return; const e = new Date(c.expires_at); const k = (e.getFullYear() - now.getFullYear()) * 12 + e.getMonth() - now.getMonth(); if (k >= 0 && k < 6) counts[k]++; });
    mk('sad_c_exp', { type: 'bar', data: { labels: months, datasets: [{ data: counts, backgroundColor: '#f59e0b', borderRadius: 6, maxBarThickness: 36 }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid }, x: { grid: { display: false } } } } });

    // 2) Répartition des licences
    const bySt = {}; clients.forEach(c => { bySt[c.license_status] = (bySt[c.license_status] || 0) + 1; });
    const keys = Object.keys(bySt);
    mk('sad_c_lic', { type: 'doughnut', data: { labels: keys.map(k => `${LIC[k] || k} ${bySt[k]}`), datasets: [{ data: keys.map(k => bySt[k]), backgroundColor: keys.map(k => LIC_COL[k] || '#64748b'), borderWidth: 0 }] }, options: { ...base, cutout: '68%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } } } });

    // 3) Utilisateurs par client vs quota
    mk('sad_c_usr', { type: 'bar', data: { labels: clients.map(c => c.name), datasets: [{ label: 'Utilisateurs', data: clients.map(c => c.users_count || 0), backgroundColor: '#1e3a8a', borderRadius: 4, maxBarThickness: 22 }, { label: 'Quota contrat', data: clients.map(c => c.max_users || 0), backgroundColor: '#d1d5db', borderRadius: 4, maxBarThickness: 22 }] }, options: { ...base, plugins: { legend: { position: 'top', align: 'end', labels: { boxWidth: 8, usePointStyle: true } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, grid }, x: { grid: { display: false }, ticks: { callback(v) { const s = this.getLabelForValue(v) || ''; return s.length > 13 ? s.slice(0, 12) + '…' : s; } } } } } });

    // 4) Modules activés
    const mc = Object.keys(MOD).map(k => clients.filter(c => c.modules && (c.modules[k] === true || (c.modules[k] && c.modules[k].enabled))).length);
    mk('sad_c_mod', { type: 'bar', data: { labels: Object.values(MOD), datasets: [{ data: mc, backgroundColor: '#a855f7', borderRadius: 6, barThickness: 10 }] }, options: { ...base, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid }, y: { grid: { display: false } } } } });

    // 5) Finance plateforme
    if (sum) mk('sad_c_fin', { type: 'bar', data: { labels: ['Facturé', 'Encaissé', 'Dépenses engagées', 'Dépenses payées'], datasets: [{ data: [sum.invoiced, sum.collected, sum.expenses_committed, sum.expenses_paid], backgroundColor: ['#2563eb', '#22c55e', '#f59e0b', '#ef4444'], borderRadius: 8, maxBarThickness: 60 }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid }, x: { grid: { display: false } } } } });
  }

  const hm = s => { s = Number(s) || 0; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? h + ' h ' + String(m).padStart(2, '0') : m + ' min'; };
  const ago = d => { if (!d) return 'jamais'; const m = Math.round((Date.now() - new Date(d)) / 60000); return m < 2 ? 'à l’instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j'; };
  let usageCharts = [], lastUsage = null;
  const chg = p => p == null ? '<small style="color:var(--m)">—</small>' : `<small style="color:${p >= 0 ? '#16a34a' : '#dc2626'}">${p >= 0 ? '▲ +' : '▼ '}${p} %</small>`;
  const VIEWS = { quart: 'Quart', ventes: 'Ventes', pompes: 'Pompes', prod: 'Produits', stock: 'Stock', cuves: 'Cuves', four: 'Fournisseurs', cli: 'Clients', caisse: 'Caisse', emp: 'Employés', rapports: 'Rapports', msg: 'Messagerie', dash: 'Tableau de bord', moi: 'Profil', treso: 'Trésorerie', clot: 'Clôture' };
  async function dl(path, name) {
    try {
      const r = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + TK } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { toast('Téléchargement impossible : ' + (e.message || e)); }
  }
  window.sadUsagePdf = () => dl('/admin/platform/usage.pdf?days=' + ((lastUsage && lastUsage.days) || 30), 'rapport_utilisation.pdf');
  window.sadUsageCsv = function () {
    const d = lastUsage; if (!d) return;
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Client', 'Temps (min)', 'Connexions', 'Utilisateurs actifs', 'Utilisateurs', 'Evolution temps %', 'Dernière activité'].map(q).join(';')];
    d.clients.forEach(c => L.push([c.client_name, Math.round(c.seconds / 60), c.logins, c.active_users, c.users, c.seconds_change_pct, c.last_activity || ''].map(q).join(';')));
    L.push(''); L.push(['Utilisateur', 'Login', 'Client', 'Temps (min)', 'Connexions', 'Jours actifs', 'Dernière activité'].map(q).join(';'));
    d.users.forEach(u => L.push([u.display_name, u.login, u.client_name, Math.round(u.seconds / 60), u.logins, u.active_days, u.last_activity || ''].map(q).join(';')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + L.join('\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = 'utilisation_plateforme_' + d.days + 'j_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
  };
  window.sadUsage = async function (days) {
    const box = document.getElementById('sad_usage_body'); if (!box) return;
    let d; try { d = await G('/admin/platform/usage?days=' + (days || 30)); } catch (e) { box.textContent = 'Statistiques indisponibles : ' + (e.message || e); return; }
    lastUsage = d;
    usageCharts.forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } }); usageCharts = [];
    const totS = d.clients.reduce((a, c) => a + c.seconds, 0), totL = d.clients.reduce((a, c) => a + c.logins, 0);
    const act = d.users.filter(u => u.logins > 0 || u.seconds > 0).length;
    const since = d.tracking_since ? new Date(d.tracking_since).toLocaleDateString('fr-FR') : null;
    box.innerHTML = `<div class="sad-kpis2" style="margin-bottom:10px">${mini('⏱', 'Temps total', hm(totS))}${mini('🔑', 'Connexions', totL)}${mini('🧑‍💼', 'Utilisateurs actifs', act + ' / ' + d.users.length)}${mini('🏢', 'Clients actifs', d.clients.filter(c => c.logins || c.seconds).length + ' / ' + d.clients.length)}${mini('😴', 'Clients inactifs (7 j+)', d.clients.filter(c => c.inactive).length)}</div>
      <div class="sad-row r21"><div><h4 style="margin:4px 0">Temps passé par client (heures)</h4><div class="sad-chart sm"><canvas id="sad_u_cli"></canvas></div></div>
      <div><h4 style="margin:4px 0">Activité par jour</h4><div class="sad-chart sm"><canvas id="sad_u_day"></canvas></div></div></div>
      <div class="sad-row r21"><div><h4 style="margin:4px 0">Heures de pointe (connexions par heure, UTC)</h4><div class="sad-chart sm"><canvas id="sad_u_hour"></canvas></div></div>
      <div><h4 style="margin:4px 0">Écrans les plus utilisés (minutes)</h4><div class="sad-chart sm"><canvas id="sad_u_view"></canvas></div></div></div>
      <div style="text-align:right;margin:6px 0;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="b2" onclick="sadUsagePdf()">⬇ Rapport PDF</button><button class="b2" onclick="sadUsageCsv()">⬇ Export CSV</button></div>
      <h4 style="margin:10px 0 4px">Classement des clients</h4>
      <div style="overflow:auto"><table><thead><tr><th>#</th><th>Client</th><th>Temps passé</th><th>Évolution</th><th>Connexions</th><th>Utilisateurs actifs</th><th>Dernière activité</th></tr></thead><tbody>${d.clients.map((c, i) => `<tr><td>${i + 1}</td><td><b>${esc(c.client_name)}</b>${c.inactive ? ' <span class="sad-pill" style="background:#fee2e2;color:#b91c1c">inactif</span>' : ''}</td><td>${hm(c.seconds)}</td><td>${chg(c.seconds_change_pct)} <small>temps</small><br>${chg(c.logins_change_pct)} <small>conn.</small></td><td>${c.logins}</td><td>${c.active_users} / ${c.users}</td><td>${ago(c.last_activity)}</td></tr>`).join('') || '<tr><td colspan="7">Aucun client</td></tr>'}</tbody></table></div>
      <h4 style="margin:12px 0 4px">Utilisateurs, du plus fréquent au moins fréquent</h4>
      <div style="overflow:auto;max-height:420px"><table><thead><tr><th>#</th><th>Utilisateur</th><th>Client</th><th>Temps passé</th><th>Connexions</th><th>Jours actifs</th><th>Dernière activité</th></tr></thead><tbody>${d.users.map((u, i) => `<tr><td>${i + 1}</td><td><b>${esc(u.display_name)}</b><br><small>${esc(u.login)}</small></td><td>${esc(u.client_name)}</td><td>${hm(u.seconds)}</td><td>${u.logins}</td><td>${u.active_days}</td><td>${ago(u.last_activity)}</td></tr>`).join('') || '<tr><td colspan="7">Aucun utilisateur</td></tr>'}</tbody></table></div>
      <p style="font-size:12px;margin:8px 0 0">Les connexions sont comptées depuis l’historique des sessions. Le temps passé est mesuré uniquement quand l’application est ouverte et visible${since ? ', depuis le ' + since : ' ; aucune mesure enregistrée pour l’instant (elle démarre à la prochaine ouverture de l’application par les clients)'}.</p>`;
    if (typeof Chart === 'undefined') return;
    const top = d.clients.slice(0, 10);
    const a = document.getElementById('sad_u_cli'), b = document.getElementById('sad_u_day');
    if (a) usageCharts.push(new Chart(a, { type: 'bar', data: { labels: top.map(c => c.client_name), datasets: [{ data: top.map(c => Math.round(c.seconds / 36) / 100), backgroundColor: '#0ea5e9', borderRadius: 6, barThickness: 12 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } } }));
    const hc = document.getElementById('sad_u_hour'), vc = document.getElementById('sad_u_view');
    if (hc) usageCharts.push(new Chart(hc, { type: 'bar', data: { labels: d.hours.map((_, h) => h + 'h'), datasets: [{ data: d.hours, backgroundColor: '#6366f1', borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } } }));
    if (vc) usageCharts.push(new Chart(vc, { type: 'bar', data: { labels: (d.views || []).map(v => VIEWS[v.view] || v.view), datasets: [{ data: (d.views || []).map(v => v.minutes), backgroundColor: '#14b8a6', borderRadius: 6, barThickness: 12 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } } } }));
    if (b) usageCharts.push(new Chart(b, { type: 'line', data: { labels: d.daily.map(x => x.day.slice(5)), datasets: [{ label: 'Connexions', data: d.daily.map(x => x.logins), borderColor: '#22c55e', backgroundColor: '#22c55e33', tension: .3, yAxisID: 'y' }, { label: 'Heures', data: d.daily.map(x => x.hours), borderColor: '#f59e0b', backgroundColor: '#f59e0b33', tension: .3, yAxisID: 'y1' }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } } }));
  };

  // Rattachement d'une station orpheline à un client (route existante POST /admin/clients/:id/assign-station)
  window.saAssignStations = async function () {
    let st = [], cl = [];
    try { st = (await G('/admin/platform/overview')).unassigned_stations || []; } catch (e) { return toast(e.message || 'Liste indisponible', 'error'); }
    cl = await G('/admin/clients').catch(() => []);
    if (!st.length) return toast('Aucune station sans client.');
    if (!cl.length) return toast('Aucun client disponible : créez d\'abord le client.', 'error');
    modal(`<h3>Rattacher une station à un client</h3><p class="muted">Chaque station doit appartenir à un client.</p>
      <label>Station<select id="sa_st">${st.map(s => `<option value="${s.id}">${esc(s.name)}${s.active ? '' : ' (inactive)'}</option>`).join('')}</select></label>
      <label>Client<select id="sa_cl">${cl.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      <div class="bar"><button class="b2" onclick="closeM()">Annuler</button><button onclick="saAssignDo()">Rattacher</button></div>`);
  };
  window.saAssignDo = async function () {
    var sid = +document.getElementById('sa_st').value, cid = +document.getElementById('sa_cl').value;
    try { await Po('/admin/clients/' + cid + '/assign-station', { station_id: sid }); closeM(); toast('Station rattachée.'); if (typeof go === 'function' && typeof cur !== 'undefined') go(cur); }
    catch (e) { toast(e.message || 'Échec du rattachement', 'error'); }
  };

  window.renderSaDashboard = async function () {
    const [lic, ov, info, sum, plat] = await Promise.all([
      G('/admin/licenses/dashboard').catch(() => null),
      G('/admin/overview').catch(() => null),
      G('/admin/info').catch(() => null),
      G('/admin/platform/summary').catch(() => null),
      G('/admin/platform/overview').catch(() => null)
    ]);
    if (!lic) return '<p class="warn">Données de la plateforme indisponibles.</p>';
    const t = lic.totals || {}, clients = lic.clients || [], pend = (lic.pending_renewal_requests || []).length;
    const pt = (plat && plat.totals) || {};
    const upcoming = clients.filter(c => !c.is_indefinite && c.days_remaining != null && c.days_remaining >= 0).sort((a, b) => a.days_remaining - b.days_remaining).slice(0, 5);
    const ops = (lic.recent_operations || []).slice(0, 5);
    const migr = info && info.migrations ? info.migrations.length : '—';
    const stationsTxt = plat ? `${pt.active_stations} station(s) active(s) sur ${pt.stations}` : '';

    // Cohérence des agrégats (recoupement automatique)
    const sumLic = (t.active || 0) + (t.expiring_soon || 0) + (t.expired || 0) + (t.suspended || 0);
    const checks = [];
    checks.push({ ok: sumLic === t.clients, title: 'Licences = clients', txt: `${t.clients} client(s) = ${t.active} actif(s) + ${t.expiring_soon} bientôt + ${t.expired} expiré(s) + ${t.suspended} suspendu(s)` });
    if (plat) {
      checks.push({ ok: pt.clients === t.clients, title: 'Clients : licences = plateforme', txt: `${t.clients} / ${pt.clients} client(s) des deux côtés` });
      checks.push({ ok: pt.active_stations + pt.inactive_stations === pt.stations, title: 'Stations actives + inactives = total', txt: `${pt.active_stations} + ${pt.inactive_stations} = ${pt.stations}` });
      const un = (plat.unassigned_stations || []).length;
      if (un) checks.push({ ok: false, title: 'Stations sans client', txt: `${un} station(s) non rattachée(s) à un client`, action: '<button class="b2" style="margin-left:8px" onclick="saAssignStations()">Rattacher à un client</button>' });
    }
    const nAlert = checks.filter(c => !c.ok).length;

    setTimeout(() => drawCharts(lic, sum), 30);
    setTimeout(() => window.sadUsage && window.sadUsage(30), 60);

    return `
    <div class="sad-hello"><div><h1>Bonjour, ${esc(ME.display_name || ME.name || ME.login || 'admin')} 👋</h1><p>Vue d'ensemble de la plateforme : licences, clients, finances et cohérence des données.</p></div>
      <div class="sad-actions"><span class="sad-date">${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span><button class="b2" onclick="go('admin')">↻ Actualiser</button></div></div>

    <div class="sad-kpis">
      ${kpi('👥', 'Clients', t.clients, stationsTxt)}
      ${kpi('📈', 'Abonnements actifs', t.active, `${t.indefinite || 0} à durée indéfinie`)}
      ${kpi('⏳', 'Expirent bientôt', t.expiring_soon, `${t.expired || 0} déjà expiré(s)`)}
      ${kpi('🧑‍💼', 'Utilisateurs clients', t.users, `${ov ? ov.users : '—'} comptes au total`)}
    </div>
    <div class="sad-kpis2">
      ${mini('⏸', 'Suspendus', t.suspended || 0)}
      ${mini('🔄', 'Demandes de renouvellement', pend)}
      ${mini('🛡', 'Rôles', ov ? ov.roles : '—')}
      ${mini('💾', 'Sauvegardes', ov ? ov.backups : '—')}
      ${mini('🗄', 'Migrations appliquées', migr)}
    </div>

    <div class="sad-row r21">
      <div class="sad-card"><h3>Échéances de licences (6 prochains mois)</h3><div class="sad-chart"><canvas id="sad_c_exp"></canvas></div></div>
      <div class="sad-card"><h3>Répartition des licences</h3><div class="sad-chart"><canvas id="sad_c_lic"></canvas><div class="sad-donut-c"><div><b>${t.clients}</b><small>client(s)</small></div></div></div></div>
    </div>

    <div class="sad-row r3">
      <div class="sad-card"><h3>Utilisateurs par client</h3><div class="sad-chart sm"><canvas id="sad_c_usr"></canvas></div></div>
      <div class="sad-card"><h3>Modules activés</h3><div class="sad-chart sm"><canvas id="sad_c_mod"></canvas></div></div>
      <div class="sad-card"><h3>Prochaines échéances <a onclick="go('clients')">Voir tout →</a></h3>
        <div class="sad-list">${upcoming.map(c => `<div><span><b>${esc(c.name)}</b><small>${dshort(c.expires_at)}${c.manager_name ? ' · ' + esc(c.manager_name) : ''}</small></span>${dayTag(c.days_remaining)}</div>`).join('') || '<p class="dv2-empty">Aucune échéance à venir.</p>'}</div></div>
    </div>

    <div class="sad-row r21b">
      <div class="sad-card"><h3>Finance plateforme</h3><div class="sad-chart" style="height:290px"><canvas id="sad_c_fin"></canvas></div></div>
      <div style="display:grid;gap:14px;align-content:start">
        <div class="sad-card sad-treso"><h3>Trésorerie plateforme</h3><div class="big">${sum ? f(sum.treasury) : '—'}</div><div class="sub">Tous encaissements − tous paiements enregistrés.</div>
          <div class="grid3"><span>Facturé<b>${sum ? f(sum.invoiced) : '—'}</b></span><span>Créances<b>${sum ? f(sum.receivables) : '—'}</b></span><span>Dettes<b>${sum ? f(sum.payables) : '—'}</b></span></div>
          <div class="res">Résultat (engagement)<b>${sum ? f(sum.result_accrual) : '—'}</b></div></div>
        <div class="sad-card"><h3>Opérations de licence récentes</h3><div class="sad-list">${ops.map(h => `<div><span>📄 <b>${esc(h.client_name || '')}</b> · ${esc(h.operation || '')} <small style="display:inline">par ${esc(h.admin_login || '—')}</small></span><small>${dshort(h.performed_at)}</small></div>`).join('') || '<p class="dv2-empty">Aucune opération.</p>'}</div></div>
      </div>
    </div>

    <div class="sad-card" id="sad_usage"><h3>Utilisation de la plateforme <span><select id="sad_usage_days" onchange="sadUsage(this.value)"><option value="7">7 jours</option><option value="30" selected>30 jours</option><option value="90">90 jours</option></select></span></h3><div id="sad_usage_body" style="color:var(--m)">Chargement…</div></div>

    <div class="sad-card"><h3>Cohérence des agrégats ${nAlert ? `<span class="sad-pill">${nAlert} alerte(s)</span>` : '<span class="sad-pill">Tout est cohérent</span>'}</h3>
      <p style="margin:0 0 6px;font-size:12px;color:var(--m)">Recoupement automatique entre licences, clients, stations, comptes et finance plateforme.</p>
      <ul class="sad-coh">${checks.map(c => `<li class="${c.ok ? 'ok' : 'ko'}"><span class="dot">${c.ok ? '✓' : '!'}</span><span><b>${esc(c.title)}</b>${esc(c.txt)}${c.action || ''}</span></li>`).join('')}</ul></div>`;
  };
})();
