/* Contrats clients + licences + quotas — Administrateur Principal */
(function () {
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  const LIC_LABEL = {
    ACTIVE: 'Active',
    EXPIRANT_BIENTOT: 'Expire bientôt',
    EXPIREE: 'Expirée',
    SUSPENDUE: 'Suspendue',
    INDEFINIE: 'Indéfinie'
  };
  function licTag(s) {
    const map = { ACTIVE: 'g', INDEFINIE: 'g', EXPIRANT_BIENTOT: 'o', EXPIREE: 'x', SUSPENDUE: 'x' };
    return `<span class="tag ${map[s] || ''}">${esc(LIC_LABEL[s] || s || '—')}</span>`;
  }
  function quotaLabel(q) {
    if (!q) return '—';
    if (q.unlimited) return (q.used != null ? q.used + ' / ∞' : '∞');
    return (q.used != null ? q.used : '?') + ' / ' + q.max + (q.at_limit ? ' ⛔' : '');
  }
  function durLabel(v, u, indef) {
    if (indef || u === 'indefinite') return 'Indéfinie';
    if (!u) return '—';
    const units = { day: 'jour(s)', month: 'mois', year: 'an(s)', custom: 'jour(s)' };
    return (v || '') + ' ' + (units[u] || u);
  }



  /** Packs d'autorisations prédéfinis (Superadmin). */
  const AUTH_PACKS = {
    essentiel: {
      label: 'Essentiel',
      desc: 'Ventes, stocks, caisse, rapports de base',
      flags: {
        can_access_settings: 'true', can_access_advanced_settings: 'false',
        can_access_hr: 'false', can_manage_hr: 'false',
        payroll_amo: 'false', payroll_inps: 'false', payroll_its: 'false', payroll_charges: 'false',
        employee_portal_payslips: 'false',
        employee_portal_commissions: 'false',
        can_access_finance: 'true', can_view_reports: 'true', can_export_reports: 'true',
        can_view_advanced_reports: 'false',
        module_sales: 'true', module_stock: 'true', module_receipts: 'true',
        module_reconcile: 'false', module_period_lock: 'false', module_price_history: 'false',
        can_use_messaging: 'true', messaging_attachments: 'false', messaging_groups: 'false',
        messaging_broadcast: 'false', messaging_support: 'true',
        module_auto_alerts: 'true',
        can_personalize: 'true', can_customize_signature: 'false', can_customize_report_exports: 'false',
        can_manage_services: 'false', can_view_coming_soon: 'true', can_use_billing: 'true',
        can_access_fiscal: 'false', can_fiscal_estimates: 'false', can_fiscal_exports: 'false',
        can_fiscal_prepare: 'false', can_fiscal_deadlines: 'false',
        fiscal_tva: 'false', fiscal_synthetique: 'false', fiscal_ibic: 'false', fiscal_is: 'false',
        fiscal_its: 'false', fiscal_cfe: 'false', fiscal_tfp: 'false', fiscal_logement: 'false',
        fiscal_retenues: 'false', fiscal_autres: 'false',
        can_access_accounting: 'false', accounting_entries: 'false', accounting_assets: 'false',
        accounting_vat: 'false', accounting_closing: 'false', accounting_export: 'false'
      }
    },
    standard: {
      label: 'Standard',
      desc: 'Essentiel + RH, réconciliation, messagerie complète, alertes',
      flags: {
        can_access_settings: 'true', can_access_advanced_settings: 'true',
        can_access_hr: 'true', can_manage_hr: 'true',
        payroll_amo: 'true', payroll_inps: 'true', payroll_its: 'true', payroll_charges: 'true',
        employee_portal_payslips: 'true',
        employee_portal_commissions: 'true',
        can_access_finance: 'true', can_view_reports: 'true', can_export_reports: 'true',
        can_view_advanced_reports: 'true',
        module_sales: 'true', module_stock: 'true', module_receipts: 'true',
        module_reconcile: 'true', module_period_lock: 'true', module_price_history: 'true',
        can_use_messaging: 'true', messaging_attachments: 'true', messaging_groups: 'true',
        messaging_broadcast: 'true', messaging_support: 'true',
        module_auto_alerts: 'true',
        can_personalize: 'true', can_customize_signature: 'true', can_customize_report_exports: 'true',
        can_manage_services: 'true', can_view_coming_soon: 'true', can_use_billing: 'true',
        can_access_fiscal: 'false', can_fiscal_estimates: 'false', can_fiscal_exports: 'false',
        can_fiscal_prepare: 'false', can_fiscal_deadlines: 'false',
        fiscal_tva: 'false', fiscal_synthetique: 'false', fiscal_ibic: 'false', fiscal_is: 'false',
        fiscal_its: 'false', fiscal_cfe: 'false', fiscal_tfp: 'false', fiscal_logement: 'false',
        fiscal_retenues: 'false', fiscal_autres: 'false',
        can_access_accounting: 'false', accounting_entries: 'false', accounting_assets: 'false',
        accounting_vat: 'false', accounting_closing: 'false', accounting_export: 'false'
      }
    },
    complet: {
      label: 'Complet',
      desc: 'Tous les modules sauf fiscalité avancée',
      flags: null // filled = all true except fiscal
    },
    comptabilite: {
      label: 'Complet + Comptabilité OHADA',
      desc: 'Tous les modules + Comptabilité (journaux, grand livre, balance, résultat, bilan, TVA, immobilisations, exercices)',
      flags: null
    },
    fiscal: {
      label: 'Complet + Fiscalité',
      desc: 'Tous modules y compris parcours fiscal',
      flags: null // all true
    }
  };
  function authPackFlags(code) {
    if (code === 'complet' || code === 'fiscal' || code === 'comptabilite') {
      const all = {};
      featureFormFields().forEach(([k, , ty]) => {
        if (ty === 'n') return;
        if (String(k).startsWith('fiscal') || String(k).startsWith('can_fiscal') || k === 'can_access_fiscal') {
          all[k] = code === 'fiscal' ? 'true' : 'false';
        } else if (String(k).startsWith('accounting') || k === 'can_access_accounting') {
          all[k] = code === 'comptabilite' ? 'true' : 'false';
        } else {
          all[k] = 'true';
        }
      });
      if (code === 'fiscal') {
        all.can_access_fiscal = 'true';
        all.can_fiscal_estimates = 'true';
        all.can_fiscal_exports = 'true';
        all.can_fiscal_prepare = 'true';
        all.can_fiscal_deadlines = 'true';
        ['fiscal_tva','fiscal_synthetique','fiscal_ibic','fiscal_is','fiscal_its','fiscal_cfe','fiscal_tfp','fiscal_logement','fiscal_retenues','fiscal_autres'].forEach(k => all[k] = 'true');
      }
      return all;
    }
    return (AUTH_PACKS[code] && AUTH_PACKS[code].flags) || {};
  }
  window.applyAuthPack = function (code) {
    const flags = authPackFlags(code);
    let n = 0;
    Object.keys(flags).forEach(k => {
      const el = document.getElementById('f_' + k);
      if (el) { el.value = flags[k]; n++; }
    });
    if (typeof toast === 'function') toast('Pack « ' + (AUTH_PACKS[code] && AUTH_PACKS[code].label || code) + ' » appliqué (' + n + ' champs)', 'success');
    try { updateAuthSummary(); } catch (_) {}
  };
  window.updateAuthSummary = function () {
    const el = document.getElementById('auth_summary');
    if (!el) return;
    let yes = 0, no = 0;
    featureFormFields().forEach(([k, , ty]) => {
      if (ty === 'n') return;
      const x = document.getElementById('f_' + k);
      if (!x) return;
      if (x.value === 'true') yes++; else no++;
    });
    el.innerHTML = '<b>' + yes + '</b> autorisation(s) activée(s) · <b>' + no + '</b> désactivée(s)';
  };
  function authPacksExtraHtml() {
    return '<div class="card" style="margin:12px 0;padding:12px">' +
      '<b>Packs d\'autorisations</b> ' +
      '<p class="muted" style="font-size:12px;margin:4px 0 8px">Appliquez un profil, puis ajustez case par case.</p>' +
      '<div class="r" style="flex-wrap:wrap;gap:6px">' +
      Object.keys(AUTH_PACKS).map(code =>
        '<button type="button" class="b2" onclick="applyAuthPack(\'' + code + '\')">' +
        (AUTH_PACKS[code].label || code) + '</button>'
      ).join('') +
      '</div>' +
      '<p id="auth_summary" style="margin-top:10px;font-size:13px" class="muted">Résumé : ouvrez le formulaire puis changez une valeur.</p>' +
      '</div>' +
      '<p class="muted" style="font-size:12px">Sections : Paramètres · RH/Paie · Finance · Exploitation · Messagerie · Alertes · Personnalisation · Facturation · Fiscalité</p>';
  }


  /** Champs d'autorisations contractuelles exposés au Super Admin (complet vs backend). */
  const YN = [['true', 'Oui'], ['false', 'Non']];
  function featureFormFields() {
    // Liste EXHAUSTIVE des droits contrat — Super Admin coche/décoche à la création/édition.
    // Aucun module métier ne doit manquer ici.
    return [
      // ═══ PARAMÈTRES ═══
      ['can_access_settings', '① Paramètres station', 's', YN],
      ['can_access_advanced_settings', '① Paramètres avancés (règles paie, compta complète)', 's', YN],
      // ═══ EXPLOITATION ═══
      ['module_sales', '② Ventes (POS, carburant, produits)', 's', YN],
      ['module_stock', '② Stocks / inventaire', 's', YN],
      ['module_purchases', '② Achats / commandes fournisseurs', 's', YN],
      ['module_suppliers', '② Fournisseurs', 's', YN],
      ['module_customers', '② Clients station (créances)', 's', YN],
      ['module_shifts', '② Quarts (ouverture / clôture)', 's', YN],
      ['module_employees', '② Employés (fiches RH de base)', 's', YN],
      ['module_pumps', '② Pompes / compteurs carburant', 's', YN],
      ['module_receipts', '② Tickets / reçus (impression)', 's', YN],
      ['module_reconcile', '② Réconciliation des pompes', 's', YN],
      ['module_period_lock', '② Clôture de période (verrouillage)', 's', YN],
      ['module_price_history', '② Historique des prix carburant', 's', YN],
      ['module_imports', '② Imports Excel par lot', 's', YN],
      ['module_eod', '② Fin de journée (synthèse + exports)', 's', YN],
      ['module_direction', '② Pilotage direction (dashboard)', 's', YN],
      ['module_mm_commission', '② Commissions Mobile Money', 's', YN],
      ['module_multistation', '② Multi-stations (vue consolidée)', 's', YN],
      // ═══ RH / PAIE ═══
      ['can_access_hr', '③ Module RH (accès)', 's', YN],
      ['can_manage_hr', '③ Module RH (gestion complète)', 's', YN],
      ['payroll_amo', '③ Paie — AMO (maladie)', 's', YN],
      ['payroll_inps', '③ Paie — INPS (sécurité sociale)', 's', YN],
      ['payroll_its', '③ Paie — ITS (impôt salaires DGI)', 's', YN],
      ['payroll_charges', '③ Paie — charges patronales', 's', YN],
      ['employee_portal_payslips', '③ Portail bulletins employés', 's', YN],
      ['employee_portal_commissions', '③ Portail commissions employés (consulter ses commissions)', 's', YN],
      ['module_seller_commissions', '③ Module commissions vendeurs / pompistes', 's', YN],
      // ═══ FINANCE / RAPPORTS ═══
      ['can_access_finance', '④ Finance / Caisse', 's', YN],
      ['can_view_reports', '④ Voir les rapports', 's', YN],
      ['can_export_reports', '④ Exporter rapports (PDF / Excel)', 's', YN],
      ['can_view_advanced_reports', '④ Rapports avancés / pilotage', 's', YN],
      // ═══ FACTURATION ═══
      ['can_use_billing', '⑤ Facturation clients (multi-lignes)', 's', YN],
      // ═══ MESSAGERIE ═══
      ['can_use_messaging', '⑥ Messagerie interne', 's', YN],
      ['messaging_attachments', '⑥ Messagerie — pièces jointes', 's', YN],
      ['messaging_groups', '⑥ Messagerie — groupes', 's', YN],
      ['messaging_broadcast', '⑥ Messagerie — diffusion (broadcast)', 's', YN],
      ['messaging_support', '⑥ Support SuperAdmin (client ↔ plateforme)', 's', YN],
      // ═══ ALERTES ═══
      ['module_auto_alerts', '⑦ Alertes automatiques + rapports programmés', 's', YN],
      // ═══ PERSONNALISATION ═══
      ['can_personalize', '⑧ Personnalisation du thème client', 's', YN],
      ['can_customize_signature', '⑧ Signatures des documents', 's', YN],
      ['signature_mode', '⑧ Signature personnalisée du client (autorisation)', 's', [['none', 'Non autorisée'], ['handwritten', 'Manuscrite seulement'], ['image', 'Image importée seulement'], ['both', 'Manuscrite et image']]],
      ['can_customize_report_exports', '⑧ Couleurs des rapports exportés', 's', YN],
      ['can_manage_services', '⑧ Gérer services / packs station', 's', YN],
      ['can_view_coming_soon', '⑧ Onglet « À venir » (lecture seule)', 's', YN],
      ['demo_mode', '⑧ Mode démo / sandbox', 's', YN],
      // ═══ FISCALITÉ (off par défaut) ═══
      ['can_access_fiscal', '⑨ Fiscalité — accès individuel pour CE compte client (indépendant du pack)', 's', YN],
      ['can_fiscal_estimates', '⑨ Fiscalité — estimations', 's', YN],
      ['can_fiscal_exports', '⑨ Fiscalité — exports documents', 's', YN],
      ['can_fiscal_prepare', '⑨ Fiscalité — préparer périodes / déclarations', 's', YN],
      ['can_fiscal_deadlines', '⑨ Fiscalité — suivi des échéances', 's', YN],
      ['fiscal_storage_mb', '⑨ Fiscalité — quota stockage Mo (0=illimité)', 'n'],
      ['fiscal_tva', '⑨ Fiscalité — TVA', 's', YN],
      ['fiscal_synthetique', '⑨ Fiscalité — impôt synthétique', 's', YN],
      ['fiscal_ibic', '⑨ Fiscalité — IBIC', 's', YN],
      ['fiscal_is', '⑨ Fiscalité — IS (sociétés)', 's', YN],
      ['fiscal_its', '⑨ Fiscalité — ITS (déclarations)', 's', YN],
      ['fiscal_cfe', '⑨ Fiscalité — CFE / patente', 's', YN],
      ['fiscal_tfp', '⑨ Fiscalité — TFP', 's', YN],
      ['fiscal_logement', '⑨ Fiscalité — taxe logement', 's', YN],
      ['fiscal_retenues', '⑨ Fiscalité — retenues à la source', 's', YN],
      ['fiscal_autres', '⑨ Fiscalité — autres impôts / taxes', 's', YN],
      ['can_access_accounting', '⑩ Comptabilité OHADA — accès au module (journaux, grand livre, balance, résultat, bilan)', 's', YN],
      ['accounting_entries', '⑩ Comptabilité — saisie d’écritures manuelles / à-nouveaux', 's', YN],
      ['accounting_assets', '⑩ Comptabilité — immobilisations et amortissements', 's', YN],
      ['accounting_vat', '⑩ Comptabilité — état de TVA', 's', YN],
      ['accounting_closing', '⑩ Comptabilité — exercices et clôture', 's', YN],
      ['accounting_export', '⑩ Comptabilité — export CSV (journaux, balance)', 's', YN]
    ];
  }

  function featureDefaultsFromContract(f) {
    f = f || {};
    const m = f.modules || {};
    const on = (v) => (v === false ? 'false' : 'true');
    const mod = (key, fallbackTrue = true) => on(m[key] === false ? false : (m[key] != null ? m[key] : fallbackTrue));
    return {
      can_access_settings: on(f.can_access_settings),
      can_access_advanced_settings: on(f.can_access_advanced_settings),
      module_sales: mod('sales'),
      module_stock: mod('stock'),
      module_purchases: mod('purchases'),
      module_suppliers: mod('suppliers'),
      module_customers: mod('customers'),
      module_shifts: mod('shifts'),
      module_employees: mod('employees'),
      module_pumps: mod('pumps'),
      module_receipts: mod('receipts'),
      module_reconcile: mod('reconcile'),
      module_period_lock: mod('period_lock'),
      module_price_history: mod('price_history'),
      module_imports: mod('imports'),
      module_eod: mod('eod'),
      module_direction: mod('direction'),
      module_mm_commission: mod('mm_commission'),
      module_multistation: mod('multistation'),
      can_access_hr: on(f.can_access_hr === false || m.hr === false ? false : true),
      can_manage_hr: on(f.can_manage_hr),
      payroll_amo: mod('payroll_amo'),
      payroll_inps: mod('payroll_inps'),
      payroll_its: mod('payroll_its'),
      payroll_charges: mod('payroll_charges'),
      employee_portal_payslips: on(f.employee_portal_payslips),
      employee_portal_commissions: on(f.employee_portal_commissions),
      module_seller_commissions: mod('seller_commissions'),
      can_access_finance: on(f.can_access_finance === false || m.finance === false ? false : true),
      can_view_reports: on(f.can_view_reports === false || m.reports === false ? false : true),
      can_export_reports: on(f.can_export_reports),
      can_view_advanced_reports: on(f.can_view_advanced_reports),
      can_use_billing: on(f.can_use_billing === false || m.billing === false ? false : true),
      can_use_messaging: on(f.can_use_messaging === false || m.messaging === false ? false : true),
      messaging_attachments: on(f.messaging_attachments),
      messaging_groups: on(f.messaging_groups),
      messaging_broadcast: on(f.messaging_broadcast),
      messaging_support: on(f.messaging_support),
      module_auto_alerts: on(f.can_use_auto_alerts === false || m.auto_alerts === false ? false : true),
      can_personalize: on(f.can_access_personalization === false || m.personalization === false ? false : true),
      can_customize_signature: on(f.can_customize_signature),
      signature_mode: ['none', 'handwritten', 'image', 'both'].includes(f.signature_mode) ? f.signature_mode : 'none',
      can_customize_report_exports: on(f.can_customize_report_exports === false || m.report_colors === false ? false : true),
      can_manage_services: on(f.can_manage_services),
      can_view_coming_soon: on(f.can_view_coming_soon),
      demo_mode: on(f.demo_mode === true), // défaut false
      can_access_fiscal: on(f.can_access_fiscal === true || m.fiscal === true),
      can_fiscal_estimates: on(f.can_fiscal_estimates === true),
      can_fiscal_exports: on(f.can_fiscal_exports === true),
      can_fiscal_prepare: on(f.can_fiscal_prepare === true),
      can_fiscal_deadlines: on(f.can_fiscal_deadlines === true),
      fiscal_storage_mb: f.fiscal_storage_mb != null ? f.fiscal_storage_mb : 100,
      fiscal_tva: on(m.fiscal_tva === true),
      fiscal_synthetique: on(m.fiscal_synthetique === true),
      fiscal_ibic: on(m.fiscal_ibic === true),
      fiscal_is: on(m.fiscal_is === true),
      fiscal_its: on(m.fiscal_its === true),
      fiscal_cfe: on(m.fiscal_cfe === true),
      fiscal_tfp: on(m.fiscal_tfp === true),
      fiscal_logement: on(m.fiscal_logement === true),
      fiscal_retenues: on(m.fiscal_retenues === true),
      fiscal_autres: on(m.fiscal_autres === true),
      can_access_accounting: on(f.can_access_accounting === true || m.accounting === true),
      accounting_entries: on(m.accounting_entries === true),
      accounting_assets: on(m.accounting_assets === true),
      accounting_vat: on(m.accounting_vat === true),
      accounting_closing: on(m.accounting_closing === true),
      accounting_export: on(m.accounting_export === true)
    };
  }

  function buildFeaturesFromForm(d) {
    const t = (k) => d[k] === 'true' || d[k] === true;
    return {
      can_access_settings: t('can_access_settings'),
      can_access_advanced_settings: t('can_access_advanced_settings'),
      can_access_hr: t('can_access_hr'),
      can_manage_hr: t('can_manage_hr'),
      can_access_finance: t('can_access_finance'),
      can_view_reports: t('can_view_reports'),
      can_export_reports: t('can_export_reports'),
      can_view_advanced_reports: t('can_view_advanced_reports'),
      can_access_personalization: t('can_personalize'),
      can_customize_signature: t('can_customize_signature'),
      signature_mode: ['none', 'handwritten', 'image', 'both'].includes(d.signature_mode) ? d.signature_mode : 'none',
      can_customize_report_exports: t('can_customize_report_exports'),
      can_manage_services: t('can_manage_services'),
      can_use_messaging: t('can_use_messaging'),
      messaging_attachments: t('messaging_attachments'),
      messaging_groups: t('messaging_groups'),
      messaging_broadcast: t('messaging_broadcast'),
      messaging_support: t('messaging_support'),
      can_view_coming_soon: t('can_view_coming_soon'),
      can_use_billing: t('can_use_billing'),
      demo_mode: t('demo_mode'),
      can_use_auto_alerts: t('module_auto_alerts'),
      employee_portal_payslips: t('employee_portal_payslips'),
      employee_portal_commissions: t('employee_portal_commissions'),
      can_access_fiscal: t('can_access_fiscal'),
      can_access_accounting: t('can_access_accounting') || ['accounting_entries', 'accounting_assets', 'accounting_vat', 'accounting_closing', 'accounting_export'].some(k => t(k)),
      can_fiscal_estimates: t('can_fiscal_estimates'),
      can_fiscal_exports: t('can_fiscal_exports'),
      can_fiscal_prepare: t('can_fiscal_prepare'),
      can_fiscal_deadlines: t('can_fiscal_deadlines'),
      fiscal_storage_mb: d.fiscal_storage_mb !== '' && d.fiscal_storage_mb != null
        ? Number(d.fiscal_storage_mb) : 100,
      modules: {
        sales: t('module_sales'),
        stock: t('module_stock'),
        purchases: t('module_purchases'),
        suppliers: t('module_suppliers'),
        customers: t('module_customers'),
        shifts: t('module_shifts'),
        employees: t('module_employees'),
        pumps: t('module_pumps'),
        receipts: t('module_receipts'),
        reconcile: t('module_reconcile'),
        period_lock: t('module_period_lock'),
        price_history: t('module_price_history'),
        imports: t('module_imports'),
        eod: t('module_eod'),
        direction: t('module_direction'),
        mm_commission: t('module_mm_commission'),
        seller_commissions: t('module_seller_commissions'),
        multistation: t('module_multistation'),
        hr: t('can_access_hr'),
        finance: t('can_access_finance'),
        reports: t('can_view_reports'),
        auto_alerts: t('module_auto_alerts'),
        personalization: t('can_personalize'),
        payroll_amo: t('payroll_amo'),
        payroll_inps: t('payroll_inps'),
        payroll_its: t('payroll_its'),
        payroll_charges: t('payroll_charges'),
        messaging: t('can_use_messaging'),
        report_colors: t('can_customize_report_exports'),
        billing: t('can_use_billing'),
        fiscal: t('can_access_fiscal'),
        fiscal_tva: t('fiscal_tva'),
        fiscal_synthetique: t('fiscal_synthetique'),
        fiscal_ibic: t('fiscal_ibic'),
        fiscal_is: t('fiscal_is'),
        fiscal_its: t('fiscal_its'),
        fiscal_cfe: t('fiscal_cfe'),
        fiscal_tfp: t('fiscal_tfp'),
        fiscal_logement: t('fiscal_logement'),
        fiscal_retenues: t('fiscal_retenues'),
        fiscal_autres: t('fiscal_autres'),
        accounting: t('can_access_accounting') || ['accounting_entries', 'accounting_assets', 'accounting_vat', 'accounting_closing', 'accounting_export'].some(k => t(k)),
        accounting_entries: t('accounting_entries'),
        accounting_assets: t('accounting_assets'),
        accounting_vat: t('accounting_vat'),
        accounting_closing: t('accounting_closing'),
        accounting_export: t('accounting_export')
      }
    };
  }


  /** Alias utilisé par clNew / clEdit — ne pas supprimer. */
  function featuresPayloadFromForm(d) { return buildFeaturesFromForm(d); }

  async function vClients() {
    if (!(typeof ME !== 'undefined' && ME && ME.is_global)) {
      const q = await G('/me/contract').catch(() => null);
      if (!q) return '<p class="warn">Contrat indisponible.</p>';
      if (q.unrestricted) return '<p>Aucune limite contractuelle sur ce compte (Administrateur ou sans client lié).</p>';
      if (q.license_expired || q.license_status === 'EXPIREE') {
        return `<div class="card" style="max-width:520px;margin:40px auto;text-align:center">
          <h2 style="color:var(--r)">LICENCE EXPIRÉE</h2>
          <p>La licence attribuée à votre compte est arrivée à expiration.<br>
          L'accès à cette application est actuellement suspendu.</p>
          <p style="font-size:13px;color:var(--m)">Veuillez contacter l'administrateur principal ou le développeur afin de renouveler votre licence.</p>
          <p style="font-size:12px;color:var(--m)">Expiration : ${esc(q.expires_at ? new Date(q.expires_at).toLocaleString() : '—')}</p>
          <button onclick="requestRenewal()">Demander un renouvellement</button>
        </div>`;
      }
      const qs = q.quotas || {};
      return `<h2 style="margin-top:0">Mon contrat</h2>
        <div class="cards">
          ${card('Licence', LIC_LABEL[q.license_status] || q.contract_status || '—', q.is_indefinite ? 'Sans expiration' : (q.days_remaining != null ? q.days_remaining + ' j. restants' : ''))}
          ${card('Stations', quotaLabel(qs.stations), q.can_create_station ? 'Création OK' : 'Création interdite')}
          ${card('Utilisateurs', quotaLabel(qs.users), q.can_manage_users ? 'Gestion OK' : 'Gestion interdite')}
        </div>
        ${(q.days_remaining != null && q.days_remaining <= 30 && q.days_remaining >= 0) ? `<div class="warn">Pensez à réabonner votre station avant la fin de votre abonnement. Il reste ${q.days_remaining} jour(s). Contactez l’administrateur pour renouveler.</div>` : ''}
        <p style="font-size:12px;color:var(--m)">Client : ${esc(q.client_name || '')} · Vous ne pouvez pas modifier ces limites.</p>`;
    }

    // Admin Principal — dashboard licences
    const dash = await G('/admin/licenses/dashboard').catch(() => null);
    const overview = await G('/admin/platform/overview').catch(() => null);
    const rows = dash ? dash.clients : await G('/admin/clients').catch(() => []);
    const tot = dash ? dash.totals : {};

    return `<h2 style="margin-top:0">Licences & contrats clients</h2>
      ${overview ? `<section class="card" style="margin:12px 0 18px"><h3 style="margin-top:0">Vue consolidée multi-stations</h3><p style="color:var(--m);font-size:13px">Synthèse de la plateforme, distincte des données opérationnelles de chaque station.</p><div class="cards">${card('Stations au total', String(overview.totals.stations))}${card('Stations actives', String(overview.totals.active_stations))}${card('Stations inactives', String(overview.totals.inactive_stations))}${card('Clients actifs', String(overview.totals.active_clients))}${card('Clients suspendus', String(overview.totals.suspended_clients))}${card('Licences expirant bientôt', String(overview.totals.expiring_soon))}</div><h4>Stations par client</h4>${T(['Client', 'État client', 'Licence', 'Stations', 'Utilisateurs actifs', 'Expiration'], overview.clients.map(c => [
        `<strong>${esc(c.client_name)}</strong>${c.manager_name ? '<br><small>' + esc(c.manager_name) + '</small>' : ''}`,
        esc(c.client_status || '—'), licTag(c.license_status),
        `<div>${(c.stations || []).length ? c.stations.map(st => `<div style="padding:3px 0">${esc(st.name)} ${st.active ? '<span class="tag g">Active</span>' : '<span class="tag x">Inactive</span>'}</div>`).join('') : '<span style="color:var(--m)">Aucune station rattachée</span>'}</div>`,
        String(c.active_user_count || 0), c.is_indefinite ? 'Indéfinie' : (c.expires_at ? new Date(c.expires_at).toLocaleDateString() : '—')
      ]))}${overview.unassigned_stations && overview.unassigned_stations.length ? `<p class="warn">${overview.unassigned_stations.length} station(s) sans client rattaché : ${overview.unassigned_stations.map(st => esc(st.name)).join(', ')}. Vérifiez leur rattachement avant d’utiliser la vue multi-clients.</p>` : ''}<div class="r"><button class="b2" onclick="go('clients')">Actualiser la vue</button></div></section>` : '<div class="warn">La vue multi-stations est temporairement indisponible ; la gestion des licences reste accessible.</div>'}
      <div class="cards">
        ${card('Clients', String(tot.clients ?? rows.length))}
        ${card('Actives', String((tot.active ?? 0)))}
        ${card('Expire bientôt', String(tot.expiring_soon ?? 0))}
        ${card('Expirées', String(tot.expired ?? 0))}
        ${card('Suspendues', String(tot.suspended ?? 0))}
        ${card('Indéfinies', String(tot.indefinite ?? 0))}
        ${card('Utilisateurs', String(tot.users ?? 0))}
      </div>
      ${(dash && dash.pending_renewal_requests && dash.pending_renewal_requests.length) ? `
        <div class="warn" style="margin-bottom:12px">
          <strong>${dash.pending_renewal_requests.length} demande(s) de renouvellement en attente</strong>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:13px">
            ${dash.pending_renewal_requests.map(rr =>
              `<li>${esc(rr.client_name)} — ${new Date(rr.requested_at).toLocaleString()}
                <button style="margin-left:8px" onclick="clAcceptRenewal(${rr.id})">Accepter</button><button class="b2" style="margin-left:6px" onclick="clProcessRenewal(${rr.id},${rr.client_id})">Traiter</button>
              </li>`
            ).join('')}
          </ul>
        </div>` : ''}
      <div class="bar">
        <button onclick="clNew()">Nouveau client + licence</button>
        <button class="b2" onclick="clWarningThresholds()">Seuils d'avertissement</button>
        <button class="b2" onclick="go('clients')">Actualiser</button>
      </div>
      ${T(['Client', 'Licence', 'Début', 'Expiration', 'Jours', 'Users', 'Modules', ''], (rows || []).map(c => {
        const lic = c.license_status || c.contract_status;
        const mods = c.modules || (c.features && c.features.modules) || {};
        const modStr = Object.keys(mods).filter(k => mods[k]).join(', ') || '—';
        return [
          `<a href="#" onclick="go('clientdetail',${c.client_id || c.id});return false"><strong>${esc(c.name)}</strong></a>${c.manager_name ? '<br><small>Contact : ' + esc(c.manager_name) + '</small>' : ''}`,
          licTag(lic),
          c.starts_at ? new Date(c.starts_at).toLocaleDateString() : (c.start_date || '—'),
          c.is_indefinite ? '∞' : (c.expires_at ? new Date(c.expires_at).toLocaleDateString() : (c.end_date || '—')),
          c.is_indefinite ? '∞' : (c.days_remaining != null ? String(c.days_remaining) : '—'),
          (c.users_count || 0) + (c.max_users != null ? ' / ' + c.max_users : ' / ∞'),
          `<small>${esc(modStr)}</small>`,
          `<button class="b2" onclick="event.stopPropagation();go('clientdetail',${c.client_id || c.id})">Ouvrir la fiche</button>
           <button class="b2" onclick="event.stopPropagation();go('clientads',${c.client_id || c.id})">Configurer la publicité</button>
           <button class="b2" onclick="event.stopPropagation();clEdit(${c.client_id || c.id})">Gérer</button>
           <button class="b2" onclick="event.stopPropagation();typeof clContractHistory==='function'&&clContractHistory(${c.client_id || c.id})">Historique</button>
           <button class="b2" onclick="event.stopPropagation();clRenew(${c.client_id || c.id})">Renouveler</button>
           <button class="b2" onclick="event.stopPropagation();clExtend(${c.client_id || c.id})">Prolonger</button>
           <button class="b2" onclick="event.stopPropagation();clSetExpiry(${c.client_id || c.id})">Échéance</button>
           <button class="b2" onclick="event.stopPropagation();clApplyPack(${c.client_id || c.id})">Pack</button>`
        ];
      }), i => `go('clientdetail',${(rows || [])[i].client_id || (rows || [])[i].id})`)}
      ${dash && dash.recent_operations && dash.recent_operations.length ? `
        <h3 style="margin-top:24px">Opérations récentes</h3>
        ${T(['Date', 'Client', 'Opération', 'Admin', 'Note'], dash.recent_operations.map(h => [
          h.performed_at ? new Date(h.performed_at).toLocaleString() : '—',
          esc(h.client_name || ''),
          esc(h.operation || ''),
          esc(h.admin_login || ''),
          esc(h.note || '')
        ]))}
      ` : ''}`;
  }

  window.clNew = safe(async () => {
    const today = new Date().toISOString().slice(0, 10);
    form('Nouveau client + licence', [
      ['name', 'Nom entreprise / établissement *'],
      ['manager_name', 'Nom du contact / responsable déclaré (facultatif)'],
      ['code', 'Code client'],
      ['contact_email', 'E-mail'],
      ['contact_phone', 'Téléphone'],
      ['owner_login', 'Identifiant de l’administrateur local *'],
      ['owner_password', 'Mot de passe initial de l’administrateur (12 caractères minimum) *', 'password'],
      ['start_date', 'Début licence', 'date'],
      ['duration_preset', 'Durée prédéfinie', 's', [
        ['1d', '1 jour'], ['2d', '2 jours'], ['3d', '3 jours'], ['10d', '10 jours'],
        ['1m', '1 mois'], ['3m', '3 mois'], ['6m', '6 mois'],
        ['1y', '1 an'], ['2y', '2 ans'], ['indefinite', 'Indéfinie (sans expiration)'], ['custom', 'Personnalisée']
      ]],
      ['duration_unit', 'Unité (si personnalisée)', 's', [
        ['day', 'Jours'], ['month', 'Mois'], ['year', 'Années'],
        ['indefinite', 'Indéfinie']
      ]],
      ['duration_value', 'Nombre (personnalisé ou preset)', 'number'],
      ['max_users', 'Max utilisateurs/employés', 'number'],
      ['max_stations', 'Max stations', 'number'],
      ['can_manage_users', 'Autoriser création employés / utilisateurs', 's', YN],
      ['can_create_station', 'Autoriser création de stations', 's', YN],
      ...featureFormFields(),
      ['notes', 'Notes']
    ], {
      start_date: today,
      owner_login: '',
      owner_password: '',
      duration_preset: '1m',
      duration_unit: 'month',
      duration_value: 1,
      max_users: 10,
      max_stations: 1,
      can_manage_users: 'true',
      can_create_station: 'true',
      ...featureDefaultsFromContract({}),
      can_access_settings: 'true',
      can_access_finance: 'true',
      can_view_reports: 'true',
      can_view_coming_soon: 'true',
      can_use_billing: 'true',
      can_export_reports: 'true',
      module_sales: 'true',
      module_stock: 'true',
      module_receipts: 'true',
      can_personalize: 'true'
    }, async d => {
      if (!d.name) { toast('Nom obligatoire', 'error'); return; }
      // Résoudre preset → unit/value
      let unit = d.duration_unit || 'month';
      let value = +(d.duration_value || 1);
      let indefinite = false;
      const preset = d.duration_preset || 'custom';
      const PRESETS = {
        '1d': [1, 'day'], '2d': [2, 'day'], '3d': [3, 'day'], '10d': [10, 'day'],
        '1m': [1, 'month'], '3m': [3, 'month'], '6m': [6, 'month'],
        '1y': [1, 'year'], '2y': [2, 'year']
      };
      if (preset === 'indefinite') { indefinite = true; unit = 'indefinite'; value = null; }
      else if (PRESETS[preset]) { value = PRESETS[preset][0]; unit = PRESETS[preset][1]; }
      else if (unit === 'indefinite') { indefinite = true; value = null; }
      const body = {
        name: d.name,
        manager_name: d.manager_name || null,
        code: d.code || null,
        contact_email: d.contact_email || null,
        contact_phone: d.contact_phone || null,
        owner_login: (d.owner_login || '').trim(),
        owner_password: d.owner_password || '',
        start_date: d.start_date || today,
        duration_unit: unit,
        duration_value: indefinite ? null : value,
        is_indefinite: indefinite,
        max_users: d.max_users === '' || d.max_users == null ? null : +d.max_users,
        max_stations: d.max_stations === '' || d.max_stations == null ? null : +d.max_stations,
        can_manage_users: d.can_manage_users === 'true',
        can_create_station: d.can_create_station !== 'false',
        notes: d.notes || null,
        features: featuresPayloadFromForm(d)
      };
      if (!body.owner_login || body.owner_login.length < 3) { toast('Saisissez un identifiant d’administrateur local (3 caractères minimum).', 'error'); return; }
      if (!body.owner_password || body.owner_password.length < 12) { toast('Saisissez un mot de passe initial de 12 caractères minimum pour l’administrateur local.', 'error'); return; }
      if (!body.owner_login || body.owner_login.length < 3) { toast('Saisissez un identifiant d’administrateur local (3 caractères minimum).', 'error'); return; }
      if (!body.owner_password || body.owner_password.length < 12) { toast('Saisissez un mot de passe initial de 12 caractères minimum pour l’administrateur local.', 'error'); return; }
      const r = await api('POST', '/admin/clients', body);
      closeM();
      toast('Client créé' + (r.license ? ' — licence ' + (r.license.license_status || '') : '') + '. Les modules s’appliquent après reconnexion du compte client.', 'success');
      go('clients');
    });
  });

  window.clEdit = safe(async (id) => {
    const c = await G('/admin/clients/' + id + '/contract');
    const f = c.features || {};
    const hist = await G('/admin/clients/' + id + '/license/history').catch(() => []);
    form('Gérer client #' + id + ' — ' + (c.client_name || ''), [
      ['name', 'Nom du compte client *'],
      ['manager_name', 'Nom du responsable'],
      ['contact_email', 'E-mail de contact'],
      ['contact_phone', 'Téléphone'],
      ['status_client', 'Statut organisation', 's', [['actif', 'Actif'], ['suspendu', 'Suspendu'], ['archive', 'Archivé']]],
      ['contract_type', 'Type contrat'],
      ['can_create_station', 'Créer stations', 's', YN],
      ['max_stations', 'Max stations (vide = ∞)', 'number'],
      ['can_manage_users', 'Gérer utilisateurs', 's', YN],
      ['max_users', 'Max utilisateurs (vide = ∞)', 'number'],
      ...featureFormFields(),
      ['forced_signature', 'Signature imposée (affichée en pied de tous les documents du client et dans l’application)'],
      ['notes', 'Notes']
    ], {
      name: c.client_name || '',
      manager_name: c.manager_name || '',
      contact_email: c.contact_email || '',
      contact_phone: c.contact_phone || '',
      status_client: c.client_status || 'actif',
      contract_type: c.contract_type || 'standard',
      can_create_station: c.can_create_station ? 'true' : 'false',
      max_stations: c.max_stations == null ? '' : c.max_stations,
      can_manage_users: c.can_manage_users ? 'true' : 'false',
      max_users: c.max_users == null ? '' : c.max_users,
      ...featureDefaultsFromContract(f),
      forced_signature: c.forced_signature || '',
      notes: c.notes || ''
    }, async d => {
      if (d.name && String(d.name).trim()) {
        await api('PATCH', '/admin/clients/' + id, {
          name: String(d.name).trim(),
          manager_name: d.manager_name || null,
          contact_email: d.contact_email || null,
          contact_phone: d.contact_phone || null
        });
      }
      await api('PUT', '/admin/clients/' + id + '/contract', {
        contract_type: d.contract_type,
        can_create_station: d.can_create_station === 'true',
        max_stations: d.max_stations === '' || d.max_stations == null ? null : +d.max_stations,
        can_manage_users: d.can_manage_users === 'true',
        max_users: d.max_users === '' || d.max_users == null ? null : +d.max_users,
        notes: d.notes || null,
        forced_signature: String(d.forced_signature || '').trim().slice(0, 200),
        features: featuresPayloadFromForm(d)
      });
      if (d.status_client && d.status_client !== c.client_status) {
        await api('PATCH', '/admin/clients/' + id + '/status', { status: d.status_client });
      }
      closeM(); toast('Contrat enregistré. Le compte client doit se reconnecter pour appliquer les modules autorisés.', 'success'); go('clients');
    });
    // Afficher résumé licence sous le formulaire (après ouverture modal)
    setTimeout(() => {
      const m = document.querySelector('#m > div');
      if (!m) return;
      const info = document.createElement('div');
      info.style.cssText = 'font-size:13px;margin:8px 0;padding:8px;background:var(--pl);border-radius:8px';
      info.innerHTML = `<strong>Licence :</strong> ${licTag(c.license_status)}
        · ${c.is_indefinite ? 'Indéfinie' : (c.days_remaining != null ? c.days_remaining + ' j. restants' : '')}
        · Exp. ${c.expires_at ? new Date(c.expires_at).toLocaleString() : '—'}
        <div style="margin-top:6px">
          <button type="button" class="b2" onclick="closeM();clRenew(${id})">Renouveler</button>
          <button type="button" class="b2" onclick="closeM();clExtend(${id})">Prolonger</button>
          <button type="button" class="b2" onclick="closeM();clSetExpiry(${id})">Modifier l’échéance</button>
          <button type="button" class="b2" onclick="closeM();clSuspend(${id})">Suspendre</button>
          <button type="button" class="b2" onclick="closeM();clReactivate(${id})">Débloquer</button>
          <button type="button" class="bd" onclick="closeM();clTerminate(${id})">Résilier le contrat</button>
        </div>
        ${hist && hist.length ? '<p style="margin:8px 0 0;font-size:12px;color:var(--m)">Dernières ops : ' +
          hist.slice(0, 5).map(h => esc(h.operation) + ' (' + (h.performed_at ? new Date(h.performed_at).toLocaleDateString() : '') + ')').join(' · ') + '</p>' : ''}`;
      m.insertBefore(info, m.firstChild.nextSibling);
    }, 50);
  });

    window.clRenew = safe(async (id) => {
    form('Renouveler la licence', [
      ['duration_unit', 'Durée', 's', [
        ['day', 'Jours'], ['month', 'Mois'], ['year', 'Années'], ['indefinite', 'Indéfinie']
      ]],
      ['duration_value', 'Nombre', 'number'],
      ['start_from', 'Début', 's', [
        ['now', "À partir d'aujourd'hui"],
        ['expiry', "À partir de l'ancienne échéance (si future)"]
      ]],
      ['invoice_amount', 'Montant facture plateforme (FCFA)', 'number'],
      ['mark_invoice_paid', 'Marquer la facture comme encaissée', 's', [['0', 'Non — créance ouverte'], ['1', 'Oui — encaissement immédiat']]],
      ['note', 'Note / justification']
    ], { duration_unit: 'year', duration_value: 1, start_from: 'now', invoice_amount: 0, mark_invoice_paid: '0' }, async d => {
      const indefinite = d.duration_unit === 'indefinite';
      const amt = +(d.invoice_amount || 0);
      const r = await api('POST', '/admin/clients/' + id + '/license/renew', {
        duration_unit: d.duration_unit,
        duration_value: indefinite ? null : +(d.duration_value || 1),
        is_indefinite: indefinite,
        start_from: d.start_from || 'now',
        note: d.note || null,
        invoice_amount: amt > 0 ? amt : null,
        generate_invoice: amt > 0,
        mark_invoice_paid: d.mark_invoice_paid === '1' || d.mark_invoice_paid === 1
      });
      closeM();
      toast(amt > 0 ? ('Licence renouvelée — facture plateforme ' + (r && r.invoice ? '#' + r.invoice.id : 'créée')) : 'Licence renouvelée', 'success');
      go('clients');
    });
  });

    window.clExtend = safe(async (id) => {
    form('Prolonger la licence (conserve les jours restants)', [
      ['duration_unit', 'Ajouter', 's', [
        ['day', 'Jours'], ['month', 'Mois'], ['year', 'Années'], ['indefinite', 'Passer en indéfinie']
      ]],
      ['duration_value', 'Nombre', 'number'],
      ['invoice_amount', 'Montant facture plateforme (FCFA)', 'number'],
      ['mark_invoice_paid', 'Marquer la facture comme encaissée', 's', [['0', 'Non — créance ouverte'], ['1', 'Oui — encaissement immédiat']]],
      ['note', 'Note']
    ], { duration_unit: 'day', duration_value: 30, invoice_amount: 0, mark_invoice_paid: '0' }, async d => {
      const amt = +(d.invoice_amount || 0);
      const r = await api('POST', '/admin/clients/' + id + '/license/extend', {
        duration_unit: d.duration_unit,
        duration_value: +(d.duration_value || 30),
        is_indefinite: d.duration_unit === 'indefinite',
        note: d.note || null,
        invoice_amount: amt > 0 ? amt : null,
        generate_invoice: amt > 0,
        mark_invoice_paid: d.mark_invoice_paid === '1' || d.mark_invoice_paid === 1
      });
      closeM();
      toast(amt > 0 ? 'Licence prolongée — facture plateforme créée' : 'Licence prolongée', 'success');
      go('clients');
    });
  });

  window.clSetExpiry = safe(async (id) => {
    form('Modifier l’échéance (avancer ou reculer la date de fin)', [
      ['mode', 'Méthode', 's', [['date', 'Fixer une date de fin précise'], ['reduce', 'Retrancher une durée à l’échéance actuelle']]],
      ['expires_at', 'Nouvelle date de fin (si « date précise »)', 'date'],
      ['reduce_unit', 'Retrancher (si « durée »)', 's', [['day', 'Jours'], ['month', 'Mois'], ['year', 'Années']]],
      ['reduce_value', 'Nombre (si « durée »)', 'number'],
      ['note', 'Note / justification']
    ], { mode: 'date', reduce_unit: 'day', reduce_value: 30 }, async d => {
      const body = { note: d.note || null };
      if (d.mode === 'reduce') {
        body.reduce_unit = d.reduce_unit || 'day';
        body.reduce_value = +(d.reduce_value || 0);
        if (!(body.reduce_value > 0)) throw new Error('Indiquez un nombre supérieur à 0');
      } else {
        if (!d.expires_at) throw new Error('Choisissez la nouvelle date de fin');
        body.expires_at = d.expires_at;
        if (d.expires_at < new Date().toISOString().slice(0, 10) && !confirm('Cette date est déjà passée : la licence sera expirée immédiatement. Continuer ?')) return;
      }
      await api('POST', '/admin/clients/' + id + '/license/set-expiry', body);
      closeM(); toast('Échéance modifiée', 'success'); go('clients');
    });
  });

  window.clSuspend = safe(async (id) => {
    form('Suspendre la licence', [
      ['reason', 'Motif de suspension']
    ], {}, async d => {
      await api('POST', '/admin/clients/' + id + '/license/suspend', { reason: d.reason || null });
      closeM(); toast('Licence suspendue', 'success'); go('clients');
    });
  });

  window.clTerminate = safe(async (id) => {
    form('Résilier le contrat (accès coupé, données conservées)', [
      ['reason', 'Motif de la résiliation']
    ], {}, async d => {
      await api('POST', '/admin/clients/' + id + '/license/terminate', { reason: d.reason || null });
      closeM(); toast('Contrat résilié : le compte client n’a plus accès', 'success'); go('clients');
    });
  });

  window.clReactivate = safe(async (id) => {
    form('Débloquer le compte client', [
      ['expires_at', 'Nouvelle date de fin (obligatoire si le contrat est expiré ou résilié)', 'date'],
      ['indef', 'Durée indéterminée', 's', [['non', 'Non'], ['oui', 'Oui']]],
      ['note', 'Note']
    ], { indef: 'non' }, async d => {
      const body = { note: d.note || null };
      if (d.indef === 'oui') body.indefinite = true;
      else if (d.expires_at) body.expires_at = new Date(d.expires_at + 'T23:59:59').toISOString();
      await api('POST', '/admin/clients/' + id + '/license/reactivate', body);
      closeM(); toast('Compte client débloqué', 'success'); go('clients');
    });
  });

  // C2 — écran unique plein écran pendant l'expiration de la licence.
  window.showExpiredSubscriptionScreen = async function () {
    if (!ME || ME.is_global) return false;
    let status;
    try { status = await G('/me/license/status-message'); } catch (_) { return false; }
    if (!status || !['EXPIREE', 'SUSPENDUE'].includes(status.status)) return false;
    const isLocalAdmin = ME.role === 'ADMIN';
    const phone = String(status.superadmin_phone || '').trim();
    // Conserver le texte C2 obligatoire tout en affichant aussi le message configuré côté serveur.
    const payment = status.payment_info || {};
    const qrCard = (label, src) => src ? `<div style="border:1px solid #dbe7e5;border-radius:14px;padding:14px;min-width:180px;flex:1"><b>${label}</b><img alt="QR ${label}" src="${esc(src)}" style="display:block;width:180px;height:180px;max-width:100%;object-fit:contain;margin:10px auto 0" onerror="this.hidden=true"></div>` : '';
    const paymentHtml = (payment.orange_qr || payment.malitel_qr || payment.details) ? `<div style="margin:22px 0;text-align:left"><h2 style="font-size:18px">Renouveler votre abonnement</h2><div style="display:flex;flex-wrap:wrap;gap:12px">${qrCard('SARALI ORANGE', payment.orange_qr)}${qrCard('Malitel', payment.malitel_qr)}</div>${payment.details ? `<div style="white-space:pre-wrap;background:#f8fafc;border-radius:12px;padding:14px;margin-top:12px;line-height:1.6">${esc(payment.details)}</div>` : ''}</div>` : '';
    const detailMessage = String(status.message || '').trim();
    const detailHtml = detailMessage
      ? `<p style="color:#475569;margin:12px 0 0;line-height:1.6">${esc(detailMessage)}</p>`
      : '';
    const root = document.getElementById('expired-subscription-screen') || document.createElement('section');
    root.id = 'expired-subscription-screen';
    root.setAttribute('role', 'alert');
    root.style.cssText = 'position:fixed;inset:0;z-index:100000;background:linear-gradient(145deg,#f4fbf9,#eaf1ff);display:flex;align-items:center;justify-content:center;padding:22px;overflow:auto;font-family:system-ui,-apple-system,sans-serif;color:#172b3a';
    const phoneHtml = phone ? `<p style="margin:14px 0;color:#475569">Téléphone : <a style="font-weight:700;color:#0b766e" href="tel:${phone.replace(/[^+0-9]/g, '')}">${esc(phone)}</a></p>` : '';
    root.innerHTML = `<div style="width:min(680px,100%);background:#fff;border:1px solid #dbe7e5;border-radius:24px;padding:clamp(24px,5vw,44px);box-shadow:0 20px 70px #0f766e18;text-align:center"><div style="width:68px;height:68px;border-radius:20px;background:#e0f2fe;display:grid;place-items:center;margin:0 auto 20px;font-size:32px">⏳</div><div style="font-size:12px;letter-spacing:.16em;font-weight:800;color:#0b766e">STATION MANAGER PRO</div><h1 style="font-size:clamp(24px,4vw,34px);margin:14px 0;color:#16313b">CHER CLIENT,</h1><p style="font-size:clamp(16px,2.5vw,20px);line-height:1.7;font-weight:700;margin:0">VOTRE ABONNEMENT EST ARRIVÉ À TERME, MERCI DE CONTACTER L’ADMINISTRATEUR POUR LE RENOUVELER.</p>${detailHtml}<p style="color:#64748b;margin:16px 0 22px">Ravis de continuer de travailler avec vous !</p>${paymentHtml}${phoneHtml}${isLocalAdmin ? `<button id="expired-contact" style="background:#0b766e;color:white;border:0;border-radius:12px;padding:13px 20px;font-size:15px;font-weight:700;cursor:pointer">Nous contacter</button><form id="expired-renewal-form" hidden style="text-align:left;margin-top:22px;border-top:1px solid #e2e8f0;padding-top:20px"><label style="display:block;font-weight:700;margin-bottom:6px">Objet</label><input value="Demande d’abonnement" readonly style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px"><label for="expired-duration" style="display:block;font-weight:700;margin-bottom:6px">Durée souhaitée</label><select id="expired-duration" style="width:100%;padding:11px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:12px"><option value="month:1">1 mois</option><option value="month:3">3 mois</option><option value="month:6">6 mois</option><option value="year:1" selected>1 an</option><option value="year:2">2 ans</option><option value="indefinite:0">Indéfinie</option></select><label for="expired-message" style="display:block;font-weight:700;margin-bottom:6px">Message</label><textarea id="expired-message" required maxlength="1000" rows="4" placeholder="Décrivez votre demande…" style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #cbd5e1;border-radius:8px;margin-bottom:14px;resize:vertical"></textarea><button type="submit" style="background:#0b766e;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:700;cursor:pointer">Envoyer la demande</button><p id="expired-renewal-status" aria-live="polite" style="font-size:13px;color:#475569"></p></form>` : `<p style="color:#475569">Veuillez contacter l’administrateur de votre compte pour renouveler l’abonnement.</p>`}</div>`;
    if (!root.isConnected) document.body.appendChild(root);
    const contact = root.querySelector('#expired-contact');
    if (contact) contact.onclick = () => { root.querySelector('#expired-renewal-form').hidden = false; contact.hidden = true; };
    const formEl = root.querySelector('#expired-renewal-form');
    if (formEl) formEl.onsubmit = async ev => {
      ev.preventDefault();
      const submit = formEl.querySelector('button[type="submit"]');
      const out = root.querySelector('#expired-renewal-status');
      const [unit, value] = root.querySelector('#expired-duration').value.split(':');
      const message = root.querySelector('#expired-message').value.trim();
      if (!message) { out.textContent = 'Veuillez saisir un message.'; return; }
      submit.disabled = true; submit.textContent = 'Envoi…';
      try {
        try {
          await Po('/me/license/renewal-request', { message: `Objet : Demande d’abonnement\nDurée souhaitée : ${unit === 'indefinite' ? 'Indéfinie' : `${value} ${unit === 'year' ? 'an(s)' : 'mois'}`}\n\n${message}`, preferred_duration_unit: unit, preferred_duration_value: unit === 'indefinite' ? null : Number(value) });
        } catch (requestError) {
          // Une demande déjà en attente est comptée : on poursuit quand même l'envoi du message support.
          if (requestError?.status !== 409) throw requestError;
        }
        try { await Po('/messaging/support/to-admin', { subject: 'Demande d’abonnement', body: `Durée souhaitée : ${unit === 'indefinite' ? 'Indéfinie' : `${value} ${unit === 'year' ? 'an(s)' : 'mois'}`}\n\n${message}` }); } catch (supportError) { out.textContent = 'Demande enregistrée. Le message de support n’a pas pu être envoyé : ' + errMsg(supportError); submit.disabled = false; submit.textContent = 'Réessayer le support'; return; }
        out.textContent = 'Votre demande a été envoyée à l’administrateur principal.';
        formEl.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = true; });
      } catch (e) { out.textContent = errMsg(e); submit.disabled = false; submit.textContent = 'Envoyer la demande'; }
    };
    document.getElementById('app').style.display = 'none';
    document.getElementById('bottom-nav')?.setAttribute('hidden', 'hidden');
    return true;
  };

  // Intercepter les 403 LICENSE_EXPIRED côté client
  if (typeof window !== 'undefined') {
    window.__onLicenseExpired = function () {
      if (typeof window.showExpiredSubscriptionScreen === 'function') window.showExpiredSubscriptionScreen();
    };
  }

  
  window.clApplyPack = safe(async (id) => {
    const packs = await G('/admin/packs').catch(() => G('/packs').catch(() => []));
    if (!packs.length) { toast('Aucun pack défini', 'error'); return; }
    form('Appliquer un pack d\'abonnement', [
      ['pack_code', 'Pack', 's', packs.map(p => [p.code, p.label + (p.price_label ? ' — ' + p.price_label : '')])]
    ], { pack_code: packs[0].code }, async d => {
      await api('POST', '/admin/clients/' + id + '/apply-pack', { pack_code: d.pack_code });
      closeM(); toast('Pack appliqué — modules mis à jour', 'success'); go('clients');
    });
  });

  /** Client : demander un renouvellement (fonctionne même si licence expirée) */
  window.requestRenewal = safe(async () => {
    form('Demander un renouvellement', [
      ['preferred_duration_unit', 'Durée souhaitée', 's', [
        ['month', 'Mois'], ['year', 'Années'], ['day', 'Jours'], ['indefinite', 'Indéfinie']
      ]],
      ['preferred_duration_value', 'Nombre', 'number'],
      ['message', 'Message à l\'administrateur']
    ], { preferred_duration_unit: 'year', preferred_duration_value: 1 }, async d => {
      try {
        await api('POST', '/me/license/renewal-request', {
          preferred_duration_unit: d.preferred_duration_unit || null,
          preferred_duration_value: d.preferred_duration_unit === 'indefinite' ? null : +(d.preferred_duration_value || 1),
          message: d.message || null
        });
        closeM();
        toast('Demande envoyée à l\'administrateur principal', 'success');
      } catch (e) {
        toast((e && e.message) || 'Erreur envoi demande', 'error');
      }
    });
  });

  /** Admin : traiter une demande de renouvellement */
    window.clProcessRenewal = safe(async (reqId, clientId) => {
    // Charger la demande pour préremplir la durée demandée par le client
    let prefUnit = 'year', prefVal = 1, clientName = '';
    try {
      const list = await G('/admin/license-renewal-requests?status=all').catch(() => []);
      const rr = (list || []).find(x => Number(x.id) === Number(reqId));
      if (rr) {
        prefUnit = rr.preferred_duration_unit || 'year';
        prefVal = rr.preferred_duration_value || 1;
        clientName = rr.client_name || '';
      }
    } catch (_) {}
    form('Traiter la demande de renouvellement' + (clientName ? ' — ' + clientName : ''), [
      ['action', 'Décision', 's', [
        ['approve', 'Accepter et appliquer la durée demandée'],
        ['reject', 'Rejeter']
      ]],
      ['duration_unit', 'Durée à appliquer', 's', [
        ['day', 'Jours'], ['month', 'Mois'], ['year', 'Années'], ['indefinite', 'Indéfinie']
      ]],
      ['duration_value', 'Nombre', 'number'],
      ['invoice_amount', 'Montant facture plateforme (FCFA, 0 = aucune)', 'number'],
      ['mark_invoice_paid', 'Facture encaissée', 's', [['0', 'Non'], ['1', 'Oui']]],
      ['process_note', 'Note']
    ], {
      action: 'approve',
      duration_unit: prefUnit,
      duration_value: prefVal,
      invoice_amount: 0,
      mark_invoice_paid: '0'
    }, async d => {
      const indefinite = d.duration_unit === 'indefinite';
      const amt = +(d.invoice_amount || 0);
      const r = await api('POST', '/admin/license-renewal-requests/' + reqId + '/process', {
        action: d.action,
        duration_unit: d.action === 'approve' ? d.duration_unit : undefined,
        duration_value: d.action === 'approve' && !indefinite ? +(d.duration_value || 1) : undefined,
        is_indefinite: d.action === 'approve' ? indefinite : undefined,
        process_note: d.process_note || null,
        invoice_amount: amt > 0 ? amt : null,
        mark_invoice_paid: d.mark_invoice_paid === '1'
      });
      closeM();
      if (d.action === 'approve') {
        const ok = r && r.renewed;
        toast(ok
          ? ('Demande acceptée — licence prolongée (' + (indefinite ? 'indéfinie' : (d.duration_value + ' ' + d.duration_unit)) + ')')
          : 'Demande acceptée', 'success');
      } else {
        toast('Demande rejetée', 'success');
      }
      go(typeof cur !== 'undefined' && cur === 'admin' ? 'admin' : 'clients');
    });
  });

  /** Acceptation rapide : applique immédiatement la durée demandée par le client */
  window.clAcceptRenewal = safe(async (reqId) => {
    if (!confirm('Accepter cette demande et appliquer automatiquement la durée demandée par le client ?')) return;
    const r = await api('POST', '/admin/license-renewal-requests/' + reqId + '/process', {
      action: 'approve'
      // durée omise → serveur utilise preferred_duration_* de la demande
    });
    toast(r && r.renewed
      ? 'Demande acceptée — licence mise à jour selon la durée demandée'
      : 'Demande acceptée', 'success');
    go(typeof cur !== 'undefined' && cur === 'admin' ? 'admin' : 'clients');
  });

  /** Admin : configurer les seuils d'avertissement */
  window.clWarningThresholds = safe(async () => {
    const cur = await G('/admin/licenses/warning-thresholds').catch(() => ({ thresholds: [30, 15, 7, 3, 1] }));
    form('Seuils d\'avertissement (jours avant expiration)', [
      ['thresholds', 'Liste (ex: 30,15,7,3,1)']
    ], { thresholds: (cur.thresholds || [30, 15, 7, 3, 1]).join(',') }, async d => {
      const arr = String(d.thresholds || '').split(/[,;\s]+/).map(Number).filter(n => n > 0);
      if (!arr.length) { toast('Au moins un seuil requis', 'error'); return; }
      await api('PUT', '/admin/licenses/warning-thresholds', { thresholds: arr });
      closeM(); toast('Seuils enregistrés', 'success'); go('clients');
    });
  });

  async function vSubscription() {
    if (ME && ME.is_global) {
      const cfg = await G('/admin/subscription-payment-info').catch(() => ({ orange_qr: '', malitel_qr: '', details: '' }));
      const qrInput = (id, label, value) => `<label style="display:block;margin:12px 0;font-weight:700">${label}<input id="${id}" type="file" accept="image/png,image/jpeg,image/webp" style="display:block;margin-top:6px"><small style="display:block;color:var(--m);font-weight:400">Image PNG/JPEG/WebP, maximum 1 Mo. Laissez vide pour conserver l’image actuelle.</small><div id="${id}_preview" style="margin-top:8px">${value ? `<img src="${esc(value)}" alt="${label}" style="max-width:180px;max-height:180px;object-fit:contain">` : '<span>Pas de QR configuré</span>'}</div></label>`;
      return `<h2>Configuration des paiements d’abonnement</h2><p class="muted">Sous-onglet Autres · visible uniquement au Superadmin. Les QR et les détails seront affichés sur l’écran d’expiration et dans l’espace Abonnement des comptes clients.</p><div class="card"><div class="g">${qrInput('sub_orange_qr','QR marchand SARALI ORANGE',cfg.orange_qr)}${qrInput('sub_malitel_qr','QR Malitel',cfg.malitel_qr)}</div><label style="display:block;font-weight:700;margin:12px 0">Détails de paiement / renouvellement<textarea id="sub_details" rows="7" maxlength="5000" style="width:100%;box-sizing:border-box;margin-top:6px">${esc(cfg.details || '')}</textarea></label><button onclick="saveSubscriptionPaymentInfo()">Enregistrer la configuration</button><p id="sub_cfg_msg" aria-live="polite"></p></div>`;
    }
    const [st, cfg, hist] = await Promise.all([G('/me/license/status-message').catch(() => ({})), G('/me/subscription-payment-info').catch(() => ({})), G('/me/license/history').catch(() => ({ history: [], requests: [] }))]);
    const pay = st.payment_info || cfg || {};
    const fd = v => (v ? new Date(v).toLocaleDateString('fr-FR') : '—');
    const date = st.expires_at ? fd(st.expires_at) : (st.is_indefinite ? 'Sans expiration' : 'Non renseignée');
    const card = (title, src) => src ? `<div class="card" style="text-align:center;flex:1;min-width:190px"><h3>${title}</h3><img src="${esc(src)}" alt="QR ${title}" style="width:210px;max-width:100%;height:210px;object-fit:contain" onerror="this.hidden=true"><p style="font-size:12px;color:var(--m)">Scannez ce QR avec votre application de paiement.</p></div>` : '';
    const OPS = { creation: 'Création', renewal: 'Renouvellement', extension: 'Prolongation', suspension: 'Suspension', reactivation: 'Réactivation', modification: 'Modification', expiration: 'Expiration', reduction: 'Réduction' };
    const REQ = { pending: 'En attente', accepted: 'Acceptée', rejected: 'Refusée', cancelled: 'Annulée' };
    const subTable = (heads, rows) => `<div class="sub-tw"><table class="sub-table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const histRows = (hist.history || []).map(h => [fd(h.performed_at), esc(OPS[h.operation] || h.operation || '—'), h.new_status ? licTag(h.new_status) : '—', fd(h.new_starts_at), h.is_indefinite ? 'Sans expiration' : fd(h.new_expires_at), esc(durLabel(h.duration_value, h.duration_unit, h.is_indefinite))]);
    const reqRows = (hist.requests || []).map(r => [fd(r.requested_at), esc(durLabel(r.preferred_duration_value, r.preferred_duration_unit, r.preferred_duration_unit === 'indefinite')), `<span class="tag ${r.status === 'accepted' ? 'g' : r.status === 'pending' ? 'o' : 'x'}">${esc(REQ[r.status] || r.status)}</span>`, fd(r.processed_at)]);
    const history = `<div class="card sub-card"><h3 class="sub-title">Historique des abonnements</h3>${histRows.length ? subTable(['Date', 'Opération', 'Statut', 'Début', 'Fin', 'Durée'], histRows) : '<div class="sub-empty">Aucun historique d’abonnement pour le moment.</div>'}${reqRows.length ? `<h4 class="sub-sub">Demandes de renouvellement</h4>${subTable(['Envoyée le', 'Durée souhaitée', 'État', 'Traitée le'], reqRows)}` : ''}</div>`;
    return `<h2>Abonnement</h2><p class="muted">Consultez les informations de votre licence et demandez son renouvellement avant la date d’échéance.</p>
<div class="card sub-card"><div class="sub-head"><h3 class="sub-title">Détails de votre abonnement</h3><button type="button" class="sub-cta" onclick="subOpenRequest()">Envoyer la demande</button></div>${subTable(['Information', 'Détail'], [['État', licTag(st.status)], ['Date de fin', date], ['Jours restants', st.days_remaining == null ? '—' : st.days_remaining], ['Renouvellement', 'Envoyez une demande avant la fin de la période en cours pour éviter une interruption.']])}${st.message ? `<p class="sub-msg">${esc(st.message)}</p>` : ''}</div>
<div class="g">${card('SARALI ORANGE', pay.orange_qr)}${card('Malitel', pay.malitel_qr)}</div>${pay.details ? `<div class="card" style="white-space:pre-wrap;line-height:1.6"><h3>Détails de paiement</h3>${esc(pay.details)}</div>` : ''}
${history}`;
  }

  /* Fenêtre « Envoyer la demande » (durée souhaitée + détails) ; l'envoi passe par submitSubscriptionRenewal. */
  window.subOpenRequest = () => modal(`<h3 style="margin-top:0">Demande de renouvellement</h3><p>Vous pouvez demander le renouvellement avant l’expiration de votre abonnement actuel.</p><label>Durée souhaitée<select id="sub_req_duration"><option value="month:1">1 mois</option><option value="month:3">3 mois</option><option value="month:6">6 mois</option><option value="year:1" selected>1 an</option><option value="year:2">2 ans</option><option value="indefinite:0">Indéfinie</option></select></label><label style="display:block;margin:12px 0">Détails de la demande<textarea id="sub_req_message" rows="4" maxlength="1000" placeholder="Précisez votre demande ou la référence de paiement…" style="width:100%;box-sizing:border-box"></textarea></label><p id="sub_req_status" aria-live="polite"></p><div class="r"><button type="button" class="b2" onclick="closeM()">Annuler</button><button type="button" onclick="submitSubscriptionRenewal()">Envoyer la demande</button></div>`);

  const subCss = document.createElement('style'); subCss.id = 'sub-style';
  subCss.textContent = `.sub-card{border-radius:18px;padding:20px 22px}.sub-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.sub-title{margin:0;font-size:1.05rem;font-weight:800}.sub-card>.sub-title{margin-bottom:14px}.sub-sub{margin:18px 0 8px;font-size:.95rem}
.sub-cta{background:var(--p,#0f766e);color:#fff;border:0;border-radius:12px;padding:11px 20px;font-weight:800;cursor:pointer;box-shadow:0 4px 10px rgba(15,23,42,.18);min-height:44px}.sub-cta:hover{filter:brightness(1.08)}
.sub-tw{border:1px solid var(--bd);border-radius:12px;overflow:auto;box-shadow:0 2px 8px rgba(15,23,42,.08);background:var(--c,#fff)}
.sub-table{width:100%;border-collapse:collapse;font-size:13.5px}.sub-table th{background:var(--p,#0f766e);color:#fff;text-align:left;text-transform:uppercase;font-size:11px;letter-spacing:.04em;padding:12px 16px;white-space:nowrap}
.sub-table td{padding:12px 16px;border-top:1px solid var(--bd);vertical-align:middle}.sub-table tbody tr:first-child td{border-top:0}.sub-table td:first-child{white-space:nowrap}
.sub-msg{margin:14px 2px 0;font-size:13px;color:var(--t)}
.sub-empty{border:1px solid var(--bd);border-radius:24px;padding:40px 20px;text-align:center;color:var(--m);min-height:140px;display:grid;place-items:center}`;
  document.head.appendChild(subCss);

  window.saveSubscriptionPaymentInfo = safe(async () => {
    const readImage = async id => {
      const f = document.getElementById(id).files?.[0];
      if (!f) return null;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 1024 * 1024) throw new Error('Choisissez une image PNG, JPEG ou WebP de 1 Mo maximum.');
      return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('Lecture de l’image impossible.')); r.readAsDataURL(f); });
    };
    const current = await G('/admin/subscription-payment-info');
    const orange = await readImage('sub_orange_qr'), malitel = await readImage('sub_malitel_qr');
    await api('PUT', '/admin/subscription-payment-info', { orange_qr: orange || current.orange_qr || '', malitel_qr: malitel || current.malitel_qr || '', details: document.getElementById('sub_details').value || '' });
    toast('QR et détails de paiement enregistrés', 'success'); go('subscription');
  });
  window.submitSubscriptionRenewal = safe(async () => {
    const out = document.getElementById('sub_req_status');
    const [unit, value] = document.getElementById('sub_req_duration').value.split(':');
    const message = document.getElementById('sub_req_message').value.trim();
    try {
      await Po('/me/license/renewal-request', { message: message || null, preferred_duration_unit: unit, preferred_duration_value: unit === 'indefinite' ? null : Number(value) });
      out.textContent = 'Votre demande de renouvellement a été envoyée à l’administrateur principal.';
      setTimeout(() => { try { closeM(); if (typeof go === 'function') go('subscription'); } catch (_) { /* écran déjà quitté */ } }, 1200);   // la demande apparaît dans l'historique
    } catch (e) { out.textContent = errMsg(e); }
  });

  Object.assign(V, { clients: ['Licences / Contrats', '*'], subscription: ['Abonnement', '*'] });
  Object.assign(VM, { clients: vClients, subscription: vSubscription });
})();
