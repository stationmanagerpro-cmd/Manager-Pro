/* Onglet « À venir » — lecture seule : options nécessitant un fournisseur payant ou un budget externe.
   Visible si contrat.can_view_coming_soon !== false (actif par défaut). */
(function () {
  'use strict';
  if (typeof V === 'undefined' || typeof VM === 'undefined') return;

  var ITEMS = [
    {
      id: 'push',
      title: 'Notifications push sur téléphone',
      status: 'fournisseur',
      summary: 'Alertes même quand l’application est fermée.',
      why_paid: 'Nécessite un service cloud (ex. Firebase) et parfois un quota payant au-delà d’un volume gratuit.',
      benefit: 'Le gérant est prévenu immédiatement (stock bas, écart de caisse) sans ouvrir l’app.',
      free_alternative: 'Centre d’alertes dans l’app + digest e-mail quotidien (déjà inclus, gratuit).'
    },
    {
      id: 'whatsapp',
      title: 'Envoi WhatsApp Business',
      status: 'fournisseur',
      summary: 'Messages automatiques vers WhatsApp.',
      why_paid: 'API Meta / prestataire : abonnement et coût par message.',
      benefit: 'Communication familière avec le personnel et les clients.',
      free_alternative: 'Messagerie interne Manager PRO + e-mail.'
    },
    {
      id: 'sms',
      title: 'Alertes SMS',
      status: 'fournisseur',
      summary: 'SMS vers les numéros du personnel.',
      why_paid: 'Chaque SMS est facturé par un opérateur / agrégateur.',
      benefit: 'Atteint les téléphones sans smartphone ni data.',
      free_alternative: 'Notifications dans l’application et e-mail.'
    },
    {
      id: 'accounting_api',
      title: 'Connecteur comptable automatisé (API Sage / autres)',
      status: 'fournisseur',
      summary: 'Envoi automatique des écritures vers un logiciel comptable en ligne.',
      why_paid: 'Souvent lié à une licence du logiciel comptable et/ou une API payante.',
      benefit: 'Moins de saisie manuelle pour le cabinet comptable.',
      free_alternative: 'Exports CSV / Excel / PDF déjà disponibles (Fin de journée, Exports).'
    },
    {
      id: 'cloud_backup_saas',
      title: 'Sauvegarde cloud managée (SaaS externe)',
      status: 'fournisseur',
      summary: 'Copies automatiques chez un hébergeur distant payant.',
      why_paid: 'Stockage cloud et service managé facturés au mois.',
      benefit: 'Reprise après sinistre hors de votre serveur.',
      free_alternative: 'Sauvegardes locales / planifiées déjà dans l’administration (à tester régulièrement).'
    },
    {
      id: 'ai_forecast',
      title: 'Prévisions de stock par intelligence artificielle',
      status: 'recherche',
      summary: 'Suggestions automatiques de commandes.',
      why_paid: 'Modèles hébergés et APIs d’IA souvent payants à l’usage.',
      benefit: 'Anticiper les ruptures.',
      free_alternative: 'Seuils min_stock + alertes + Scanner (gratuit, déjà en place).'
    }
  ];

  function allowed() {
    if (ME && ME.is_global) return true;
    var c = ME && ME.contract;
    if (!c || c.unrestricted) return true;
    var f = c.features || {};
    return f.can_view_coming_soon !== false;
  }

  async function vAvenir() {
    if (!allowed()) {
      return '<p class="warn">L’onglet « À venir » n’est pas activé sur votre contrat. Demandez à l’Administrateur Principal de cocher cette autorisation.</p>';
    }
    var cards = ITEMS.map(function (it) {
      return '<div class="card" style="text-align:left">' +
        '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">' +
        '<b>' + esc(it.title) + '</b>' +
        '<span class="tag">À venir</span></div>' +
        '<p style="margin:8px 0;font-size:13.5px">' + esc(it.summary) + '</p>' +
        '<p style="margin:0 0 6px;font-size:12.5px;color:var(--m)"><b>Pourquoi pas encore actif :</b> ' + esc(it.why_paid) + '</p>' +
        '<p style="margin:0 0 6px;font-size:12.5px"><b>Avantage pour vous :</b> ' + esc(it.benefit) + '</p>' +
        '<p style="margin:0;font-size:12.5px;color:var(--p)"><b>Alternative gratuite déjà incluse :</b> ' + esc(it.free_alternative) + '</p>' +
        '</div>';
    }).join('');

    return '<h2 style="margin-top:0">À venir</h2>' +
      '<p class="muted">Fonctionnalités intéressantes qui nécessitent un <b>budget</b> ou un <b>fournisseur externe payant</b>. ' +
      'Lecture seule — rien n’est facturé pour consulter cette page. Les alternatives gratuites listées sont déjà dans votre offre.</p>' +
      '<div class="cards">' + cards + '</div>' +
      '<p class="muted" style="font-size:12px;margin-top:14px">L’Administrateur Principal peut masquer cet onglet en décochant « Voir l’onglet À venir » sur le contrat du compte client.</p>';
  }

  Object.assign(V, { avenir: ['À venir', '*'] });
  Object.assign(VM, { avenir: vAvenir });
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.avenir = '🚀';
})();
