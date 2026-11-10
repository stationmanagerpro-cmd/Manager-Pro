/* ext-my-profile.js — Profil personnel de chaque utilisateur (remplace « Mon compte » / « Ma fiche ») :
   carte d'identité, onglets horizontaux, indicateurs propres au poste (pompiste, caissier, comptable, superviseur, gérant, admin…),
   liste des autorisations du rôle, journal d'activité traçable (nom + matricule) avec export PDF / Excel,
   actions faites à son nom (avec rejet), bulletins de paie, connexions et préférences.
   Tout vient de /me/profile/* : lecture seule, strictement personnelle, indépendante du module RH. */
(function () {
  'use strict';
  if (typeof VM === 'undefined' || typeof G === 'undefined') return;

  const PAL = ['#2563eb', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#64748b', '#ec4899'];
  const TABS = [['over', '🏠', 'Vue d’ensemble'], ['kpi', '📈', 'Mes indicateurs'], ['perm', '🔐', 'Mes autorisations'], ['jour', '📜', 'Mon journal'], ['pay', '💵', 'Mes bulletins'], ['sec', '🛡️', 'Sécurité & préférences']];
  const PERIODS = [['7', '7 j'], ['30', '30 j'], ['90', '3 mois'], ['365', '12 mois'], ['all', 'Tout']];
  const SRC = { trace: 'Journal des écritures', audit: 'Audit détaillé', a_mon_nom: 'Fait à mon nom' };
  const GAP_KIND = { caisse: 'Écart de caisse', stock: 'Écart de stock', anomalie: 'Anomalie chiffrée' };
  const GAP_STATUS = { en_attente: 'En attente', accepte: 'Accepté', conteste: 'Contesté', regularise: 'Régularisé', cloture: 'Clôturé' };
  // Ordre des blocs d'indicateurs selon le poste : chacun voit d'abord ce qui le concerne
  const ORDER = {
    pompiste: ['sales', 'shifts', 'gaps', 'mine', 'activity'], caissier: ['cash', 'sales', 'gaps', 'shifts', 'mine', 'activity'],
    comptable: ['activity', 'cash', 'expenses'], superviseur: ['shifts', 'gaps', 'activity', 'cash'], magasinier: ['stock', 'activity'],
    gerant: ['activity', 'shifts', 'cash', 'expenses', 'gaps'], admin: ['activity', 'cash', 'expenses', 'shifts'], general: ['activity', 'sales', 'shifts', 'cash', 'gaps']
  };
  const FOCUS_LABEL = { pompiste: 'Pompiste', caissier: 'Caissier', comptable: 'Comptable', superviseur: 'Superviseur', magasinier: 'Magasinier', gerant: 'Gérant', admin: 'Administrateur local', general: 'Utilisateur' };

  const nf = new Intl.NumberFormat('fr-FR');
  const money = v => (typeof f === 'function' ? f(v) : nf.format(v || 0));
  const dt = d => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const day = d => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');
  const E = v => (typeof esc === 'function' ? esc(v == null ? '' : v) : String(v == null ? '' : v));
  const kpi = (ico, label, v, sub) => `<div class="sad-kpi"><span class="sad-ico">${ico}</span><div><small>${E(label)}</small><b>${v}</b><small>${sub || ''}</small></div></div>`;
  const card = (title, inner, extra) => `<div class="sad-card"><h3>${title}${extra ? `<span>${extra}</span>` : ''}</h3>${inner}</div>`;
  const empty = t => `<p style="color:var(--m);font-size:13px;margin:6px 0">${t || 'Pas encore de données sur cette période.'}</p>`;
  const cv = id => `<div class="mp-chart"><canvas id="${id}"></canvas></div>`;

  // ---------- état de la page ----------
  let TAB = 'over', DAYS = '30', P = null, SUM = null, PERMS = null, FOCUS = 'general', CH = [];
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  let JF = { from: daysAgo(30), to: today(), source: '', module: '', q: '' }, JOFF = 0, JLIM = 50, JTOT = 0, JMODS = null;

  function charts(spec) {
    CH.forEach(c => { try { c.destroy(); } catch (_) { /* déjà détruit */ } }); CH = [];
    if (typeof Chart === 'undefined') return;
    setTimeout(() => spec.forEach(([id, cfg]) => { const el = document.getElementById(id); if (el) CH.push(new Chart(el, cfg)); }), 30);
  }
  const base = { responsive: true, maintainAspectRatio: false };
  const grid = { color: 'rgba(148,163,184,.25)' };
  const bars = (labels, data, label, color) => ({ type: 'bar', data: { labels, datasets: [{ label, data, backgroundColor: color || '#2563eb', borderRadius: 6 }] }, options: { ...base, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid }, x: { grid: { display: false } } } } });
  const donut = (labels, data) => ({ type: 'doughnut', data: { labels, datasets: [{ data, backgroundColor: PAL, borderWidth: 0 }] }, options: { ...base, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true } } } } });

  // ---------- carte d'identité ----------
  async function loadPhoto() {
    if (!P || !P.identity.has_photo) return;
    try {
      const r = await fetch('/api/me/photo', { headers: { Authorization: 'Bearer ' + TK }, cache: 'no-store' });
      if (!r.ok) return;
      const url = URL.createObjectURL(await r.blob());
      const el = document.getElementById('mp-av'); if (el) el.innerHTML = `<img src="${url}" alt="">`;
    } catch (_) { /* initiales conservées */ }
  }
  function identity() {
    const i = P.identity, emp = P.employee;
    const init = (i.name.trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('') || '?').toUpperCase();
    const chips = [
      `<span class="tag">${E(i.role.label)}</span>`, i.role.personal ? '<span class="tag" title="Rôle propre à vous seul">Rôle individuel</span>' : '',
      i.matricule ? `<span class="tag">Matricule ${E(i.matricule)}</span>` : '', i.is_global ? '<span class="tag">Plateforme</span>' : ''
    ].join(' ');
    const meta = [i.job_title, emp && emp.department, emp && emp.team, emp && emp.manager_name ? 'Responsable : ' + emp.manager_name : null, emp && emp.hired_on ? 'Depuis le ' + day(emp.hired_on) : null].filter(Boolean).map(E).join(' · ');
    const st = (i.stations || []).find(s => s.id === i.station_id);
    return `<div class="sad-card mp-head">
      <span class="avatar big mp-av-click" id="mp-av" role="button" tabindex="0" title="Cliquer pour changer ma photo" aria-label="Changer ma photo" onclick="pickMyPhoto()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickMyPhoto()}">${E(init)}</span>
      <div class="mp-id"><h2 style="margin:0">${E(i.name)}</h2>
        <div style="margin:4px 0">${chips}</div>
        <div style="color:var(--m);font-size:13px">${meta || '&nbsp;'}</div>
        <div style="color:var(--m);font-size:12px;margin-top:2px">Identifiant : ${E(i.login)}${st ? ' · Station : ' + E(st.name) : ''} · Dernière connexion : ${dt(i.last_login_at)}</div>
      </div>
      <div class="bar mp-actions">
        <button class="b2" onclick="pickMyPhoto()">📷 Photo</button>
        <button class="b2" onclick="chgPwd()">🔑 Mot de passe</button>
        ${P.identity.station_id ? `<button class="b2" onclick="mpExport('pdf')">PDF</button><button class="b2" onclick="mpExport('xlsx')">Excel</button>` : ''}
      </div></div>`;
  }
  function tabsBar() {
    const hide = k => (k === 'pay' && !P.employee) || (k === 'jour' && P.identity.is_global && !P.identity.station_id);
    return `<div class="pp-tabs detail-tabs" role="tablist">${TABS.filter(t => !hide(t[0])).map(t =>
      `<button type="button" role="tab" class="${TAB === t[0] ? 'on' : ''}" aria-selected="${TAB === t[0]}" onclick="mpTab('${t[0]}')"><span aria-hidden="true">${t[1]}</span> ${t[2]}</button>`).join('')}</div>`;
  }

  // ---------- Vue d'ensemble ----------
  const periodBar = () => `<div class="bar" style="margin:0 0 10px">${PERIODS.map(p => `<button type="button" class="${DAYS === p[0] ? '' : 'b2'}" onclick="mpPeriod('${p[0]}')">${p[1]}</button>`).join('')}</div>`;
  async function ensureSummary() { if (!SUM || SUM.days !== (DAYS === 'all' ? 0 : +DAYS)) SUM = await G('/me/profile/summary?days=' + DAYS); return SUM; }

  async function paneOver() {
    const s = await ensureSummary(), a = s.activity, m = s.in_my_name;
    const help = `<ul class="mp-help">${P.role_help.map(h => `<li>${E(h)}</li>`).join('')}</ul>`;
    const k = [
      kpi('📝', 'Mes actions', a ? nf.format(a.total) : '—', a && a.last_at ? 'Dernière : ' + dt(a.last_at) : 'sur la période'),
      kpi('🔐', 'Mes autorisations', PERMS ? nf.format(PERMS.total) : '—', 'rôle ' + E(P.identity.role.label)),
      kpi('⚠️', 'Actions sensibles', a ? nf.format(a.sensitive.count) : '—', 'annulations, suppressions…'),
      m ? kpi('👤', 'Faites à mon nom', nf.format(m.by_others), m.awaiting_reply ? m.awaiting_reply + ' rejet(s) sans réponse' : 'par un tiers') : kpi('🕒', 'Connexions', nf.format(P.identity.logins), 'depuis la création')
    ].join('');
    let ch = '';
    if (a && a.total) {
      ch = `<div class="mp-grid">${card('Mes actions par module', cv('mp-c1'))}${card('Mon activité par jour', cv('mp-c2'))}</div>`;
      charts([['mp-c1', donut(a.by_module.map(x => x.module), a.by_module.map(x => x.n))], ['mp-c2', bars(a.by_day.map(x => x.d.slice(5)), a.by_day.map(x => x.n), 'Actions')]]);
    }
    const since = a && a.since ? `<small style="color:var(--m)">Le journal des écritures est actif depuis le ${day(a.since)}. Avant cette date, seules les actions déjà couvertes par l’audit détaillé apparaissent dans « Mon journal ».</small>` : '';
    return `${periodBar()}<div class="mp-kpis">${k}</div>
      <div class="mp-grid">${card('Ce que mon poste implique', help)}${card('Transparence', `<p style="margin:0 0 6px">${E(P.traceability)}</p>${since}`)}</div>${ch || card('Activité', empty('Aucune action enregistrée sur cette période.'))}`;
  }

  // ---------- Indicateurs par poste ----------
  function blk(id, s) {
    const a = s.activity;
    switch (id) {
      case 'sales': {
        const x = s.sales; if (!x) return null;
        const body = `<div class="mp-kpis">${kpi('🧾', 'Ventes valides', nf.format(x.count))}${kpi('💰', 'Montant vendu', money(x.total))}${kpi('📊', 'Ticket moyen', money(x.average))}${kpi('↩️', 'Annulées', nf.format(x.cancelled), x.credit_total ? 'À crédit : ' + money(x.credit_total) : '')}</div>${x.by_day.length ? cv('mp-sales') : empty()}`;
        if (x.by_day.length) charts.q.push(['mp-sales', bars(x.by_day.map(d => d.d.slice(5)), x.by_day.map(d => d.total), 'Ventes (' + (typeof CUR !== 'undefined' ? CUR : 'FCFA') + ')', '#22c55e')]);
        return card('Mes ventes', body);
      }
      case 'shifts': {
        const x = s.shifts; if (!x) return null;
        return card('Mes quarts', `<div class="mp-kpis">${x.worked != null ? kpi('🕐', 'Quarts travaillés', nf.format(x.worked)) : ''}${kpi('🔓', 'Quarts dont je suis le responsable', nf.format(x.as_manager))}${kpi('🔒', 'Quarts que j’ai clôturés', nf.format(x.closed))}</div>`);
      }
      case 'gaps': {
        const x = s.gaps; if (!x) return null;
        const rows = x.rows.length ? T(['Type', 'Statut', 'Nombre', 'Montant'], x.rows.map(r => [E(GAP_KIND[r.kind] || r.kind), E(GAP_STATUS[r.status] || r.status), nf.format(r.n), money(r.total)])) : empty('Aucun écart sur cette période.');
        return card('Mes écarts et anomalies', `<div class="mp-kpis">${kpi('⚖️', 'À traiter (en attente / contestés)', nf.format(x.open))}${kpi('⚠️', 'Anomalies à mon nom', nf.format(x.anomalies))}</div>${rows}`);
      }
      case 'mine': {
        const x = s.in_my_name; if (!x) return null;
        return card('Actions faites à mon nom', `<div class="mp-kpis">${kpi('👤', 'Total', nf.format(x.total))}${kpi('👥', 'Par un tiers', nf.format(x.by_others))}${kpi('🚫', 'Rejetées', nf.format(x.rejected), x.awaiting_reply ? x.awaiting_reply + ' sans réponse' : '')}</div><div class="bar"><button class="b2" onclick="mpJournal('a_mon_nom')">Voir ces actions</button></div>`);
      }
      case 'cash': {
        const m = s.money; if (!m) return null;
        return card('Mes mouvements de caisse', `<div class="mp-kpis">${kpi('⬇️', 'Encaissements', money(m.cash.in_total), nf.format(m.cash.in_n) + ' opération(s)')}${kpi('⬆️', 'Décaissements / dépôts', money(m.cash.out_total), nf.format(m.cash.out_n) + ' opération(s)')}${kpi('🤝', 'Règlements clients reçus', money(m.customer_payments.total), nf.format(m.customer_payments.n) + ' règlement(s)')}</div>`);
      }
      case 'expenses': {
        const m = s.money; if (!m) return null;
        return card('Mes dépenses saisies', `<div class="mp-kpis">${kpi('🧾', 'Dépenses', nf.format(m.expenses.n))}${kpi('💸', 'Montant', money(m.expenses.total))}</div>`);
      }
      case 'stock': {
        const m = s.money; if (!m) return null;
        return card('Mes mouvements de stock', `<div class="mp-kpis">${kpi('📦', 'Mouvements saisis (hors ventes)', nf.format(m.stock_moves))}</div>`);
      }
      case 'activity': {
        if (!a) return null;
        const mods = a.by_module.length ? T(['Module', 'Actions'], a.by_module.map(x => [E(x.module), nf.format(x.n)])) : empty();
        const sens = a.sensitive.latest.length ? T(['Date', 'Action sensible'], a.sensitive.latest.map(x => [dt(x.created_at), E(x.label) + (x.record_id ? ' · réf. ' + x.record_id : '')])) : empty('Aucune action sensible sur cette période.');
        const hours = a.total ? cv('mp-hours') : '';
        if (a.total) charts.q.push(['mp-hours', bars(a.by_hour.map((_, h) => h + ' h'), a.by_hour, 'Actions', '#a855f7')]);
        return `<div class="mp-grid">${card('Mon activité par module', mods)}${card('Mes dernières actions sensibles', sens)}</div>${a.total ? card('À quelles heures j’agis', hours) : ''}`;
      }
    }
    return null;
  }
  async function paneKpi() {
    const s = await ensureSummary();
    charts.q = [];
    const order = ORDER[FOCUS] || ORDER.general;
    const html = order.map(id => blk(id, s)).filter(Boolean).join('');
    const spec = charts.q; delete charts.q; charts(spec);
    return `${periodBar()}<p style="color:var(--m);font-size:13px;margin:0 0 10px">Indicateurs de votre poste (${E(FOCUS_LABEL[FOCUS] || 'Utilisateur')}). Ils ne comptent que ce qui est rattaché à votre nom.</p>${html || card('Indicateurs', empty())}`;
  }

  // ---------- Autorisations ----------
  async function panePerm() {
    if (!PERMS) PERMS = await G('/me/profile/permissions');
    const groups = PERMS.groups.map(g => `<div class="sad-card mp-perm" data-g="${E(g.label.toLowerCase())}"><h3>${E(g.label)}<span>${g.items.length}</span></h3><ul class="mp-ok">${g.items.map(i => `<li data-t="${E((i.label + ' ' + i.code).toLowerCase())}">${E(i.label)} <code>${E(i.code)}</code></li>`).join('')}</ul></div>`).join('');
    const restricted = PERMS.restricted.length ? card('Droits du rôle retirés par votre station', `<ul class="mp-no">${PERMS.restricted.map(i => `<li>${E(i.label)} <code>${E(i.code)}</code></li>`).join('')}</ul>`, String(PERMS.restricted.length)) : '';
    return `<div class="sad-card"><h3>Mon rôle : ${E(PERMS.role.label)}${PERMS.role.personal ? ' <span>rôle individuel</span>' : ''}</h3>
        <p style="margin:0 0 8px">${E(PERMS.note)}</p><p style="margin:0;color:var(--m);font-size:13px">${nf.format(PERMS.total)} autorisation(s) effective(s). Tout ce qui n’est pas listé ici ne vous est pas accessible. Seul l’administrateur local peut modifier vos droits ; chaque changement est tracé.</p>
        <input type="search" id="mp-psearch" placeholder="Rechercher une autorisation…" oninput="mpPermFilter(this.value)" style="margin-top:10px;max-width:360px;width:100%"></div>
      <div class="mp-grid mp-perms">${groups || empty('Aucune autorisation associée à ce rôle.')}</div>${restricted}`;
  }
  window.mpPermFilter = v => {
    const q = String(v || '').trim().toLowerCase();
    document.querySelectorAll('.mp-perm').forEach(c => {
      let any = false;
      c.querySelectorAll('li').forEach(li => { const ok = !q || li.dataset.t.includes(q) || c.dataset.g.includes(q); li.style.display = ok ? '' : 'none'; any = any || ok; });
      c.style.display = any ? '' : 'none';
    });
  };

  // ---------- Journal ----------
  const jq = (o) => Object.entries({ ...JF, ...o }).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  async function paneJour() {
    if (!JMODS) JMODS = await G('/me/profile/activity/modules').catch(() => []);
    const d = await G('/me/profile/activity?' + jq({ limit: JLIM, offset: JOFF }));
    JTOT = d.total;
    const rows = d.items.map(x => [
      dt(x.at), `<span class="tag">${E(SRC[x.source] || x.source)}</span>`, E(x.module), E(x.action) + (x.amount != null ? ' · ' + money(x.amount) : ''),
      `<small style="color:var(--m)">${E(x.detail || '')}</small>`, E(x.actor || '') + (x.matricule ? ' <small>(' + E(x.matricule) + ')</small>' : ''), E(x.status || '') ,
      x.can_reject ? `<button class="b2" onclick="mpReject(${jsArg(x.ref)})">Rejeter</button>` : ''
    ]);
    const from = JTOT ? JOFF + 1 : 0, to = Math.min(JOFF + JLIM, JTOT);
    return `<div class="sad-card"><div class="g mp-filters">
        <label>Du <input type="date" id="jf-from" value="${E(JF.from)}"></label><label>Au <input type="date" id="jf-to" value="${E(JF.to)}"></label>
        <label>Source <select id="jf-source"><option value="">Toutes</option>${Object.entries(SRC).map(([k, v]) => `<option value="${k}" ${JF.source === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Module <select id="jf-module"><option value="">Tous</option>${(JMODS || []).map(m => `<option ${JF.module === m.module ? 'selected' : ''} value="${E(m.module)}">${E(m.module)} (${m.n})</option>`).join('')}</select></label>
        <label>Recherche <input id="jf-q" value="${E(JF.q)}" placeholder="action, détail, réf."></label></div>
      <div class="bar"><button onclick="mpApply()">Filtrer</button><button class="b2" onclick="mpExport('pdf')">Exporter PDF</button><button class="b2" onclick="mpExport('xlsx')">Exporter Excel</button></div>
      <p style="color:var(--m);font-size:12px;margin:8px 0 0">Seules vos actions apparaissent ici, avec votre nom et votre matricule. Rien n’est supprimable : un rejet d’une action faite à votre nom la marque « rejetée » sans l’effacer. Chaque export est lui-même tracé.</p></div>
      ${T(['Date', 'Source', 'Module', 'Action', 'Détail', 'Auteur', 'Statut', ''], rows)}
      <div class="bar" style="justify-content:space-between"><small>${from}–${to} sur ${nf.format(JTOT)}</small>
        <span><button class="b2" ${JOFF <= 0 ? 'disabled' : ''} onclick="mpPage(-1)">◀ Précédent</button> <button class="b2" ${to >= JTOT ? 'disabled' : ''} onclick="mpPage(1)">Suivant ▶</button></span></div>`;
  }
  window.mpApply = () => {
    JF = { from: $('#jf-from').value || JF.from, to: $('#jf-to').value || JF.to, source: $('#jf-source').value, module: $('#jf-module').value, q: $('#jf-q').value.trim() };
    JOFF = 0; render();
  };
  window.mpPage = dir => { JOFF = Math.max(0, JOFF + dir * JLIM); render(); };
  window.mpJournal = source => { JF.source = source || ''; JOFF = 0; TAB = 'jour'; render(); };
  window.mpExport = safe(async fmt => { await dlFile('/me/profile/activity/export?format=' + fmt + '&' + jq({}), 'mon-journal-' + today() + '.' + fmt); });
  window.mpReject = id => form('Rejeter cette action', [['reason', 'Pourquoi la rejetez-vous ?']], {}, async d => {
    try { await Po(`/hr/actions/${id}/reject`, { reason: d.reason }); closeM(); toast('Rejet enregistré : l’action reste dans l’historique avec votre motif', 'success'); SUM = null; render(); }
    catch (e) { toast(errMsg(e), 'error'); }
  });

  // ---------- Bulletins ----------
  async function panePay() {
    let slips = [];
    try { slips = await G('/hr/payroll?employee_id=' + P.employee.id); } catch (_) { return empty('Les bulletins ne sont pas disponibles (module RH non inclus dans votre contrat ou accès restreint).'); }
    const rows = (slips || []).slice(0, 24);
    if (!rows.length) return empty('Aucun bulletin disponible pour le moment.');
    return T(['N°', 'Mois', 'Statut', 'Brut', 'Net', ''], rows.map(s => [E(s.number || s.id), E(s.month || s.month_s || ''), E(s.status), money(s.gross), money(s.net_pay),
      (s.status && s.status !== 'brouillon') ? `<button class="b2" onclick="dlFile('/hr/payroll/${s.id}/pdf','bulletin-${s.id}.pdf')">PDF</button>` : '—']));
  }

  // ---------- Sécurité & préférences ----------
  async function paneSec() {
    let motion = 'subtle';
    try { const m = await G('/me/preferences/motion'); if (['off', 'subtle', 'full'].includes(m.mode)) motion = m.mode; } catch (_) { /* défaut */ }
    const ses = P.sessions.length ? T(['Connexion', 'Adresse', 'État'], P.sessions.map(s => [dt(s.at), E(s.ip || '—'), s.current ? '<b>Session actuelle</b>' : (s.revoked ? 'Fermée' : (new Date(s.expires_at) < new Date() ? 'Expirée' : 'Ouverte'))])) : empty('Aucune connexion enregistrée.');
    return `<div class="mp-grid">${card('Mes dernières connexions', ses + '<p style="color:var(--m);font-size:12px;margin:6px 0 0">Si vous voyez une connexion que vous ne reconnaissez pas, changez votre mot de passe puis prévenez l’administrateur local.</p>')}
      ${card('Mon compte', `<div class="bar"><button class="b2" onclick="pickMyPhoto()">📷 Changer ma photo</button><button class="b2" onclick="chgPwd()">🔑 Mot de passe</button><button class="b2" onclick="typeof personalThemeEditor==='function'&&personalThemeEditor()">🎨 Mon thème</button><button class="b2" onclick="typeof personalNavColorsEditor==='function'&&personalNavColorsEditor()">🎨 Couleurs du menu</button></div>
        <label for="profile-motion-mode" style="display:block;margin-top:12px">Animations et effets visuels</label>
        <select id="profile-motion-mode" style="max-width:360px;width:100%;margin:6px 0 10px"><option value="off" ${motion === 'off' ? 'selected' : ''}>Désactivées — priorité à la rapidité</option><option value="subtle" ${motion === 'subtle' ? 'selected' : ''}>Discrètes</option><option value="full" ${motion === 'full' ? 'selected' : ''}>Renforcées</option></select>
        <button type="button" class="b1" onclick="saveMotionPreference()">Enregistrer</button>`)}</div>`;
  }

  // ---------- assemblage ----------
  const PANES = { over: paneOver, kpi: paneKpi, perm: panePerm, jour: paneJour, pay: panePay, sec: paneSec };
  async function render() {
    const pane = document.getElementById('mp-pane');
    if (!pane) return;
    const bar = document.getElementById('mp-tabs'); if (bar) bar.innerHTML = tabsBar();
    pane.innerHTML = '<p style="color:var(--m)">Chargement…</p>';
    try { pane.innerHTML = await PANES[TAB](); }
    catch (e) { pane.innerHTML = `<p style="color:var(--r)">${E(errMsg(e))}</p>`; }
  }
  window.mpTab = k => { TAB = k; render(); };
  window.mpPeriod = p => { DAYS = p; SUM = null; render(); };

  VM.moi = async function () {
    P = await G('/me/profile');
    FOCUS = P.focus || 'general'; SUM = null; PERMS = null; JMODS = null;
    if (TAB === 'pay' && !P.employee) TAB = 'over';
    setTimeout(() => { render(); loadPhoto(); }, 0);
    return `<h2 style="margin-top:0">Mon profil</h2>${identity()}<div id="mp-tabs">${tabsBar()}</div><div id="mp-pane"><p style="color:var(--m)">Chargement…</p></div>`;
  };
  if (typeof V !== 'undefined') Object.assign(V, { moi: ['Mon profil', '*'] });
  console.info('[SMP] Profil personnel chargé');
})();
