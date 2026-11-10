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
      if (un) checks.push({ ok: false, title: 'Stations sans client', txt: `${un} station(s) non rattachée(s) à un client` });
    }
    const nAlert = checks.filter(c => !c.ok).length;

    setTimeout(() => drawCharts(lic, sum), 30);

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

    <div class="sad-card"><h3>Cohérence des agrégats ${nAlert ? `<span class="sad-pill">${nAlert} alerte(s)</span>` : '<span class="sad-pill">Tout est cohérent</span>'}</h3>
      <p style="margin:0 0 6px;font-size:12px;color:var(--m)">Recoupement automatique entre licences, clients, stations, comptes et finance plateforme.</p>
      <ul class="sad-coh">${checks.map(c => `<li class="${c.ok ? 'ok' : 'ko'}"><span class="dot">${c.ok ? '✓' : '!'}</span><span><b>${esc(c.title)}</b>${esc(c.txt)}</span></li>`).join('')}</ul></div>`;
  };
})();
