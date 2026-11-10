/* Modules abonnement activables : réconciliation, clôture, reçus, packs, demandes */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  function modOn(code) {
    if (typeof ME !== 'undefined' && ME && ME.is_global) return true;
    const c = (typeof ME !== 'undefined' && ME && ME.contract) || null;
    if (!c || c.unrestricted) return true;
    if (c.suspended) return false;
    const m = (c.features && c.features.modules) || {};
    return !!m[code];
  }

  // ----- Réconciliation -----
  async function vReconcile() {
    if (!modOn('reconcile')) {
      return `<p class="warn">Module « Réconciliation pompes » non inclus dans votre abonnement.</p>
        <p style="font-size:13px;color:var(--m)">Contactez l'administrateur pour activer ce module (offre Pro / RH+).</p>`;
    }
    const runs = await G('/reconcile/runs').catch(() => []);
    return `<h2 style="margin-top:0">Réconciliation pompes / ventes / stock</h2>
      <p style="font-size:13px;color:var(--m)">Compare les volumes pompés, vendus et les seuils de stock. Génère des alertes en cas d'écart.</p>
      <div class="bar">
        <button onclick="runReconcile()">Lancer une réconciliation</button>
        <button class="b2" onclick="runReconcileShift()">Sur le quart ouvert</button>
      </div>
      ${T(['Date', 'Statut', 'Écarts', ''], (runs || []).map(r => [
        r.created_at ? new Date(r.created_at).toLocaleString() : '—',
        r.status === 'ok' ? '<span class="ok">OK</span>' : (r.status === 'critical' ? '<span class="tag x">Critique</span>' : '<span class="tag">Attention</span>'),
        (r.summary && r.summary.gaps != null) ? String(r.summary.gaps) : '—',
        r.id ? `<button class="b2" onclick="viewReconcile(${r.id})">Détail</button>` : ''
      ]))}`;
  }
  window.runReconcile = safe(async () => {
    toast('Réconciliation…', 'info');
    const r = await Po('/reconcile/run', {});
    toast(r.status === 'ok' ? 'Aucun écart critique' : (r.gaps || []).length + ' écart(s)', r.status === 'ok' ? 'success' : 'error');
    go('reconcile');
  });
  window.runReconcileShift = safe(async () => {
    const shifts = await G('/shifts?status=open').catch(() => []);
    const list = Array.isArray(shifts) ? shifts : (shifts.items || shifts.rows || []);
    if (!list.length) { toast('Aucun quart ouvert', 'error'); return; }
    const r = await Po('/reconcile/run', { shift_id: list[0].id });
    toast(r.status === 'ok' ? 'Quart OK' : (r.gaps || []).length + ' écart(s)', r.status === 'ok' ? 'success' : 'error');
    go('reconcile');
  });
  window.viewReconcile = safe(async (id) => {
    const r = await G('/reconcile/runs/' + id);
    const gaps = r.gaps || [];
    modal(`<h3>Réconciliation #${id}</h3>
      <p>Statut : <strong>${esc(r.status)}</strong></p>
      <ul>${gaps.map(g => `<li><span class="tag ${g.level === 'critical' ? 'x' : ''}">${esc(g.type)}</span> ${esc(g.message)}</li>`).join('') || '<li>Aucun écart</li>'}</ul>
      <button class="b2" onclick="closeM()">Fermer</button>`);
  });

  // ----- Clôture période -----
  async function vPeriodLock() {
    if (!modOn('period_lock')) {
      return `<p class="warn">Module « Clôture de période » non inclus dans votre abonnement.</p>`;
    }
    const locks = await G('/period-locks').catch(() => []);
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    return `<h2 style="margin-top:0">Clôture de période</h2>
      <p style="font-size:13px;color:var(--m)">Une période clôturée refuse les nouvelles écritures (ventes, dépenses…). Déverrouillage possible avec motif.</p>
      <div class="bar">
        <button onclick="lockPeriod('day','${today}')">Clôturer aujourd'hui (${today})</button>
        <button class="b2" onclick="lockPeriod('month','${month}')">Clôturer le mois (${month})</button>
      </div>
      ${T(['Type', 'Période', 'Clôturée le', ''], (locks || []).map(l => [
        esc(l.period_type), esc(l.period_key),
        l.locked_at ? new Date(l.locked_at).toLocaleString() : '—',
        `<button class="b2" onclick="unlockPeriod(${l.id})">Déverrouiller</button>`
      ]))}`;
  }
  window.lockPeriod = safe(async (type, key) => {
    await Po('/period-locks', { period_type: type, period_key: key });
    toast('Période clôturée', 'success');
    go('periodlock');
  });
  window.unlockPeriod = safe(async (id) => {
    form('Déverrouiller la période', [['reason', 'Motif (obligatoire)']], {}, async d => {
      if (!d.reason || d.reason.length < 3) { toast('Motif trop court', 'error'); return; }
      await Po('/period-locks/' + id + '/unlock', { reason: d.reason });
      closeM(); toast('Déverrouillée', 'success'); go('periodlock');
    });
  });

  // ----- Packs (admin) -----
  async function vPacks() {
    if (!(ME && ME.is_global)) return '<p class="warn">Réservé à l\'Administrateur Principal.</p>';
    const packs = await G('/admin/packs').catch(() => G('/packs').catch(() => []));
    const reqs = await G('/admin/renewal-requests').catch(() => []);
    return `<h2 style="margin-top:0">Offres d'abonnement (packs)</h2>
      <p style="font-size:13px;color:var(--m)">Chaque pack active un ensemble de modules. Appliquez un pack à un client depuis Licences, ou cochez les modules un par un.</p>
      ${T(['Code', 'Offre', 'Durée', 'Users', 'Stations', 'Prix indicatif', 'Modules'], (packs || []).map(p => {
        const mods = (p.features && p.features.modules) || {};
        const on = Object.keys(mods).filter(k => mods[k]).join(', ');
        return [
          `<code>${esc(p.code)}</code>`, esc(p.label),
          p.duration_unit === 'indefinite' ? '∞' : ((p.duration_value || '') + ' ' + (p.duration_unit || '')),
          p.max_users == null ? '∞' : String(p.max_users),
          p.max_stations == null ? '∞' : String(p.max_stations),
          esc(p.price_label || '—'),
          `<small>${esc(on)}</small> <button class="b2" onclick="editSubscriptionPack('${esc(p.code)}')">Modifier</button>`
        ];
      }))}
      <button class="b1" style="margin-top:12px" onclick="createSubscriptionPack()">+ Ajouter une formule</button>
      <h3 style="margin-top:24px">Demandes de renouvellement</h3>
      ${T(['Date', 'Client', 'Message', 'Statut', ''], (reqs || []).map(x => [
        x.created_at ? new Date(x.created_at).toLocaleString() : '—',
        esc(x.client_name || ''),
        esc(x.message || ''),
        esc(x.status),
        x.status === 'pending'
          ? `<button class="b2" onclick="handleRenewal(${x.id},'accepted')">Accepter</button>
             <button class="b2" onclick="handleRenewal(${x.id},'rejected')">Refuser</button>`
          : ''
      ]))}`;
  }
  const PACK_MODULES = ['sales','stock','finance','reports','receipts','hr','reconcile','period_lock','price_history','personalization'];
  function packFormFields() {
    return [
      ['code','Code (unique)'], ['label','Nom de l’offre'], ['description','Description'],
      ['duration_unit','Unité de durée','s',[['day','Jour'],['month','Mois'],['year','Année'],['indefinite','Indéfinie']]],
      ['duration_value','Durée (nombre, ignoré si indéfinie)','number'],
      ['max_users','Nombre maximum d’utilisateurs (vide = illimité)','number'],
      ['max_stations','Nombre maximum de stations (vide = illimité)','number'],
      ['price_label','Prix indicatif'], ['modules','Modules activés (séparés par des virgules)'],
      ['sort_order','Ordre d’affichage','number']
    ];
  }
  function packFormDefaults(p) {
    const modules = (p.features && p.features.modules) || {};
    return { code:p.code||'', label:p.label||'', description:p.description||'', duration_unit:p.duration_unit||'month',
      duration_value:p.duration_value??1, max_users:p.max_users??'', max_stations:p.max_stations??'',
      price_label:p.price_label||'', modules:Object.keys(modules).filter(k=>modules[k]).join(', '), sort_order:p.sort_order??100 };
  }
  function packPayload(d) {
    const modules = String(d.modules||'').split(',').map(x=>x.trim()).filter(Boolean);
    return { ...d, duration_value:d.duration_unit==='indefinite'?null:(Number(d.duration_value)||1),
      max_users:d.max_users===''?null:Number(d.max_users), max_stations:d.max_stations===''?null:Number(d.max_stations),
      sort_order:Number(d.sort_order)||100, modules };
  }
  window.editSubscriptionPack = safe(async code => {
    const packs = await G('/admin/packs'); const p = packs.find(x=>x.code===code);
    if (!p) { toast('Offre introuvable','error'); return; }
    form('Modifier la formule : '+p.label, packFormFields(), packFormDefaults(p), async d => {
      await api('PUT','/admin/packs/'+encodeURIComponent(code),packPayload(d));
      closeM(); toast('Formule mise à jour','success'); go('packs');
    });
  });
  window.createSubscriptionPack = safe(async () => {
    form('Ajouter une formule', packFormFields(), {duration_unit:'month',duration_value:1,max_users:5,max_stations:1,price_label:'Sur devis',modules:PACK_MODULES.slice(0,5).join(', '),sort_order:100}, async d => {
      await api('POST','/admin/packs',packPayload(d));
      closeM(); toast('Nouvelle formule créée','success'); go('packs');
    });
  });

  window.handleRenewal = safe(async (id, status) => {
    await Po('/admin/renewal-requests/' + id + '/handle', { status });
    toast(status === 'accepted' ? 'Acceptée — renouvelez la licence du client' : 'Refusée', 'success');
    go('packs');
  });

  // Demande renouvellement côté client
  window.requestRenewal = safe(async () => {
    form('Demander un renouvellement', [
      ['preferred_duration_unit', 'Durée souhaitée', 's', [
        ['month', 'Mois'], ['year', 'Année'], ['day', 'Jours'], ['indefinite', 'Indéfinie']
      ]],
      ['preferred_duration_value', 'Nombre', 'number'],
      ['message', 'Message']
    ], { preferred_duration_unit: 'month', preferred_duration_value: 1 }, async d => {
      await Po('/license/renewal-request', {
        message: d.message || null,
        preferred_duration_unit: d.preferred_duration_unit,
        preferred_duration_value: +(d.preferred_duration_value || 1)
      });
      closeM(); toast('Demande envoyée à l\'administrateur', 'success');
    });
  });

  // Ticket / reçu
  window.printReceipt = safe(async (saleId) => {
    if (!modOn('receipts')) { toast('Module tickets non activé', 'error'); return; }
    const r = await G('/sales/' + saleId + '/receipt');
    const w = window.open('', '_blank', 'width=320,height=600');
    if (!w) { toast('Autorisez les popups pour imprimer', 'error'); return; }
    // r.html est déjà échappé côté serveur (CORR-005) ; r.text et saleId sont échappés ici (CORR-012).
    const escR = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    w.document.write(`<!DOCTYPE html><html><head><title>Ticket #${escR(saleId)}</title>
      <style>body{font-family:monospace;font-size:12px;margin:8px} @media print{button{display:none}}</style></head>
      <body>${r.html || '<pre>' + escR(r.text || '') + '</pre>'}
      <button onclick="window.print()">Imprimer</button></body></html>`);
    w.document.close();
  });

  Object.assign(V, {
    reconcile: ['Réconciliation', 'report.view'],
    periodlock: ['Clôture période', 'shift.close'],
    packs: ['Offres abonnement', '*']
  });
  Object.assign(VM, {
    reconcile: vReconcile,
    periodlock: vPeriodLock,
    packs: vPacks
  });
})();
