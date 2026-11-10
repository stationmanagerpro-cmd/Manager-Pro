/* Propositions produit 2026-10-14 — packs déjà dans ext-contracts ; ici : santé alertes, messagerie, licence, facturation */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  // —— 5. Santé des alertes auto ——
  V.alerthealth = ['Santé alertes auto', 'settings.edit|user.manage'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.alerthealth = '💓';
  VM.alerthealth = async function () {
    const d = await G('/messaging/alert-health').catch(e => ({ error: e.message || String(e) }));
    if (d.error && !d.enabled && d.enabled !== false) {
      return '<div class="card"><h2>Santé des alertes automatiques</h2><p class="warn">' + esc(d.error) + '</p>' +
        '<p class="muted">Vérifiez can_use_auto_alerts sur le contrat et les règles dans la configuration des alertes.</p>' +
        '<button class="b2" onclick="go(\'alertcfg\')">Configuration alertes</button></div>';
    }
    const ok = d.enabled && !d.last_error;
    const rules = d.rules || {};
    const recent = d.recent_alerts || [];
    return '<div class="card"><h2 style="margin-top:0">Santé des alertes automatiques</h2>' +
      '<div class="cards">' +
      '<div class="card"><small>Planificateur</small><b>' + (d.enabled ? 'Actif' : 'Désactivé') + '</b></div>' +
      '<div class="card"><small>Dernière exécution</small><b>' + esc(d.last_run_at ? new Date(d.last_run_at).toLocaleString('fr-FR') : 'Jamais') + '</b></div>' +
      '<div class="card"><small>Règles actives</small><b>' + (rules.active || 0) + ' / ' + (rules.total || 0) + '</b></div>' +
      '<div class="card"><small>Statut</small><b>' + (ok ? 'OK' : (d.last_error ? 'Erreur' : 'À vérifier')) + '</b></div>' +
      '</div>' +
      (d.last_error ? '<p class="warn">Dernière erreur : ' + esc(d.last_error) + '</p>' : '') +
      (d.last_result ? '<pre style="font-size:12px;max-height:120px;overflow:auto">' + esc(JSON.stringify(d.last_result, null, 2)) + '</pre>' : '') +
      '<p class="muted" style="font-size:12px">Types scannés : ' + esc((d.scanned_kinds || []).join(', ')) +
      ' · Intervalle : ' + Math.round((d.interval_ms || 300000) / 60000) + ' min</p>' +
      '<div class="r" style="gap:8px;flex-wrap:wrap">' +
      '<button onclick="alertHealthRun()">Lancer un scan maintenant</button>' +
      '<button class="b2" onclick="go(\'alertcfg\')">Configurer les règles</button>' +
      '<button class="b2" onclick="go(\'alert\')">Centre d’alertes</button>' +
      '<button class="b2" onclick="go(\'alerthealth\')">Actualiser</button>' +
      '</div></div>' +
      '<div class="card" style="margin-top:12px"><h3>Dernières alertes système</h3>' +
      (recent.length
        ? T(['Date', 'Type', 'Message'], recent.map(a => [
            a.created_at ? new Date(a.created_at).toLocaleString('fr-FR') : '—',
            esc(a.kind), esc((a.body || '').slice(0, 120))
          ]))
        : '<p class="muted">Aucune alerte récente.</p>') +
      '</div>';
  };
  window.alertHealthRun = async function () {
    try {
      toast('Scan en cours…', 'info');
      await Po('/messaging/alert-health/run', {});
      toast('Scan terminé', 'success');
      go('alerthealth');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  // —— 6. Messagerie onboarding ——
  const prevMsg = VM.msg;
  if (typeof prevMsg === 'function') {
    VM.msg = async function () {
      try {
        return await prevMsg.apply(this, arguments);
      } catch (e) {
        const code = e && (e.code || e.status);
        const text = (e && e.message) || String(e);
        if (code === 403 || /non inclus|FEATURE_DISABLED|contrat/i.test(text)) {
          return '<div class="card"><h2>Messagerie non activée</h2>' +
            '<p>La messagerie interne n’est pas incluse dans votre contrat actuel.</p>' +
            '<p class="muted">Demandez à l’Administrateur Principal d’activer <b>can_use_messaging</b> ' +
            '(et éventuellement <b>messaging_support</b> pour le dialogue avec la plateforme).</p>' +
            '<div class="r"><button class="b2" onclick="go(\'dash\')">Retour tableau de bord</button></div></div>';
        }
        throw e;
      }
    };
  }
  // Intercepter le chargement messagerie si features off
  const origG = typeof G === 'function' ? null : null;
  // Soft gate on view entry via canView already; add banner when contract present but messaging off
  const prevMsg2 = VM.msg;
  VM.msg = async function () {
    const f = (ME && ME.contract && ME.contract.features) || {};
    const on = f.can_use_messaging !== false && (f.modules ? f.modules.messaging !== false : true);
    if (!on && !(ME && ME.is_global)) {
      return '<div class="card"><h2>Messagerie non activée</h2>' +
        '<p>Cette fonctionnalité n’est pas autorisée sur votre abonnement.</p>' +
        '<ul style="font-size:14px"><li>Flag : <code>can_use_messaging</code></li>' +
        '<li>Support plateforme : <code>messaging_support</code></li></ul>' +
        '<p class="muted">Contactez l’Administrateur Principal pour demander l’activation.</p>' +
        '<button class="b2" onclick="go(\'dash\')">Retour</button></div>';
    }
    if (typeof prevMsg2 === 'function') return prevMsg2.apply(this, arguments);
    return '<p class="muted">Module messagerie en cours de chargement…</p>';
  };

  // —— 9. Indicateur licence côté client ——
  function renderLicenseBadge() {
    try {
      const c = ME && ME.contract;
      if (!c || ME.is_global) return;
      let el = document.getElementById('smp-license-badge');
      const host = document.querySelector('.topbar, header, #top, .shell-top, [data-brand="name"]');
      const parent = document.getElementById('topbar') || document.querySelector('.main header') || document.body;
      const days = c.days_remaining != null ? c.days_remaining
        : (c.end_date ? Math.ceil((new Date(c.end_date) - new Date()) / 864e5) : null);
      const indef = c.is_indefinite || c.license_status === 'INDEFINIE';
      const status = c.license_status || c.status || (indef ? 'INDEFINIE' : 'ACTIVE');
      let label = indef ? 'Licence indéfinie' : (days != null ? (days + ' j. restants') : status);
      if (status === 'EXPIREE' || status === 'SUSPENDUE') label = status;
      const color = (status === 'EXPIREE' || status === 'SUSPENDUE') ? '#ef4444'
        : (days != null && days <= 14 ? '#f59e0b' : '#22c55e');
      const mods = (c.features && c.features.modules) || {};
      const f = c.features || {};
      let modCount = 0;
      Object.keys(mods).forEach(k => { if (mods[k]) modCount++; });
      const html = '<span id="smp-license-badge" title="Modules actifs ≈ ' + modCount +
        '" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;' +
        'background:' + color + '22;border:1px solid ' + color + '55;color:#0f172a;font-size:12px;font-weight:600">' +
        '📜 ' + label + (modCount ? ' · ' + modCount + ' mod.' : '') + '</span>';
      if (el) el.outerHTML = html;
      else {
        const bar = document.querySelector('.top-actions') || document.querySelector('.topbar');
        if (bar) bar.insertAdjacentHTML('afterbegin', html);
      }
    } catch (_) {}
  }
  const prevShell = window.initShell;
  window.initShell = async function () {
    if (typeof prevShell === 'function') await prevShell.apply(this, arguments);
    renderLicenseBadge();
  };
  // Aussi après go()
  const _go = window.go;
  if (typeof _go === 'function') {
    window.go = async function () {
      const r = await _go.apply(this, arguments);
      try { renderLicenseBadge(); } catch (_) {}
      return r;
    };
  }

  // —— 4. Historique contrat (bouton Superadmin) ——
  window.clContractHistory = async function (id) {
    try {
      const d = await G('/admin/clients/' + id + '/contract-history');
      const rows = d.history || [];
      modal('<h3>Historique contrat — ' + esc(d.client_name || ('#' + id)) + '</h3>' +
        (rows.length
          ? T(['Date', 'Admin', 'Action', 'Table'], rows.map(h => [
              h.created_at ? new Date(h.created_at).toLocaleString('fr-FR') : '—',
              esc(h.admin_login || '—'),
              esc(h.action || h.module || '—'),
              esc(h.table_name || '—')
            ]))
          : '<p class="muted">Aucun événement d’audit lié à ce contrat.</p>') +
        '<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  // Enrichir liste clients avec bouton historique si possible
  const prevClients = VM.clients;
  if (typeof prevClients === 'function') {
    VM.clients = async function () {
      let html = await prevClients.apply(this, arguments);
      // inject helper text
      html = '<p class="muted" style="font-size:12px">Astuce : packs d’autorisations disponibles à la création / édition de contrat. ' +
        'Historique : <code>clContractHistory(id)</code> depuis Gérer.</p>' + html;
      return html;
    };
  }

  // —— Shell: add alert health to nav if TREE exists ——
  try {
    if (typeof window !== 'undefined') {
      // deferred: ext-shell already built TREE; rely on "Autres" filet de sécurité via V registration
    }
  } catch (_) {}

  // —— File hors-ligne visible ——
  V.offlineq = ['File hors-ligne', '*'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.offlineq = '📡';
  VM.offlineq = async function () {
    const items = typeof listOfflineQueue === 'function' ? await listOfflineQueue() : [];
    const pending = items.filter(x => x.status === 'pending' || !x.status);
    const done = items.filter(x => x.status === 'done' || x.status === 'synced');
    const failed = items.filter(x => x.status === 'error' || x.status === 'failed');
    let online = navigator.onLine;
    return '<div class="card"><h2 style="margin-top:0">File hors-ligne</h2>' +
      '<p class="muted">Opérations enregistrées sur cet appareil en attendant le réseau.</p>' +
      '<div class="cards">' +
      '<div class="card"><small>Réseau</small><b>' + (online ? 'En ligne' : 'Hors ligne') + '</b></div>' +
      '<div class="card"><small>En attente</small><b>' + pending.length + '</b></div>' +
      '<div class="card"><small>Synchronisées</small><b>' + done.length + '</b></div>' +
      '<div class="card"><small>En erreur</small><b>' + failed.length + '</b></div>' +
      '</div>' +
      '<div class="r" style="gap:8px;margin:12px 0">' +
      (online ? '<button onclick="offlineFlushNow()">Synchroniser maintenant</button>' : '<button disabled>Synchroniser (hors ligne)</button>') +
      '<button class="b2" onclick="go(\'offlineq\')">Actualiser</button>' +
      '</div>' +
      '<h3>En attente</h3>' +
      (pending.length
        ? T(['#', 'Type', 'Date', 'Statut'], pending.map(x => [
            x.id, esc(x.method || x.type || x.path || '—'),
            x.created_at ? new Date(x.created_at).toLocaleString('fr-FR') : '—',
            esc(x.status || 'pending')
          ]))
        : '<p class="muted">Aucune opération en attente.</p>') +
      (failed.length ? '<h3>Refusées / en erreur — à ressaisir</h3><p class="muted">Le serveur a refusé ces opérations : elles ne sont plus envoyées. Ressaisissez la vente si elle a bien eu lieu, puis supprimez la ligne.</p>' + T(['#', 'Détail', 'Saisie le', 'Motif du refus', ''], failed.map(x => [
        x.id, esc(x.label || x.path || x.type || '—'), x.created_at ? new Date(x.created_at).toLocaleString('fr-FR') : '—', esc(x.error || x.message || '—'),
        '<button class="b2" onclick="offlineDiscard(' + Number(x.id) + ')">Supprimer</button>'
      ])) : '') +
      '</div>';
  };
  window.offlineFlushNow = async function () {
    try {
      toast('Synchronisation…', 'info');
      if (typeof flushOfflineQueue === 'function') await flushOfflineQueue();
      if (typeof refreshOfflineBadge === 'function') await refreshOfflineBadge();
      toast('Synchronisation terminée', 'success');
      go('offlineq');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };

  // —— Rôles prédéfinis : aide à la création ——
  window.showRolePresets = async function () {
    try {
      const list = await G('/roles/presets');
      modal('<h3 style="margin-top:0">Rôles métier prédéfinis</h3>' +
        '<p class="muted">Choisissez le rôle adapté lors de l’octroi d’un accès compte. Les permissions sont préconfigurées.</p>' +
        (list || []).map(r =>
          '<div class="card" style="margin:8px 0;padding:10px">' +
          '<b>' + esc(r.icon || '') + ' ' + esc(r.label) + '</b> <code>' + esc(r.code) + '</code>' +
          '<p style="margin:6px 0 0;font-size:13px">' + esc(r.summary || '') + '</p>' +
          '<p class="muted" style="font-size:11px;margin:4px 0 0">' + (r.permissions || []).length + ' permission(s)</p>' +
          '</div>'
        ).join('') +
        '<div class="r"><button class="b2" onclick="closeM()">Fermer</button></div>');
    } catch (e) {
      toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
    }
  };


})();