/* Centre de contrôle administrateur (paramètres globaux unifiés) */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  /* Groupes pour réduire les onglets : vertical + sous-onglets horizontaux */
  const AGROUPS = {
    overview: { label: 'Vue d\'ensemble', tabs: [['hub', 'Synthèse']] },
    identity: { label: 'Identité', tabs: [['identity', 'Identité de l\'application']] },
    access:   { label: 'Accès', tabs: [['users', 'Utilisateurs'], ['roles', 'Rôles & permissions'], ['contracts', 'Contrats']] },
    station:  { label: 'Station', tabs: [['station', 'Station'], ['settings', 'Paramètres'], ['dashboard', 'Dashboard']] },
    system:   { label: 'Système', tabs: [['backups', 'Sauvegardes'], ['system', 'Système']] }
  };
  const TABS = Object.values(AGROUPS).flatMap(g => g.tabs);

  function groupOfAdmin(tab) {
    for (const [g, def] of Object.entries(AGROUPS)) if (def.tabs.some(([k]) => k === tab)) return g;
    return 'overview';
  }

  function tabAllowed(tab) {
    if (ME?.is_global && ['station','settings','dashboard'].includes(tab)) return false;
    return true;
  }
  function tabBar(active) {
    if (!tabAllowed(active)) active = 'hub';
    const grp = groupOfAdmin(active);
    const groupNav = Object.entries(AGROUPS).filter(([g, def]) => def.tabs.some(([k]) => tabAllowed(k))).map(([g, def]) =>
      `<a class="${g === grp ? 'on' : ''}" onclick="goAdminGroup(${jsArg(g)})">${esc(def.label)}</a>`
    ).join('');
    const sub = AGROUPS[grp].tabs.filter(([k]) => tabAllowed(k));
    const subNav = sub.length > 1
      ? `<div class="subtabs">${sub.map(([k, lab]) =>
          `<a class="${k === active ? 'on' : ''}" onclick="goAdminTab('${k}')">${esc(lab)}</a>`
        ).join('')}</div>`
      : '';
    return `<div class="tab-layout admin-hz" style="margin-bottom:12px">
      <nav class="tabs-v" aria-label="Groupes admin">${groupNav}</nav>
      <div class="tab-content" style="flex:1">${subNav}</div>
    </div>`;
  }

  window.goAdminGroup = function (g) {
    const first = AGROUPS[g].tabs[0][0];
    window.__adminTab = first;
    go('admin');
  };

  function card(title, body, actionHtml) {
    return `<div class="card" style="text-align:left;min-width:180px">
      <small>${esc(title)}</small>
      <div style="margin:6px 0;font-size:15px">${body}</div>
      ${actionHtml || ''}
    </div>`;
  }

  async function vAdminHub() {
    const canUser = can('user.manage');
    const canSet = can('settings.edit');
    const canApp = can('appearance.manage');
    if (!canUser && !canSet && !canApp) {
      return `<p class="warn">Accès réservé aux administrateurs (user.manage ou settings.edit).</p>`;
    }

    let tab = (typeof window.__adminTab === 'string' && TABS.some(t => t[0] === window.__adminTab))
      ? window.__adminTab : 'hub';
    if (!tabAllowed(tab)) tab = 'hub';

    let body = '';
    try {
      if (tab === 'hub') body = await renderHub();
      else if (tab === 'identity') body = window.renderIdentityTab ? await window.renderIdentityTab() : '';
      else if (tab === 'users') body = await renderUsers();
      else if (tab === 'roles') body = await renderRoles();
      else if (tab === 'contracts') body = await renderContracts();
      else if (tab === 'station') body = await renderStation();
      else if (tab === 'settings') body = await renderSettings();
      else if (tab === 'dashboard') body = await renderDashLink();
      else if (tab === 'backups') body = await renderBackups();
      else if (tab === 'system') body = await renderSystem();
      else body = await renderHub();
    } catch (e) {
      body = `<p class="warn">Erreur : ${esc(e.message || String(e))}</p>`;
    }

    return `<h2 style="margin-top:0">Centre de contrôle administrateur</h2>
      <p style="font-size:13px;color:var(--m);margin-top:0">
        Point d'entrée unique pour utilisateurs, rôles, contrats, modules, dashboard, paramètres station et sauvegardes.
      </p>
      ${tabBar(tab)}
      ${body}`;
  }

  async function renderHub() {
    if (ME?.is_global && typeof window.renderSaDashboard === 'function') { try { return await window.renderSaDashboard(); } catch (e) { /* repli sur la vue classique */ } }
    const ov = await G('/admin/overview').catch(() => null);
    const lic = ME?.is_global ? await G('/admin/licenses/dashboard').catch(() => null) : null;
    const [info, users, roles, settings] = await Promise.all([
      can('user.manage') ? G('/admin/info').catch(() => null) : Promise.resolve(null),
      can('user.manage') && !ov ? G('/users').catch(() => []) : Promise.resolve([]),
      can('user.manage') && !ov ? G('/admin/roles').catch(() => []) : Promise.resolve([]),
      !ME?.is_global && (can('settings.edit') || can('appearance.manage')) ? G('/settings').catch(() => ({})) : Promise.resolve({})
    ]);

    const locked = ov ? (ov.locked_users || 0) : (users || []).filter(u => (u.failed_logins || 0) >= 5).length;
    const userCount = ov ? (ov.users || 0) : (users || []).length;
    const roleCount = ov ? (ov.roles || 0) : (roles || []).length;
    const backupN = ov ? (ov.backups || 0) : (info ? (info.backups || 0) : '—');
    const migr = info && info.migrations ? info.migrations.length : '—';

    const platformCards = lic ? `<div class="cards" style="margin-bottom:12px">${card('Clients', lic.totals.clients)}${card('Abonnements actifs', lic.totals.active)}${card('Expire bientôt', lic.totals.expiring_soon)}${card('Expirés', lic.totals.expired)}${card('Suspendus', lic.totals.suspended)}${card('Demandes de renouvellement', lic.pending_renewal_requests?.length || 0)}</div>` : '';
    const renewal = lic?.pending_renewal_requests?.length ? `<div class="warn" style="margin-bottom:12px"><b>Demandes de renouvellement</b>${T(['Client','Demandeur','Date',''], lic.pending_renewal_requests.slice(0,8).map(r => [esc(r.client_name),esc(r.requester_login||''),r.requested_at ? new Date(r.requested_at).toLocaleString() : '—',`<button class="b2" onclick="clProcessRenewal(${r.id},${r.client_id})">Traiter</button>`]))}</div>` : '';
    return `${platformCards}${renewal}<div class="cards">
      ${card('Utilisateurs', `<b>${userCount}</b> compte(s)${locked ? ` · <span class="tag x">${locked} bloqué(s)</span>` : ''}`,
        can('user.manage') ? `<button class="b2" onclick="goAdminTab('users')">Gérer</button>` : '')}
      ${card('Rôles', `<b>${roleCount}</b> rôle(s)`,
        can('user.manage') ? `<button class="b2" onclick="goAdminTab('roles')">Gérer</button>` : '')}
      ${card('Sauvegardes', `<b>${backupN}</b> fichier(s)`,
        can('user.manage') ? `<button class="b2" onclick="goAdminTab('backups')">Voir</button>` : '')}
      ${ov && ov.app_version ? card('Version', `<b>V${esc(ov.app_version)}</b>`, '') : ''}
      ${card('Migrations', `<b>${migr}</b> appliquée(s)`,
        can('user.manage') ? `<button class="b2" onclick="goAdminTab('system')">Détails</button>` : '')}
      ${!ME?.is_global ? card('Station', esc((window.ST && window.ST.name) || 'Courante'), can('settings.edit') ? `<button class="b2" onclick="goAdminTab('station')">Modifier</button>` : '') : ''}
      ${/* Config. Dashboard réservée au SuperAdmin (profil station) — masquée pour les comptes clients */ ''}
      ${ME?.is_global ? card('Identité / login', 'Logo, couleurs, panneau connexion', `<button class="b2" onclick="goAdminTab('identity')">Configurer</button>`) : ''}
      ${card('Contrats clients', 'Quotas & modules',
        can('user.manage') ? `<button class="b2" onclick="go('clients')">Ouvrir</button>` : '')}
      ${!ME?.is_global ? card('Paramètres', Object.keys(settings || {}).length + ' clé(s)', (can('settings.edit') || can('appearance.manage')) ? `<button class="b2" onclick="goAdminTab('settings')">Éditer</button>` : '') : ''}
    </div>
    <div style="margin-top:16px">
      <h3 style="margin:0 0 8px">Raccourcis modules</h3>
      <div class="bar" style="flex-wrap:wrap">
        ${!ME?.is_global && can('user.manage') ? `<button class="b2" onclick="go('param')">Utilisateurs (vue classique)</button>` : ''}
        ${can('user.manage') ? `<button class="b2" onclick="go('roles')">Rôles</button>` : ''}
        ${can('user.manage') ? `<button class="b2" onclick="go('clients')">Contrats</button>` : ''}
        ${/* Config. Dashboard : uniquement SuperAdmin */ ''}
        ${!ME?.is_global && can('audit.view') ? `<button class="b2" onclick="go('audit')">Journal d'audit</button>` : ''}
        ${!ME?.is_global && (can('report.view') || can('finance.view')) ? `<button class="b2" onclick="go('exports')">Exports</button>` : ''}
      </div>
    </div>
    <p style="font-size:12px;color:var(--m);margin-top:16px">
      L'Administrateur Principal contrôle <b>qui</b> accède à <b>quoi</b>, dans <b>quelle station</b>, avec <b>quelles limites</b>, selon <b>quel contrat</b>.
    </p>`;
  }

  async function renderUsers() {
    if (!can('user.manage')) return '';
    const us = await G('/users');
    const consistency = typeof roleConsistencyBanner === 'function' ? await roleConsistencyBanner().catch(() => '') : '';
    return consistency + `<div class="bar">
        ${!ME?.is_global ? '<button onclick="addU()">Ajouter un utilisateur</button>' : '<span style="font-size:12px;color:var(--m)">Les comptes employés/stations sont gérés depuis le client concerné.</span>'}
        <button class="b2" onclick="goAdminTab('roles')">Rôles</button>
      </div>` +
      T(['Identifiant', 'Rôle', 'Échecs', 'Dernière connexion', ''], us.map(u => [
        esc(u.login),
        u.role,
        u.failed_logins,
        dt(u.last_login_at),
        (u.failed_logins >= 5 ? `<button class="b2" onclick="Po('/users/${u.id}/unlock').then(()=>goAdminTab('users'))">Débloquer</button> ` : '') +
        (!ME?.is_global && canTouchUser(u) ? `<button class="b2" onclick="editUserProfile(${Number(u.id)},${jsArg(u.login)},${jsArg(u.full_name||'')},${jsArg(u.job_title||'')},${!!u.active})">Modifier</button>` : '') +
        (!ME?.is_global && canTouchUser(u) && !isSelfUser(u) ? `<button class="b2" onclick="typeof changeUserRole==='function'&&changeUserRole(${Number(u.id)},${jsArg(u.login)},${jsArg(u.role)})">Rôle</button>` : '')
      ]));
  }

  async function renderRoles() {
    if (!can('user.manage')) return '';
    // Délègue à la vue roles existante si présente
    if (typeof VM.roles === 'function') {
      return await VM.roles();
    }
    const roles = await G('/admin/roles');
    return T(['Code', 'Libellé', 'Permissions', 'Utilisateurs'], roles.map(r => [
      esc(r.role),
      esc(r.label || ''),
      (r.permissions || []).slice(0, 8).join(', ') + ((r.permissions || []).length > 8 ? '…' : ''),
      r.users_count
    ])) + `<p style="margin-top:8px"><button class="b2" onclick="go('roles')">Ouvrir gestion complète des rôles</button></p>`;
  }

  async function renderContracts() {
    if (!can('user.manage')) return '';
    if (typeof VM.clients === 'function') {
      return await VM.clients();
    }
    return `<p>Ouvrez la vue <button class="b2" onclick="go('clients')">Contrats clients</button>.</p>`;
  }

  async function renderStation() {
    if (!can('settings.edit')) return '';
    const st = await G('/stations/current').catch(() => null);
    if (!st) {
      // fallback via /me or settings
      return `<p>Impossible de charger la station. Vérifiez l'API <code>/stations/current</code>.</p>
        <button onclick="editStationFallback()">Modifier identité station</button>`;
    }
    const logoBtn = (can('settings.edit') || can('appearance.manage') || can('image.manage'))
      ? `<button class="b2" onclick="pickImage('stations',${Number(st.id || (typeof SID !== 'undefined' ? SID : 0))})">Changer le logo de la station</button>`
      : '';
    return `<div class="cards">
      ${card('Nom', esc(st.name || '—'))}
      ${card('Adresse', esc(st.address || '—'))}
      ${card('Latitude', st.latitude != null ? esc(st.latitude) : '—')}
      ${card('Longitude', st.longitude != null ? esc(st.longitude) : '—')}
      ${card('Téléphone', esc(st.phone || '—'))}
      ${card('E-mail', esc(st.email || '—'))}
      ${card('Devise', esc(st.currency || 'FCFA'))}
      ${card('NIF / Taxe', esc(st.tax_id || '—'))}
      ${card('Logo', st.has_logo || st.photo_path ? 'Oui' : 'Non')}
    </div>
    <div class="bar" style="margin-top:12px;flex-wrap:wrap;gap:8px">
      <button onclick="editStation(${JSON.stringify(st).replace(/"/g, '&quot;')})">Modifier</button>
      ${logoBtn}
    </div>`;
  }

  window.editStation = safe(async function (st) {
    const s = typeof st === 'string' ? JSON.parse(st.replace(/&quot;/g, '"')) : st;
    form('Identité de la station', [
      ['name', 'Nom'],
      ['address', 'Adresse'],
      ['latitude', 'Latitude (ex. 12.6392)'],
      ['longitude', 'Longitude (ex. -7.9981)'],
      ['phone', 'Téléphone'],
      ['email', 'E-mail'],
      ['currency', 'Devise'],
      ['tax_id', 'NIF / identifiant fiscal']
    ], {
      name: s.name || '',
      address: s.address || '',
      latitude: s.latitude ?? '',
      longitude: s.longitude ?? '',
      phone: s.phone || '',
      email: s.email || '',
      currency: s.currency || 'FCFA',
      tax_id: s.tax_id || ''
    }, async d => {
      await api('PATCH', '/stations/current', { ...d, latitude: String(d.latitude ?? '').trim() || null, longitude: String(d.longitude ?? '').trim() || null });
      closeM();
      toast('Station mise à jour', 'success');
      goAdminTab('station');
    });
  });

  window.editStationFallback = safe(async () => {
    form('Identité de la station', [
      ['name', 'Nom'],
      ['address', 'Adresse'],
      ['latitude', 'Latitude (ex. 12.6392)'],
      ['longitude', 'Longitude (ex. -7.9981)'],
      ['phone', 'Téléphone'],
      ['email', 'E-mail'],
      ['currency', 'Devise'],
      ['tax_id', 'NIF']
    ], {}, async d => {
      await api('PATCH', '/stations/current', { ...d, latitude: String(d.latitude ?? '').trim() || null, longitude: String(d.longitude ?? '').trim() || null });
      closeM();
      toast('Station mise à jour', 'success');
      goAdminTab('station');
    });
  });

  async function renderSettings() {
    if (!can('settings.edit') && !can('appearance.manage') && !can('hr.manage')) {
      return `<p class="warn">Aucune permission de paramètres.</p>`;
    }
    const all = await G('/settings');
    const keys = Object.keys(all || {}).sort();
    if (!keys.length) {
      return `<p class="warn">Aucun paramètre chargé. Vérifiez /settings.</p>`;
    }

    const rows = keys.map(k => {
      const v = all[k];
      let preview = '';
      try {
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        preview = s.length > 80 ? s.slice(0, 80) + '…' : s;
      } catch (_) { preview = '—'; }
      return [
        `<code>${esc(k)}</code>`,
        `<span style="font-size:12px;color:var(--m)">${esc(preview)}</span>`,
        `<button class="b2" onclick="editSettingKey(${jsArg(k)})">Éditer</button>
         <button class="b2" onclick="resetSettingKey(${jsArg(k)})">Reset</button>`
      ];
    });

    return `<p style="font-size:13px;color:var(--m)">Clés connues (thème, footer, catégories dépenses, règles paie, dashboard_config, etc.).</p>
      ${T(['Clé', 'Valeur (aperçu)', ''], rows)}
      ${ME?.is_global ? '' : `<p style="font-size:12px;color:var(--m);margin-top:8px">
        Pour le dashboard détaillé : <button class="b2" onclick="go('dashcfg')">Configuration du dashboard</button>
      </p>`}`;
  }

  window.editSettingKey = safe(async function (key) {
    const all = await G('/settings');
    const cur = all[key];
    let raw = '';
    try { raw = typeof cur === 'string' ? cur : JSON.stringify(cur, null, 2); } catch (_) { raw = ''; }
    form('Paramètre : ' + key, [
      ['value', 'Valeur JSON', 'textarea']
    ], { value: raw }, async d => {
      let parsed;
      try { parsed = JSON.parse(d.value); } catch (e) {
        toast('JSON invalide : ' + e.message, 'error');
        return;
      }
      await Pu('/settings/' + key, { value: parsed });
      closeM();
      toast('Paramètre enregistré', 'success');
      goAdminTab('settings');
    });
  });

  window.resetSettingKey = safe(async function (key) {
    if (!confirm('Réinitialiser « ' + key + ' » aux valeurs par défaut ?')) return;
    await Po('/settings/reset/' + key, {});
    toast('Réinitialisé', 'success');
    goAdminTab('settings');
  });

  async function renderDashLink() {
    if (!can('settings.edit') || ME?.is_global) return '';
    return `<p>La configuration fine du dashboard (cartes, graphiques, sections, raccourcis par rôle) est disponible dans la configuration du dashboard.</p>
      <button onclick="go('dashcfg')">Ouvrir Config. Dashboard</button>
      <button class="b2" onclick="go('dash')">Voir le Dashboard</button>`;
  }

  async function renderBackups() {
    if (!can('user.manage')) return '';
    const [list, logs, info, maintenance] = await Promise.all([
      G('/admin/backups').catch(() => []),
      G('/admin/backups/logs?limit=20').catch(() => []),
      G('/admin/info').catch(() => ({})),
      ME?.is_global ? G('/admin/maintenance/backup-status').catch(() => null) : Promise.resolve(null)
    ]);
    const auto = info.backup_auto ? `Oui (après ${info.backup_hour || 2}h)` : 'Non (BACKUP_AUTO=0)';
    const last = info.last_backup;
    const lastHtml = last
      ? `<span class="${last.status === 'ok' ? 'ok' : 'warn'}">${esc(last.status)} — ${esc(last.file_name || last.error_message || '')} (${esc(last.finished_at || last.started_at || '')})</span>`
      : '—';
    return `<div class="cards" style="margin-bottom:12px">
        <div class="card"><small>Sauvegardes disque</small><div style="font-size:22px;font-weight:700">${(list || []).length}</div></div>
        <div class="card"><small>Auto 24h</small><div style="font-size:15px">${auto}</div></div>
        <div class="card"><small>Dernier résultat</small><div style="font-size:13px">${lastHtml}</div></div>
      </div>
      <div class="bar">
        <button onclick="runBackupNow()">Créer une sauvegarde maintenant</button>
        ${ME?.is_global ? `<button class="b2" ${maintenance?.restore_enabled ? '' : 'disabled'} onclick="restoreBackupFile()" title="${maintenance?.restore_enabled ? 'Restaurer un fichier .sql.gz' : 'Désactivé : RESTORE_ENABLED=1 et RESTORE_TARGET_ISOLATED=1 requis, uniquement sur une base isolée'}">Restaurer une sauvegarde${maintenance?.restore_enabled ? '' : ' (désactivé)'}</button><button class="bd" ${maintenance?.global_reset_enabled ? '' : 'disabled'} onclick="resetGlobalData()" title="${maintenance?.global_reset_enabled ? 'Réinitialisation limitée aux données plateforme' : 'Suspendue : la réinitialisation ne doit pas toucher aux données opérationnelles des clients'}">Réinitialisation globale${maintenance?.global_reset_enabled ? '' : ' (suspendue)'}</button>` : ''}
      </div>
      ${ME?.is_global && (!maintenance?.restore_enabled || !maintenance?.global_reset_enabled) ? `<p class="warn" style="font-size:12px;margin-top:8px">Restauration / réinitialisation réservées au Super Admin. Restauration SQL complète désactivée ou cible isolée non confirmée. La réinitialisation globale est suspendue : elle ne doit pas toucher aux données opérationnelles des clients.</p>` : ''}
      ${ME?.is_global ? `<div class="card" style="margin-top:10px"><b>Protection contre la perte du PC</b><p style="font-size:12px;color:var(--m)">Le fichier .sql.gz peut être téléchargé et conservé hors du PC. L’envoi email de confirmation dépend de SMTP. La pièce jointe de sauvegarde est optionnelle (BACKUP_EMAIL_ATTACH=1) et limitée par la configuration du serveur.</p><input id="restoreBackupInput" type="file" accept=".gz,.sql.gz,application/gzip" style="display:none" onchange="submitBackupRestore(this)"><p style="font-size:12px;color:var(--m)">Restauration SQL complète : ${maintenance?.restore_enabled ? 'activée (base isolée déclarée)' : 'désactivée par sécurité ; exige RESTORE_ENABLED=1 et RESTORE_TARGET_ISOLATED=1 sur une base isolée'}. Réinitialisation globale : ${maintenance?.global_reset_enabled ? 'activée' : 'suspendue par sécurité afin de protéger les données clients'}.</p></div>` : ''}
      <h3 style="margin:16px 0 8px">Fichiers</h3>
      ${T(['Fichier', 'Taille', 'Date', ''], (list || []).map(b => [
        esc(b.name || b.file || '—'),
        b.size ? (Math.round(b.size / 1024) + ' Ko') : '—',
        b.created_at ? new Date(b.created_at).toLocaleString() : (b.mtime || b.date || '—'),
        b.name ? `<a class="b2" href="/api/admin/backups/${encodeURIComponent(b.name)}" target="_blank">Télécharger</a>` : ''
      ]))}
      <h3 style="margin:16px 0 8px">Journal (réel — jamais simulé)</h3>
      ${T(['Quand', 'Type', 'Statut', 'Fichier / erreur', 'Durée', 'E-mail'], (logs || []).map(l => [
        l.finished_at || l.started_at ? new Date(l.finished_at || l.started_at).toLocaleString() : '—',
        esc(l.kind || ''),
        l.status === 'ok' ? '<span style="color:var(--g)">OK</span>' : '<span style="color:var(--r)">ÉCHEC</span>',
        esc(l.file_name || l.error_message || '—'),
        l.duration_ms != null ? (l.duration_ms + ' ms') : '—',
        l.email_sent ? 'Oui' : (l.email_error ? esc(l.email_error) : '—')
      ]))}
      <p style="font-size:12px;color:var(--m);margin-top:8px">
        Les sauvegardes sont exécutées réellement via pg_dump. Les notifications par e-mail nécessitent une configuration SMTP valide.
      </p>`;
  }

  window.restoreBackupFile = function () {
    if (!ME?.is_global) return toast('Réservé au Super Admin', 'error');
    const input = document.getElementById('restoreBackupInput'); if (input) input.click();
  };
  window.submitBackupRestore = async function (input) {
    const file = input?.files?.[0]; if (!file) return;
    if (!/\.sql\.gz$/i.test(file.name)) { toast('Choisissez une sauvegarde .sql.gz', 'error'); input.value = ''; return; }
    if (!confirm('La restauration remplacera le contenu de la base par celui de la sauvegarde. Une sauvegarde de sécurité sera créée avant. Continuer ?')) { input.value = ''; return; }
    try {
      const r = await fetch('/api/admin/maintenance/restore', { method: 'POST', headers: { Authorization: 'Bearer ' + TK, 'Content-Type': 'application/gzip' }, body: file });
      const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.error || 'Restauration refusée (' + r.status + ')');
      toast('Restauration terminée. Reconnectez-vous.', 'success'); setTimeout(() => location.reload(), 1200);
    } catch (e) { toast('Restauration impossible : ' + (e.message || e), 'error'); }
    finally { input.value = ''; }
  };
  window.resetGlobalData = async function () {
    if (!ME?.is_global) return toast('Réservé au Super Admin', 'error');
    const phrase = prompt('ATTENTION : cette opération supprime les données métier après création d’une sauvegarde. Pour confirmer, tapez exactement : SUPPRIMER TOUTES LES DONNEES');
    if (phrase !== 'SUPPRIMER TOUTES LES DONNEES') return toast('Réinitialisation annulée', 'info');
    try {
      const out = await Po('/admin/maintenance/reset-global', { confirmation: phrase });
      toast('Réinitialisation terminée. Sauvegarde : ' + out.backup, 'success');
      setTimeout(() => location.reload(), 1200);
    } catch (e) { toast('Réinitialisation refusée : ' + (errMsg(e) || e.message || e), 'error'); }
  };

  window.runBackupNow = async function () {
    toast('Sauvegarde en cours…', 'info');
    try {
      const out = await Po('/admin/backups', {});
      toast('Sauvegarde créée : ' + (out.name || 'ok'), 'success');
      if (typeof goAdminTab === 'function') goAdminTab('backups');
      else go('admin');
    } catch (e) {
      const msg = typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e));
      toast('Échec sauvegarde : ' + msg, 'error');
    }
  };

  async function renderSystem() {
    if (!can('user.manage')) return '';
    const info = await G('/admin/info');
    const migr = (info.migrations || []).map(m =>
      `<tr><td><code>${esc(m.name)}</code></td><td>${esc(m.applied_at || '')}</td></tr>`
    ).join('');
    return `<div class="cards">
      ${card('Node.js', esc(info.node || '—'))}
      ${card('PostgreSQL', esc(info.postgres || '—'))}
      ${card('Uptime', (info.uptime_s || 0) + ' s')}
      ${card('Hôte', esc(info.host || '—'))}
      ${card('Sauvegardes', String(info.backups || 0))}
      ${card('Backup auto', info.backup_auto ? 'Oui' : 'Non')}
      ${card('Mail configuré', info.mail_configured ? 'Oui' : 'Non')}
    </div>
    <h3 style="margin-top:16px">Migrations appliquées</h3>
    <table class="t"><thead><tr><th>Fichier</th><th>Appliquée le</th></tr></thead>
    <tbody>${migr || '<tr><td colspan="2">Aucune</td></tr>'}</tbody></table>`;
  }

  window.goAdminTab = safe(function (tab) {
    window.__adminTab = tab;
    go('admin');
  });

  // Helpers HTTP PUT si absents
  if (typeof window.Pu !== 'function') {
    window.Pu = safe(async function (path, body) {
      return await api('PUT', path, body);
    });
  }

  // Réservé exclusivement à l'Administrateur Principal (is_global).
  // La permission ci-dessous est secondaire : canView() bloque déjà tout compte non-global.
  Object.assign(V, { admin: ['Contrôle administrateur', 'user.manage'] });
  Object.assign(VM, { admin: vAdminHub });

  // Icône nav
  if (typeof NAV_ICONS !== 'undefined') {
    NAV_ICONS.admin = '🛡️';
  }
})();
