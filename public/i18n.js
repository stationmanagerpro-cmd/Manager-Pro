'use strict';
/**
 * Multilingue FR / EN — Priorité 14
 * Système centralisé : une seule source de traductions, pas de duplication de composants.
 * Usage : t('key') ou t('key', { name: 'x' })
 */
(function (global) {
  const DICT = {
    fr: {
      app_name: 'Manager PRO',
      dashboard: 'Tableau de bord',
      shifts: 'Quarts',
      sales: 'Ventes',
      stock: 'Stocks',
      cash: 'Caisse',
      finance: 'Finance',
      customers: 'Clients',
      suppliers: 'Fournisseurs',
      hr: 'RH / Paie',
      reports: 'Rapports',
      exports: 'Exports',
      admin: 'Administration',
      settings: 'Paramètres',
      alerts: 'Alertes',
      logout: 'Déconnexion',
      password: 'Mot de passe',
      theme: 'Thème',
      focus: 'Focus',
      search: 'Rechercher…',
      save: 'Enregistrer',
      cancel: 'Annuler',
      confirm: 'Confirmer',
      loading: 'Chargement…',
      error: 'Erreur',
      success: 'Succès',
      no_data: 'Aucune donnée',
      today: "Aujourd'hui",
      yesterday: 'Hier',
      week: 'Cette semaine',
      month: 'Ce mois',
      revenue: 'Chiffre d\'affaires',
      expenses: 'Dépenses',
      cash_balance: 'Solde caisse',
      receivables: 'Créances',
      payables: 'Dettes',
      low_stock: 'Stock bas',
      open_shift: 'Quart ouvert',
      net: 'Résultat net',
      backup: 'Sauvegarde',
      backup_ok: 'Sauvegarde réussie',
      backup_fail: 'Échec de la sauvegarde',
      backup_auto: 'Sauvegarde automatique',
      last_backup: 'Dernière sauvegarde',
      language: 'Langue',
      profile: 'Profil',
      activity: 'Activité récente',
      stations: 'Stations',
      users: 'Utilisateurs',
      roles: 'Rôles',
      contracts: 'Contrats',
      system: 'Système',
      permissions: 'Permissions',
      loans: 'Prêts hors-exploitation',
      personal_loan: 'Prêt personnel',
      borrower: 'Emprunteur',
      due_date: 'Échéance',
      repay: 'Rembourser',
      liquidity: 'Liquidités',
      mobile_money: 'Mobile Money',
      bank: 'Banque',
      cash_in_hand: 'Espèces',
      loyalty: 'Fidélité',
      credit_limit: 'Limite de crédit',
      balance: 'Solde',
      first_steps: 'Premiers pas',
      live_sales: 'Ventes en direct',
      system_alerts: 'Alertes système',
      audit_log: 'Journal d\'audit',
      horizontal_menu: 'Menu',
      my_alerts: 'Mes alertes',
      secondary_emails: 'E-mails secondaires'

    },
    en: {
      app_name: 'Manager PRO',
      dashboard: 'Dashboard',
      shifts: 'Shifts',
      sales: 'Sales',
      stock: 'Stock',
      cash: 'Cash register',
      finance: 'Finance',
      customers: 'Customers',
      suppliers: 'Suppliers',
      hr: 'HR / Payroll',
      reports: 'Reports',
      exports: 'Exports',
      admin: 'Administration',
      settings: 'Settings',
      alerts: 'Alerts',
      logout: 'Log out',
      password: 'Password',
      theme: 'Theme',
      focus: 'Focus mode',
      search: 'Search…',
      save: 'Save',
      cancel: 'Cancel',
      confirm: 'Confirm',
      loading: 'Loading…',
      error: 'Error',
      success: 'Success',
      no_data: 'No data',
      today: 'Today',
      yesterday: 'Yesterday',
      week: 'This week',
      month: 'This month',
      revenue: 'Revenue',
      expenses: 'Expenses',
      cash_balance: 'Cash balance',
      receivables: 'Receivables',
      payables: 'Payables',
      low_stock: 'Low stock',
      open_shift: 'Open shift',
      net: 'Net result',
      backup: 'Backup',
      backup_ok: 'Backup successful',
      backup_fail: 'Backup failed',
      backup_auto: 'Automatic backup',
      last_backup: 'Last backup',
      language: 'Language',
      profile: 'Profile',
      activity: 'Recent activity',
      stations: 'Stations',
      users: 'Users',
      roles: 'Roles',
      contracts: 'Contracts',
      system: 'System',
      permissions: 'Permissions',
      loans: 'Off-operations loans',
      personal_loan: 'Personal loan',
      borrower: 'Borrower',
      due_date: 'Due date',
      repay: 'Repay',
      liquidity: 'Liquidity',
      mobile_money: 'Mobile Money',
      bank: 'Bank',
      cash_in_hand: 'Cash',
      loyalty: 'Loyalty',
      credit_limit: 'Credit limit',
      balance: 'Balance',
      first_steps: 'Getting started',
      live_sales: 'Live sales',
      system_alerts: 'System alerts',
      audit_log: 'Audit log',
      horizontal_menu: 'Menu',
      my_alerts: 'My alerts',
      secondary_emails: 'Secondary emails'

    }
  };

  let lang = 'fr';
  try {
    const saved = localStorage.getItem('smp-lang');
    if (saved && DICT[saved]) lang = saved;
    else if (navigator.language && navigator.language.toLowerCase().startsWith('en')) lang = 'en';
  } catch (_) {}

  function t(key, vars) {
    let s = (DICT[lang] && DICT[lang][key]) || (DICT.fr && DICT.fr[key]) || key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach(k => {
        s = s.replace(new RegExp('\\{\\{' + k + '\\}\\}', 'g'), String(vars[k]));
      });
    }
    return s;
  }

  function setLang(l) {
    if (!DICT[l]) return;
    lang = l;
    try { localStorage.setItem('smp-lang', l); } catch (_) {}
    document.documentElement.lang = l === 'en' ? 'en' : 'fr';
    if (typeof global.go === 'function' && typeof global.cur === 'string') {
      try { global.go(global.cur); } catch (_) {}
    }
    // Refresh header buttons if present
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) langBtn.textContent = l === 'fr' ? 'EN' : 'FR';
  }

  function getLang() { return lang; }
  function available() { return Object.keys(DICT); }

  // Locale helpers for numbers/dates
  function locale() { return lang === 'en' ? 'en-GB' : 'fr-FR'; }

  global.I18N = { t, setLang, getLang, available, locale, DICT };
  global.t = t;
})(typeof window !== 'undefined' ? window : global);
