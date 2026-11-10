/* Configuration — Configuration du Dashboard par l'Administrateur */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const CARD_KEYS = [
    ['revenue', "Chiffre d'affaires"],
    ['fuel', 'Ventes carburant'],
    ['products', 'Ventes produits'],
    ['expenses', 'Dépenses'],
    ['net', 'Résultat net (CA − dépenses)'],
    ['margin', 'Marge brute'],
    ['margin_pct', 'Taux de marge brute'],
    ['profit', 'Résultat de gestion'],
    ['cash', 'Liquidités caisse'],
    ['receivables', 'Créances clients'],
    ['payables', 'Dettes fournisseurs'],
    ['low_stock', 'Stock bas'],
    ['open_shift', 'Quarts ouverts'],
    ['alerts', 'Alertes non lues']
  ];
  const CHART_KEYS = [
    ['daily_revenue', 'Graphique CA journalier'],
    ['payments_by_method', 'Répartition paiements']
  ];
  const SECTION_KEYS = [
    ['profile', 'Profil connecté / date'],
    ['recent_activity', 'Activité récente'],
    ['shifts', 'Liste quarts ouverts'],
    ['low_stock_list', 'Liste stock bas'],
    ['fuel_by_product', 'Carburant par produit'],
    ['shortcuts', 'Raccourcis modules']
  ];
  const SHORTCUT_OPTS = ['jour', 'caisse', 'quart', 'ventes', 'cli', 'four', 'prod', 'pompes', 'alert', 'exports', 'audit', 'param', 'emp'];

  function checkboxes(prefix, keys, values) {
    return keys.map(([k, label]) => {
      const on = values && values[k] !== false;
      return `<label style="display:flex;align-items:center;gap:8px;margin:4px 0">
        <input type="checkbox" id="${prefix}_${k}" ${on ? 'checked' : ''}> ${esc(label)}
      </label>`;
    }).join('');
  }

  async function vDashCfg() {
    const d = await G('/dashboard/config');
    if (!d.raw && !d.is_global) {
      return `<p class="warn">Seul un utilisateur avec permission settings.edit (ou Admin Principal) peut configurer le dashboard.</p>
        <button class="b2" onclick="go('dash')">Retour</button>`;
    }
    const raw = d.raw || d.config;
    const cards = raw.cards || {};
    const charts = raw.charts || {};
    const sections = raw.sections || {};
    const shortcuts = raw.shortcuts || [];
    const byRole = raw.by_role || {};

    const roleCodes = Object.keys(byRole);
    let roleHtml = roleCodes.map(role => {
      const ov = byRole[role];
      if (!ov) return `<div class="card"><b>${esc(role)}</b><p style="font-size:12px;color:var(--m)">Hérite de la config globale</p></div>`;
      return `<div class="card"><b>Rôle ${esc(role)}</b>
        <p style="font-size:12px;color:var(--m)">Cartes : ${Object.entries(ov.cards || {}).filter(([, v]) => v).map(([k]) => k).join(', ') || '—'}</p>
        <p style="font-size:12px;color:var(--m)">Raccourcis : ${(ov.shortcuts || []).join(', ') || '—'}</p>
      </div>`;
    }).join('');

    return `<h2 style="margin-top:0">Configuration du Dashboard</h2>
      <p style="font-size:12px;color:var(--m)">Définissez les cartes, graphiques, sections et raccourcis visibles. Les overrides par rôle s'appliquent aux employés / gérants.</p>
      <div class="card">
        <b>Cartes KPI (global)</b>
        ${checkboxes('dc', CARD_KEYS, cards)}
      </div>
      <div class="card">
        <b>Graphiques</b>
        ${checkboxes('dg', CHART_KEYS, charts)}
      </div>
      <div class="card">
        <b>Sections</b>
        ${checkboxes('ds', SECTION_KEYS, sections)}
      </div>
      <div class="card">
        <b>Raccourcis (ordre)</b>
        <p style="font-size:12px;color:var(--m)">Codes séparés par des virgules : ${SHORTCUT_OPTS.join(', ')}</p>
        <input id="dc_shortcuts" class="q" style="width:100%" value="${esc(shortcuts.join(', '))}">
      </div>
      <h3>Overrides par rôle</h3>
      <div class="cards">${roleHtml || '<p style="color:var(--m)">Aucun override défini</p>'}</div>
      <div class="bar" style="margin-top:12px">
        <button onclick="saveDashCfg()">Enregistrer</button>
        <button class="b2" onclick="go('dash')">Retour dashboard</button>
        <button class="b2" onclick="resetDashCfg()">Réinitialiser</button>
      </div>`;
  }

  window.saveDashCfg = safe(async () => {
    const cards = {};
    CARD_KEYS.forEach(([k]) => { cards[k] = !!document.getElementById('dc_' + k)?.checked; });
    const charts = {};
    CHART_KEYS.forEach(([k]) => { charts[k] = !!document.getElementById('dg_' + k)?.checked; });
    const sections = {};
    SECTION_KEYS.forEach(([k]) => { sections[k] = !!document.getElementById('ds_' + k)?.checked; });
    const scRaw = (document.getElementById('dc_shortcuts')?.value || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);

    // Preserve existing by_role from server
    const current = await G('/dashboard/config');
    const by_role = (current.raw && current.raw.by_role) || {};

    await api('PUT', '/settings/dashboard_config', {
      value: { cards, charts, sections, shortcuts: scRaw, by_role }
    });
    toast('Configuration dashboard enregistrée', 'success');
    go('dash');
  });

  window.resetDashCfg = safe(async () => {
    if (!confirm('Réinitialiser la configuration dashboard aux valeurs par défaut ?')) return;
    await Po('/settings/reset/dashboard_config', {});
    toast('Réinitialisé', 'success');
    go('dashcfg');
  });

  // Réservé au SuperAdmin (canView bloque les comptes clients).
  Object.assign(V, { dashcfg: ['Config. Dashboard', 'user.manage'] });
  Object.assign(VM, { dashcfg: vDashCfg });
})();
