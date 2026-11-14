/* ext-vendeurs.js — Vendeurs & commissions
   Lié à :
   - GET  /api/seller-commissions/summary  (ventes réelles sales.employee_id)
   - GET/PUT /api/seller-commissions/config (taux & objectif par défaut station)
   - PUT /api/seller-commissions/employees/:id (objectif & taux personnalisés)
   - POST /api/seller-commissions/primes
   - POST /api/seller-commissions/reglements
   - GET  /api/seller-commissions/entries
*/
(function () {
  'use strict';

  let vendState = { period: 'month', tab: 'perf' };
  // Cache des vendeurs affichés : les boutons ne transmettent que l'identifiant (pas de texte dans l'attribut onclick).
  let vendCache = {};
  let vendLast = null;
  function vendGet(id) { return vendCache[String(id)] || { id: id, name: '', objectif: 0, taux: 0, total_du: 0 }; }

  function money(v) {
    const n = Number(v) || 0;
    if (typeof f === 'function') return f(n);
    return n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' FCFA';
  }

  function progressBar(current, target, color) {
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const col = color || (pct >= 100 ? '#16a34a' : '#2563eb');
    return '<div style="display:flex;align-items:center;gap:8px;min-width:120px">' +
      '<div style="flex:1;height:8px;background:var(--bd);border-radius:4px;overflow:hidden;min-width:60px">' +
      '<div style="height:100%;width:' + pct + '%;background:' + col + ';border-radius:4px"></div></div>' +
      '<small style="color:var(--m);white-space:nowrap">' + pct + '%</small></div>';
  }

  function periodQuery() {
    return 'period=' + encodeURIComponent(vendState.period || 'month');
  }

  window.vendSetPeriod = function (p) {
    vendState.period = p;
    if (typeof go === 'function') go('vendeurs');
  };
  window.vendSetTab = function (t) {
    vendState.tab = t;
    if (typeof go === 'function') go('vendeurs');
  };

  window.vendConfigDefaults = async function () {
    let cfg = { default_rate: 3, default_target: 400000, commission_mode: 'always' };
    try { cfg = await G('/seller-commissions/config'); } catch (_) {}
    if (typeof form !== 'function') return;
    var modeOpts = [
      ['always', 'Toujours (CA HT × taux)'],
      ['if_target_met', 'Seulement si objectif atteint'],
      ['on_surplus', 'Uniquement sur le dépassement d’objectif']
    ];
    form('Paramètres commissions (station)', [
      ['default_target', 'Objectif par défaut (FCFA HT)', 'number'],
      ['default_rate', 'Taux de commission par défaut (%)', 'number'],
      ['commission_mode', 'Mode de calcul', 's', modeOpts]
    ], {
      default_target: cfg.default_target,
      default_rate: cfg.default_rate,
      commission_mode: cfg.commission_mode || 'always'
    }, async (d) => {
      const body = {
        default_target: Number(d.default_target) || 0,
        default_rate: Number(d.default_rate) || 0,
        commission_mode: d.commission_mode || 'always'
      };
      if (body.default_rate < 0 || body.default_rate > 100) {
        toast('Le taux doit être entre 0 et 100 %', 'error');
        return;
      }
      await api('PUT', '/seller-commissions/config', body);
      closeM();
      toast('Paramètres commissions enregistrés', 'success');
      if (typeof go === 'function') go('vendeurs');
    });
  };

  /** Figer les commissions de la période affichée */
  window.vendFreeze = async function () {
    if (!confirm('Figer les commissions calculées pour la période affichée ? Les montants seront enregistrés et pourront être réglés.')) return;
    try {
      var sum = await G('/seller-commissions/summary?' + periodQuery());
      if (!sum.from || !sum.to) { toast('Choisissez une période bornée (pas « Tout »)', 'error'); return; }
      var r = await Po('/seller-commissions/freeze', { period_from: sum.from, period_to: sum.to });
      toast((r.created || 0) + ' commission(s) figée(s)', 'success');
      if (typeof go === 'function') go('vendeurs');
    } catch (e) {
      toast((e && e.message) || 'Erreur figage', 'error');
    }
  };

  window.vendEditEmployee = async function (id) {
    if (typeof form !== 'function') return;
    var vv = vendGet(id), name = vv.name, currentTarget = vv.objectif, currentRate = vv.taux;
    form('Objectif & taux — ' + (name || ''), [
      ['sales_target', 'Objectif de ventes HT (FCFA)', 'number'],
      ['commission_rate', 'Taux de commission (%)', 'number']
    ], {
      sales_target: currentTarget != null ? currentTarget : '',
      commission_rate: currentRate != null ? currentRate : ''
    }, async (d) => {
      const body = {};
      if (d.sales_target !== '' && d.sales_target != null) body.sales_target = Number(d.sales_target);
      if (d.commission_rate !== '' && d.commission_rate != null) body.commission_rate = Number(d.commission_rate);
      if (body.commission_rate != null && (body.commission_rate < 0 || body.commission_rate > 100)) {
        toast('Le taux doit être entre 0 et 100 %', 'error');
        return;
      }
      if (!Object.keys(body).length) {
        toast('Indiquez au moins un champ', 'error');
        return;
      }
      await api('PUT', '/seller-commissions/employees/' + Number(id), body);
      closeM();
      toast('Objectif / taux mis à jour pour ' + (name || ''), 'success');
      if (typeof go === 'function') go('vendeurs');
    },
    '<p style="font-size:12px;color:var(--m);margin:0 0 8px">La commission = CA HT × taux %. L’objectif sert d’indicateur de performance pour chaque pompiste.</p>');
  };

  window.vendPrime = function (id) {
    if (typeof form !== 'function') return;
    var name = vendGet(id).name;
    form('Prime exceptionnelle — ' + (name || ''), [
      ['amount', 'Montant (FCFA)', 'number'],
      ['note', 'Motif / note']
    ], {}, async (d) => {
      const amount = Number(d.amount);
      if (!(amount > 0)) { toast('Montant invalide', 'error'); return; }
      await Po('/seller-commissions/primes', {
        employee_id: Number(id),
        amount: amount,
        note: d.note || null
      });
      closeM();
      toast('Prime enregistrée', 'success');
      if (typeof go === 'function') go('vendeurs');
    });
  };

  window.vendRegler = function (id) {
    if (typeof form !== 'function') return;
    var vv = vendGet(id), name = vv.name, suggested = vv.total_du;
    form('Régler commissions / primes — ' + (name || ''), [
      ['amount', 'Montant à régler (FCFA)', 'number'],
      ['note', 'Référence / note']
    ], { amount: suggested != null ? suggested : '' }, async (d) => {
      const amount = Number(d.amount);
      if (!(amount > 0)) { toast('Montant invalide', 'error'); return; }
      await Po('/seller-commissions/reglements', {
        employee_id: Number(id),
        amount: amount,
        note: d.note || null
      });
      closeM();
      toast('Règlement enregistré', 'success');
      if (typeof go === 'function') go('vendeurs');
    });
  };


  /** Rapport collectif : PDF aux couleurs de la station (logo, coordonnées, pied de page, signatures) */
  window.vendRapportCollectif = function () {
    var d = vendLast;
    if (!d || !(d.vendeurs || []).length) { toast('Aucune donnée à imprimer pour cette période', 'info'); return; }
    var t = d.totals || {};
    var periode = d.from && d.to ? ('Du ' + d.from + ' au ' + d.to) : 'Toutes périodes';
    var rows = d.vendeurs.map(function (v, i) {
      return [String(i + 1), (v.name || '') + (v.position ? ' (' + v.position + ')' : ''), v.ventes || 0, money(v.ca_ht), money(v.objectif),
        v.objectif_atteint ? 'Atteint' : '—', (v.taux || 0) + ' %', money(v.commission), money(v.primes), money(v.deja_regle), money(v.total_du)];
    });
    brandedPdf({
      title: 'Rapport collectif vendeurs et commissions', subtitle: periode, landscape: true, filename: 'commissions-vendeurs',
      sections: [
        { type: 'kpis', items: [
          { label: 'Ventes nettes HT', value: money(t.ca_ht), note: (t.ventes || 0) + ' vente(s)' },
          { label: 'Commissions', value: money(t.commissions) },
          { label: 'Primes', value: money(t.primes) },
          { label: 'Reste à régler', value: money(t.reste_a_regler) }] },
        { type: 'table', title: 'Performances par vendeur',
          head: ['N°', 'Vendeur', 'Ventes', 'CA net HT', 'Objectif', 'Statut', 'Taux', 'Commission', 'Primes', 'Déjà réglé', 'Total dû'],
          rows: rows,
          totals: ['', 'TOTAL', t.ventes || 0, money(t.ca_ht), '', '', '', money(t.commissions), money(t.primes), '', money(t.reste_a_regler)] }
      ],
      signatures: [{ label: 'Établi par' }, { label: 'Responsable' }, { label: 'Direction' }]
    });
  };

  /* ---------- Activation du module (désactivé par défaut, état enregistré en base par station) ---------- */
  window.vendSetModule = async function (on) {
    if (!on && !confirm('Désactiver le module Vendeurs & commissions ?\n\nSes écrans et calculs seront suspendus et la paie ne reprendra plus de commissions. Les données déjà enregistrées sont conservées.')) return;
    try {
      await api('PUT', '/seller-commissions/module', { enabled: !!on });
      toast(on ? 'Module Vendeurs & commissions activé' : 'Module Vendeurs & commissions désactivé', 'success');
      if (typeof go === 'function') go('vendeurs');
    } catch (e) { toast((e && e.message) || 'Changement impossible', 'error'); }
  };

  function activationScreen(mod) {
    return '<div class="pc-head"><div><h2 class="pc-title" style="margin:0">Vendeurs & commissions</h2>' +
      '<div class="pc-subtitle">Objectifs, commissions sur ventes et primes des vendeurs</div></div></div>' +
      '<div class="card" style="padding:28px;margin-top:14px;max-width:640px">' +
      '<span class="tag" style="background:#fff1f0;color:#b42318">Module désactivé</span>' +
      '<h3 style="margin:12px 0 6px">Ce module n’est pas activé sur cette station</h3>' +
      '<p style="color:var(--m);font-size:14px;margin:0 0 16px">Tant qu’il est désactivé, aucun calcul de commission n’est effectué, aucune prime ni aucun règlement ne peut être enregistré, et la paie ne reprend pas de commissions. ' +
      'Une fois activé, toutes ses fonctions (objectifs, taux, commissions, primes, règlements, exports PDF) deviennent disponibles selon les règles de gestion existantes. Vous pourrez le désactiver à nouveau à tout moment.</p>' +
      (mod && mod.can_toggle
        ? '<button onclick="vendSetModule(true)">Activer le module Vendeurs & commissions</button>'
        : '<p style="font-size:13px"><b>Seul un gestionnaire (permission commission.manage) peut activer ce module.</b></p>') +
      (mod && mod.changed_at ? '<p style="font-size:12px;color:var(--m);margin-top:14px">Dernier changement : ' + esc(String(mod.changed_at).slice(0, 16).replace('T', ' ')) + (mod.changed_by ? ' par ' + esc(mod.changed_by) : '') + '</p>' : '') +
      '</div>';
  }

  /* ---------- Exports PDF : liste, ventes par vendeur, commissions, règlements, rapport complet ---------- */
  function vendPeriodLabel(d) { return d && d.from && d.to ? 'Du ' + d.from + ' au ' + d.to : 'Toutes périodes'; }
  function inPeriod(dateStr, d) {
    if (!d || !d.from || !d.to || !dateStr) return true;
    var day = String(dateStr).slice(0, 10);
    return day >= d.from && day <= d.to;
  }
  window.vendBuildPdfSections = function (kind, d, entries) {
    var t = d.totals || {}, vs = d.vendeurs || [], out = [];
    var kp = { type: 'kpis', title: 'Synthèse de la période', items: [
      { label: 'Ventes nettes HT', value: money(t.ca_ht), note: (t.ventes || 0) + ' vente(s)' },
      { label: 'Commissions', value: money(t.commissions) },
      { label: 'Primes', value: money(t.primes) },
      { label: 'Reste à régler', value: money(t.reste_a_regler) }] };
    var reglesTot = vs.reduce(function (a, v) { return a + (Number(v.deja_regle) || 0); }, 0);
    var listeRows = vs.map(function (v, i) { return [String(i + 1), v.name || '', v.matricule || '', v.position || '', money(v.objectif) + (v.objectif_personnalise ? ' (perso)' : ''), (v.taux || 0) + ' %' + (v.taux_personnalise ? ' (perso)' : '')]; });
    var ventesRows = vs.map(function (v, i) { return [String(i + 1), v.name || '', v.ventes || 0, money(v.ca_ttc), money(v.ca_ht), money(v.objectif), v.objectif_atteint ? 'Atteint' : 'Non atteint']; });
    var commRows = vs.map(function (v, i) { return [String(i + 1), v.name || '', money(v.ca_ht), (v.taux || 0) + ' %', money(v.commission), money(v.primes), money(Number(v.commission || 0) + Number(v.primes || 0)), money(v.deja_regle), money(v.total_du)]; });
    var entryRows = (entries || []).map(function (e) {
      var who = ((e.first_name || '') + ' ' + (e.last_name || '')).trim();
      var label = e.kind === 'reglement' ? 'Règlement' : e.kind === 'prime' ? 'Prime' : e.kind === 'commission' ? 'Commission figée' : (e.kind || '');
      var per = e.period_from && e.period_to ? String(e.period_from).slice(0, 10) + ' → ' + String(e.period_to).slice(0, 10) : '—';
      return [String(e.created_at || '').slice(0, 10), who, label, per, money(e.amount), money(e.amount_remaining == null ? 0 : e.amount_remaining), e.status === 'regle' ? 'Réglé' : e.status === 'du' ? 'Dû' : (e.status || ''), e.note || ''];
    });
    if (kind === 'liste' || kind === 'complet') out.push({ type: 'table', title: 'Liste des vendeurs', head: ['N°', 'Vendeur', 'Matricule', 'Poste', 'Objectif', 'Taux de commission'], rows: listeRows });
    if (kind === 'ventes' || kind === 'complet') out.push({ type: 'table', title: 'Ventes réalisées par vendeur', head: ['N°', 'Vendeur', 'Ventes', 'CA TTC', 'CA net HT', 'Objectif', 'Statut'], rows: ventesRows, totals: ['', 'TOTAL', t.ventes || 0, money(t.ca_ttc), money(t.ca_ht), '', ''] });
    if (kind === 'commissions' || kind === 'complet') out.push({ type: 'table', title: 'Commissions, montants dus et réglés', head: ['N°', 'Vendeur', 'CA net HT', 'Taux', 'Commission', 'Primes', 'Total dû', 'Déjà réglé', 'Reste à payer'], rows: commRows, totals: ['', 'TOTAL', money(t.ca_ht), '', money(t.commissions), money(t.primes), money(Number(t.commissions || 0) + Number(t.primes || 0)), money(reglesTot), money(t.reste_a_regler)], notes: ['Reste à payer = commission + primes − montants déjà réglés. Période : ' + vendPeriodLabel(d) + '.'] });
    if (kind === 'reglements' || kind === 'complet') out.push(entryRows.length
      ? { type: 'table', title: 'Historique des primes et règlements', head: ['Date', 'Vendeur', 'Nature', 'Période', 'Montant', 'Restant dû', 'Statut', 'Note'], rows: entryRows }
      : { type: 'text', title: 'Historique des primes et règlements', text: 'Aucune prime ni aucun règlement sur la période.' });
    if (kind === 'liste') return out;
    return [kp].concat(out);
  };

  window.vendExportPdf = function () {
    var d = vendLast;
    if (!d || !(d.vendeurs || []).length) { toast('Aucune donnée à exporter pour cette période', 'info'); return; }
    var opts = [['complet', 'Rapport complet (tous les états ci-dessous)'], ['liste', 'Liste des vendeurs'], ['ventes', 'Ventes réalisées par vendeur'], ['commissions', 'Commissions calculées, montants dus et réglés, soldes restants'], ['reglements', 'Historique des primes et règlements']];
    modal('<h3 style="margin-top:0">Exporter en PDF</h3><p style="color:var(--m);font-size:13px">Période : <b>' + esc(vendPeriodLabel(d)) + '</b> — l’export respecte la période affichée.</p>' +
      opts.map(function (o, i) { return '<label style="display:flex;gap:8px;align-items:center;margin:6px 0"><input type="radio" name="vpdf" value="' + o[0] + '"' + (i ? '' : ' checked') + '> ' + esc(o[1]) + '</label>'; }).join('') +
      '<div class="r" style="margin-top:12px"><button class="b2" onclick="closeM()">Annuler</button><button id="vpdf_ok">Générer le PDF</button></div>');
    document.getElementById('vpdf_ok').onclick = async function () {
      var kind = (document.querySelector('input[name=vpdf]:checked') || {}).value || 'complet';
      this.disabled = true;
      try {
        var entries = [];
        if (kind === 'reglements' || kind === 'complet') {
          try { entries = (await G('/seller-commissions/entries')).filter(function (e) { return inPeriod(e.created_at, d) || inPeriod(e.settled_at, d); }); } catch (_) { entries = []; }
        }
        var titles = { complet: 'Vendeurs et commissions — rapport complet', liste: 'Liste des vendeurs', ventes: 'Ventes par vendeur', commissions: 'Commissions des vendeurs', reglements: 'Primes et règlements des vendeurs' };
        closeM();
        await brandedPdf({ title: titles[kind], subtitle: vendPeriodLabel(d), period: d.from && d.to ? d.from + ' au ' + d.to : undefined, landscape: true, filename: 'vendeurs-' + kind,
          sections: vendBuildPdfSections(kind, d, entries), signatures: [{ label: 'Établi par' }, { label: 'Responsable' }, { label: 'Direction' }] });
      } catch (e) { toast((e && e.message) || 'Export impossible', 'error'); this.disabled = false; }
    };
  };

  window.vendNouveau = function () {
    if (typeof go === 'function') go('emp');
    else toast('Ajoutez un employé (pompiste) dans Employés', 'info');
  };

  async function vVendeurs() {
    // Module désactivé par défaut : seul l'écran d'activation est proposé tant qu'il n'est pas explicitement activé
    try {
      var mod = await G('/seller-commissions/module');
      if (mod && !mod.enabled) { vendLast = null; return activationScreen(mod); }
    } catch (_) { /* contrat sans le module / droit refusé : le flux historique affiche le message approprié */ }
    var data = {
      period: vendState.period,
      from: null,
      to: null,
      defaults: { default_rate: 3, default_target: 400000 },
      totals: { ventes: 0, ca_ht: 0, commissions: 0, primes: 0, reste_a_regler: 0 },
      vendeurs: []
    };
    try {
      data = await G('/seller-commissions/summary?' + periodQuery());
    } catch (e) {
      var msg = (e && e.message) || 'Erreur chargement commissions';
      if (/seller_commission|column.*sales_target|does not exist/i.test(msg)) {
        return '<div class="pc-head"><h2 class="pc-title">Vendeurs & commissions</h2></div>' +
          '<div class="card" style="padding:20px;margin-top:12px">' +
          '<p><b>Migration requise</b></p>' +
          '<p style="color:var(--m)">Exécutez la migration <code>080_seller_commissions.sql</code> puis rechargez.</p>' +
          '<pre style="font-size:12px;background:var(--bd);padding:10px;border-radius:8px;overflow:auto">' + esc(msg) + '</pre></div>';
      }
      toast(msg, 'error');
    }

    var vendeurs = data.vendeurs || [];
    vendCache = {};
    vendeurs.forEach(function (x) { vendCache[String(x.id)] = x; });
    vendLast = data;
    var totals = data.totals || {};
    var defaults = data.defaults || { default_rate: 3, default_target: 400000 };
    var teamView = data.scope !== 'own';
    var canManage = teamView && typeof can === 'function' && (can('commission.manage') || can('settings.edit') || can('hr.manage') || can('hr.payroll'));
    var pageTitle = teamView ? 'Vendeurs & commissions' : 'Mes commissions';
    var pageSub = teamView
      ? 'Objectifs de performance, commissions sur ventes et primes — liés aux employés (pompistes) et aux ventes validées'
      : 'Votre objectif, vos ventes et le calcul de votre commission';

    var periodBtns = [
      ['today', "Aujourd'hui"], ['7d', '7 jours'], ['month', 'Ce mois'],
      ['lastmonth', 'Mois dernier'], ['quarter', 'Trimestre'], ['year', 'Année'], ['all', 'Tout']
    ].map(function (pair) {
      var k = pair[0], lab = pair[1];
      return '<button type="button" class="b2 ' + (vendState.period === k ? 'on' : '') + '" onclick="vendSetPeriod(\'' + k + '\')">' + lab + '</button>';
    }).join('');

    var periodLabel = data.from && data.to ? ('Du ' + data.from + ' au ' + data.to) : '';

    var tabDefs = teamView
      ? [['perf', 'Performances & commissions', null], ['vendeurs', 'Vendeurs', vendeurs.length], ['primes', 'Primes & règlements', null], ['config', 'Paramétrage', null]]
      : [['perf', 'Mes performances', null]];
    if (!teamView && vendState.tab !== 'perf') vendState.tab = 'perf';
    var tabs = tabDefs.map(function (t) {
      var k = t[0], lab = t[1], n = t[2];
      return '<a class="' + (vendState.tab === k ? 'on' : '') + '" href="javascript:void(0)" onclick="vendSetTab(\'' + k + '\')">' + lab +
        (n != null ? ' <span class="tag" style="margin-left:4px">' + n + '</span>' : '') + '</a>';
    }).join('');

    var body = '';
    var i, v, rows;

    if (vendState.tab === 'config') {
      body = '<div class="card" style="padding:18px;max-width:560px">' +
        '<h3 style="margin:0 0 8px;font-size:15px">Paramètres par défaut (station)</h3>' +
        '<p style="font-size:13px;color:var(--m);margin:0 0 14px">' +
        'Ces valeurs s’appliquent à tous les employés sans objectif ou taux personnalisé. ' +
        'La commission est calculée sur le <b>CA HT des ventes validées</b> rattachées à l’employé (pompiste). Mode actuel : <b>' + esc((defaults.commission_mode === 'if_target_met' ? 'si objectif atteint' : defaults.commission_mode === 'on_surplus' ? 'sur dépassement' : 'toujours')) + '</b>.</p>' +
        '<div class="g" style="margin-bottom:12px">' +
        '<label>Objectif par défaut (FCFA HT)<input type="number" id="vc_target" min="0" step="1000" value="' + (Number(defaults.default_target) || 0) + '"></label>' +
        '<label>Taux de commission par défaut (%)<input type="number" id="vc_rate" min="0" max="100" step="0.1" value="' + (Number(defaults.default_rate) || 0) + '"></label>' +
        '<label>Mode de calcul<select id="vc_mode">' +
          '<option value="always"' + ((defaults.commission_mode || 'always') === 'always' ? ' selected' : '') + '>Toujours (CA HT × taux)</option>' +
          '<option value="if_target_met"' + (defaults.commission_mode === 'if_target_met' ? ' selected' : '') + '>Seulement si objectif atteint</option>' +
          '<option value="on_surplus"' + (defaults.commission_mode === 'on_surplus' ? ' selected' : '') + '>Uniquement sur le dépassement</option>' +
        '</select></label>' +
        '</div>' +
        (canManage
          ? '<button onclick="(async function(){try{var t=Number(document.getElementById(\'vc_target\').value)||0;var r=Number(document.getElementById(\'vc_rate\').value)||0;if(r<0||r>100){toast(\'Taux entre 0 et 100\',\'error\');return;}var m=(document.getElementById(\'vc_mode\')||{}).value||\'always\';await api(\'PUT\',\'/seller-commissions/config\',{default_target:t,default_rate:r,commission_mode:m});toast(\'Enregistré\',\'success\');go(\'vendeurs\');}catch(e){toast(e.message||\'Erreur\',\'error\');}})()">Enregistrer les défauts</button>'
          : '<p style="color:var(--m);font-size:13px">Permission commission.manage requise.</p>') +
        '</div>' +
        '<div class="card" style="padding:18px;margin-top:16px">' +
        '<h3 style="margin:0 0 8px;font-size:15px">Personnalisation par vendeur</h3>' +
        '<p style="font-size:13px;color:var(--m);margin:0 0 12px">Fixez un objectif et un taux propres à chaque pompiste.</p>' +
        '<div class="pc-tw"><table class="pc-tbl"><thead><tr><th>VENDEUR</th><th>POSTE</th><th class="pc-num">OBJECTIF</th><th class="pc-num">TAUX</th><th></th></tr></thead><tbody>' +
        (vendeurs.map(function (v) {
          return '<tr><td><b>' + esc(v.name) + '</b></td><td>' + esc(v.position || '—') + '</td>' +
            '<td class="pc-num">' + money(v.objectif) + (v.objectif_personnalise ? ' <span class="tag">perso</span>' : ' <small style="color:var(--m)">défaut</small>') + '</td>' +
            '<td class="pc-num">' + v.taux + ' %' + (v.taux_personnalise ? ' <span class="tag">perso</span>' : ' <small style="color:var(--m)">défaut</small>') + '</td>' +
            '<td>' + (canManage ? '<button class="b2" onclick="vendEditEmployee(' + Number(v.id) + ')">Objectif / taux</button>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--m)">Aucun employé actif</td></tr>') +
        '</tbody></table></div></div>';
    } else if (vendState.tab === 'vendeurs') {
      body = '<div class="bar" style="margin-bottom:12px">' +
        '<button onclick="vendNouveau()">+ Nouveau vendeur (employé)</button>' +
        (canManage ? '<button class="b2" onclick="vendConfigDefaults()">Paramètres par défaut</button>' : '') +
        '</div><div class="pc-tw"><table class="pc-tbl"><thead><tr><th>#</th><th>VENDEUR</th><th>POSTE</th><th class="pc-num">VENTES</th><th class="pc-num">CA NET HT</th><th>OBJECTIF</th><th class="pc-num">TAUX</th></tr></thead><tbody>' +
        (vendeurs.map(function (v, i) {
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(v.name) + '</b>' +
            (v.objectif_atteint ? ' <span class="tag ok">Objectif atteint</span>' : '') + '</td>' +
            '<td>' + esc(v.position || '—') + '</td><td class="pc-num">' + v.ventes + '</td><td class="pc-num">' + money(v.ca_ht) + '</td>' +
            '<td><div style="font-size:12px;margin-bottom:2px">' + money(v.objectif) + (v.objectif_personnalise ? ' <span class="tag">perso</span>' : '') + '</div>' +
            progressBar(v.ca_ht, v.objectif) + '</td><td class="pc-num">' + v.taux + ' %' + (v.taux_personnalise ? ' <span class="tag">perso</span>' : '') + '</td></tr>';
        }).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--m)">Aucun vendeur</td></tr>') +
        '</tbody></table></div>';
    } else if (vendState.tab === 'primes') {
      rows = vendeurs.filter(function (v) { return v.total_du > 0 || v.primes > 0 || v.commission > 0; });
      body = '<p style="color:var(--m);font-size:13px;margin-bottom:12px">Primes exceptionnelles et règlements. Les montants « dus » alimentent le reste à régler.</p>' +
        '<div class="pc-tw"><table class="pc-tbl"><thead><tr><th>VENDEUR</th><th class="pc-num">COMMISSIONS</th><th class="pc-num">PRIMES</th><th class="pc-num">DÉJÀ RÉGLÉ</th><th class="pc-num">TOTAL DÛ</th><th>ACTIONS</th></tr></thead><tbody>' +
        (rows.map(function (v) {
          return '<tr><td><b>' + esc(v.name) + '</b></td><td class="pc-num">' + money(v.commission) + '</td><td class="pc-num">' + money(v.primes) + '</td>' +
            '<td class="pc-num">' + money(v.deja_regle) + '</td><td class="pc-num" style="color:var(--r);font-weight:700">' + money(v.total_du) + '</td><td style="white-space:nowrap">' +
            (canManage
              ? '<button class="b2" onclick="vendPrime(' + Number(v.id) + ')">Prime</button> ' +
                '<button class="b2" onclick="vendEntries(' + Number(v.id) + ')">Écritures</button> ' +
                '<button onclick="vendRegler(' + Number(v.id) + ')">Régler</button>'
              : '—') + '</td></tr>';
        }).join('') || '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--m)">Aucun montant</td></tr>') +
        '</tbody></table></div>';
    } else {
      body = '<div class="bar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px">' + periodBtns +
        (periodLabel ? '<span style="font-size:12px;color:var(--m);margin-left:8px">' + esc(periodLabel) + '</span>' : '') + '</div>' +
        '<div class="dv2-kpis" style="margin-bottom:20px">' +
        '<div class="dv2-kpi" style="background:linear-gradient(135deg,#1d4ed8,#2563eb);color:#fff;border:none"><div>' +
        '<small style="color:rgba(255,255,255,.85)">VENTES NETTES HT</small><span class="val" style="color:#fff">' + money(totals.ca_ht) + '</span>' +
        '<small style="color:rgba(255,255,255,.75)">' + (totals.ventes || 0) + ' vente(s)</small></div></div>' +
        '<div class="dv2-kpi" style="background:linear-gradient(135deg,#c2410c,#ea580c);color:#fff;border:none"><div>' +
        '<small style="color:rgba(255,255,255,.85)">COMMISSIONS</small><span class="val" style="color:#fff">' + money(totals.commissions) + '</span></div></div>' +
        '<div class="dv2-kpi"><div><small>PRIMES</small><span class="val">' + money(totals.primes) + '</span>' +
        '<small style="display:block">exceptionnelles</small></div></div>' +
        '<div class="dv2-kpi" style="background:linear-gradient(135deg,#b91c1c,#dc2626);color:#fff;border:none"><div>' +
        '<small style="color:rgba(255,255,255,.85)">RESTE À RÉGLER</small><span class="val" style="color:#fff">' + money(totals.reste_a_regler) + '</span></div></div></div>' +
        '<div class="pc-tw" style="overflow:auto"><table class="pc-tbl"><thead><tr>' +
        '<th>#</th><th>VENDEUR</th><th class="pc-num">VENTES</th><th class="pc-num">CA NET HT</th><th>OBJECTIF</th>' +
        '<th class="pc-num">COMMISSION</th><th class="pc-num">PRIMES</th><th class="pc-num">TOTAL DÛ</th><th class="pc-num">RESTE</th><th></th>' +
        '</tr></thead><tbody>' +
        (vendeurs.map(function (v, i) {
          var objColor = v.objectif_atteint ? '#16a34a' : '#2563eb';
          return '<tr><td>' + (i + 1) + '</td><td><b>' + esc(v.name) + '</b>' +
            (v.objectif_atteint ? ' <span class="tag ok">Objectif atteint</span>' : '') +
            '<br><small style="color:var(--m)">' + esc(v.position || '') + '</small></td>' +
            '<td class="pc-num">' + v.ventes + '</td><td class="pc-num">' + money(v.ca_ht) + '</td>' +
            '<td><div style="font-size:12px;margin-bottom:2px">' + money(v.objectif) + (v.objectif_personnalise ? ' <span class="tag">perso</span>' : '') + '</div>' +
            progressBar(v.ca_ht, v.objectif, objColor) + '</td>' +
            '<td class="pc-num">' + money(v.commission) + ' <small style="color:var(--m)">' + v.taux + '%</small>' +
            (v.taux_personnalise ? ' <span class="tag">perso</span>' : '') + '</td>' +
            '<td class="pc-num">' + money(v.primes) + '</td>' +
            '<td class="pc-num"><b>' + money(v.commission + (v.primes_du || 0)) + '</b></td>' +
            '<td class="pc-num" style="color:' + (v.total_du > 0 ? 'var(--r)' : 'var(--m)') + ';font-weight:600">' + money(v.total_du) + '</td>' +
            '<td style="white-space:nowrap">' +
            (canManage
              ? '<button class="b2" title="Objectif et taux" onclick="vendEditEmployee(' + Number(v.id) + ')">⚙</button> ' +
                '<button class="b2" onclick="vendPrime(' + Number(v.id) + ')">Prime</button> ' +
                '<button onclick="vendRegler(' + Number(v.id) + ')">Régler</button>'
              : '') +
            '</td></tr>';
        }).join('') || '<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--m)">Aucun employé / vente sur cette période</td></tr>') +
        '</tbody></table></div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">' +
        (canManage ? '<button class="b2" onclick="vendSetTab(\'config\')">⚙ Paramétrer objectifs & taux</button>' : '') +
        '<button class="b2" onclick="vendRapportCollectif()">📊 Rapport collectif</button></div>';
    }

    return '<div class="pc-head" style="margin-bottom:8px"><div>' +
      '<h2 class="pc-title" style="margin:0">' + pageTitle + '</h2>' +
      '<div class="pc-subtitle">' + pageSub + '</div></div>' +
      '<div class="pc-actions" style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button onclick="vendNouveau()">+ Nouveau vendeur</button>' +
      (canManage ? '<button class="b2" onclick="vendSetTab(\'config\')">⚙ Paramétrage</button><button class="b2" onclick="vendConfigDefaults()">Défauts station</button><button class="b2" onclick="vendFreeze()">📌 Figer la période</button>' : '') +
      '<button class="b2" onclick="vendExportPdf()">📄 Exporter en PDF</button>' +
      (canManage ? '<button class="b2" title="Désactiver le module" onclick="vendSetModule(false)">⏻ Désactiver</button>' : '') +
      '</div></div><div class="subtabs" style="margin-bottom:16px">' + tabs + '</div>' + body;
  }

  if (typeof VM !== 'undefined') VM.vendeurs = vVendeurs;
  if (typeof V !== 'undefined') V.vendeurs = ['Vendeurs & commissions', 'commission.own|commission.manage|report.view|hr.view|settings.edit|sale.create'];
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.vendeurs = '🏆';
})();
