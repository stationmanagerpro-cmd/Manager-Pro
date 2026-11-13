const { auth, station, errorHandler, pool } = require('./core');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const { pub, priv } = require('./auth');

const app = express();
app.set('trust proxy', 1);
// Le client web est servi par l'API (même origine). Les scripts viennent uniquement de 'self'.
// Carte Mapbox GL JS : script/CSS (api.mapbox.com), tuiles/styles/télémétrie (connect-src), worker blob:.
const MAPBOX = ['https://api.mapbox.com', 'https://events.mapbox.com', 'https://*.tiles.mapbox.com'];
app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: {
  'script-src': ["'self'", 'https://api.mapbox.com'],
  'script-src-attr': ["'unsafe-inline'"],
  'style-src': ["'self'", 'https:', "'unsafe-inline'"],
  'connect-src': ["'self'", ...MAPBOX],
  'img-src': ["'self'", 'data:', 'blob:', ...MAPBOX],
  'worker-src': ["'self'", 'blob:'],
  'child-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'upgrade-insecure-requests': null
} } }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false }));
// D2 (audit 2026-11-03) : limitation de débit globale par IP, avant toute lecture de corps. 0 = désactivée.
// Réglage : RATE_LIMIT_IP_MAX (défaut 600 requêtes/minute/IP : plusieurs postes d'une même station partagent une IP).
const rateLimit = require('express-rate-limit');
const envInt = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
const limitMsg = { error: 'Trop de requêtes, réessayez dans un instant.', code: 'RATE_LIMIT' };
const ipMax = envInt('RATE_LIMIT_IP_MAX', 600);
if (ipMax > 0) {
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: ipMax, standardHeaders: true, legacyHeaders: false, message: limitMsg,
    skip: req => req.path === '/health' }));
}
// Corps JSON : petite limite par défaut ; 16 Mo seulement sur les routes qui reçoivent des fichiers en base64
// (images, logos, signatures, pièces jointes, imports Excel). JSON_BODY_LIMIT_DEFAULT=16mb rétablit l'ancien comportement partout.
const BIG_BODY = /(\/images\/|\/me\/photo|\/branding|\/advertising\/|\/home\/media|\/imports(\/|$)|\/messaging|\/signature|\/subscription-payment-info|\/fiscal|\/logo|\/photo|\/upload|\/attachments?|\/files?)/i;
const jsonSmall = express.json({ limit: process.env.JSON_BODY_LIMIT_DEFAULT || '2mb' });
const jsonBig = express.json({ limit: '16mb' });   // JSON/base64 : imports et pièces jointes (limite fichier 10 Mo côté route)
app.use((req, res, next) => (BIG_BODY.test(req.path) ? jsonBig : jsonSmall)(req, res, next));
app.use(require('./phone').phoneMiddleware);   // téléphones : format international (+223 par défaut)

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.apk')) {   // application Android téléchargeable (page « A propos »)
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(filePath) + '"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Service-Worker-Allowed', '/');
    }
  }
}));
app.get('/api/health', async (req, res) => {
  // D4 (audit 2026-11-03) : réponse publique minimale ; détails réservés à un appel portant HEALTH_TOKEN (en-tête X-Health-Token).
  const crypto = require('crypto');
  const expected = process.env.HEALTH_TOKEN || '';
  const given = String(req.get('x-health-token') || '');
  const detailed = expected.length >= 16 && given.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  const out = { ok: true };
  if (detailed) {
    out.version = (() => { try { return require('../package.json').version; } catch { return null; } })();
    out.time = new Date().toISOString();
    out.node = process.version;
    out.uptime_s = Math.round(process.uptime());
  }
  try {
    const { rows: [r] } = await pool.query('SELECT 1 AS ok, NOW() AS db_now');
    if (!r?.ok) out.ok = false;
    if (detailed) {
      out.db = { ok: !!r?.ok, now: r?.db_now || null };
      try {
        const { rows: [m] } = await pool.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`);
        out.migrations_applied = m?.n ?? null;
      } catch { out.migrations_applied = null; }
    }
  } catch (e) {
    out.ok = false;
    console.error('[health] base de données indisponible :', e.message);   // détail dans le journal serveur, jamais dans la réponse publique
    if (detailed) out.db = { ok: false, error: e.message };
  }
  res.status(out.ok ? 200 : 503).json(out);
});
app.use('/api/auth', pub);          // connexion
app.use('/api/branding', require('./branding').pub);   // identité de l'application (nom, slogan, logo) : lecture publique pour l'écran de connexion
app.use('/api/public', require('./access_keys').pub);   // clé d'accès à l'écran de connexion : visiteur non connecté
app.use('/api/public', require('./home_page').pub);    // page d'accueil publique (contenu publié uniquement)
app.use('/api/public', require('./client_portal').pub); // espace client : lien privé en lecture seule (jeton haché, révocable)
app.get('/c/:token', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.sendFile(path.join(__dirname, '..', 'public', 'espace-client.html')); });
app.use('/api', auth);              // tout ce qui suit exige un jeton valide
if (envInt('RATE_LIMIT_USER_MAX', 400) > 0) {   // D2 : plafond par utilisateur connecté (défaut 400/minute)
  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: envInt('RATE_LIMIT_USER_MAX', 400), standardHeaders: true, legacyHeaders: false, message: limitMsg,
    keyGenerator: (req) => (req.user && req.user.id ? 'u:' + req.user.id : 'ip:' + req.ip) }));
}
app.use('/api', priv);              // profil, utilisateurs, déconnexion
app.use('/api', station);           // puis l'en-tête X-Station-Id (accès à la station)
app.use('/api', require('./activity_log').middleware);   // traçabilité : chaque écriture réussie est journalisée au nom (et matricule) de l'utilisateur
app.use('/api', (req, res, next) => {
  if (!req.user?.is_global) return next();
  // '/messaging' : le Super Admin échange avec les administrateurs de ses clients (support) ; messaging.js applique l'isolation par client.
  const allowed = ['/admin', '/users', '/roles', '/auth', '/me', '/contracts', '/branding', '/messaging', '/config/map'];   // /config/map : jeton public Mapbox (aucune donnée métier) — nécessaire à la carte du Super Admin
  const path = req.path || '';
  if (allowed.some(p => path === p || path.startsWith(p + '/'))) return next();
  return res.status(403).json({ error: 'Administrateur Principal : les données métier des stations sont interdites.' });
});

// Contrat client : restriction modules (backend)
const { loadContractForUser, featureOn } = require('./contracts');
app.use('/api', async (req, res, next) => {
  try {
    if (!req.user || req.user.is_global) return next();
    const path = req.path || '';
    const contract = await loadContractForUser(req.user.id, false);
    req.contract = contract;
    // Exception C2 : un ADMIN local peut envoyer le formulaire de renouvellement
    // via la messagerie support même lorsque le contrat est expiré/suspendu.
    const expiredSupportRequest = path === '/messaging/support/to-admin' && req.user.role === 'ADMIN';
    // Le contact du Superadmin pour renouvellement est une fonction de service, indépendante des modules du pack.
    if (expiredSupportRequest) req._subscription_renewal_support = true;
    if (contract.suspended && !path.startsWith('/me') && !path.startsWith('/auth') && !expiredSupportRequest) {
      const code = contract.license_expired ? 'LICENSE_EXPIRED' : (contract.license_suspended ? 'LICENSE_SUSPENDED' : 'CONTRACT_SUSPENDED');
      return res.status(403).json({
        error: contract.license_expired
          ? 'LICENCE EXPIRÉE — L\'accès est suspendu. Contactez l\'administrateur principal pour renouveler.'
          : 'Contrat client suspendu ou expiré.',
        code,
        license_status: contract.license_status || null,
        expires_at: contract.expires_at || null
      });
    }
    if (!contract.unrestricted) {
      // Contrôle centralisé des modules contractuels. Les vérifications propres à
      // chaque route (need(...)) restent nécessaires : ce contrôle ne remplace pas
      // les permissions du rôle ni les plafonds de permissions par station.
      const isPath = (prefix) => path === prefix || path.startsWith(prefix + '/');
      const financePath = isPath('/finance') || isPath('/money') || isPath('/cash') ||
        isPath('/expenses') || /^\/customers\/[^/]+\/payments(?:\/|$)/.test(path);
      const salesPath = isPath('/sales') || isPath('/shifts') || isPath('/customers');
      const stockPath = isPath('/stock') || isPath('/products') || isPath('/pumps') ||
        isPath('/purchases') || isPath('/purchase-orders') || isPath('/suppliers');

      if (isPath('/hr') && !featureOn(contract, 'can_access_hr') && !featureOn(contract, 'module:hr')) {
        return res.status(403).json({ error: 'Module RH non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'hr' });
      }
      if (financePath && !featureOn(contract, 'can_access_finance') && !featureOn(contract, 'module:finance')) {
        return res.status(403).json({ error: 'Module Finance non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'finance' });
      }
      if (isPath('/reports') && !featureOn(contract, 'can_view_reports') && !featureOn(contract, 'module:reports')) {
        return res.status(403).json({ error: 'Rapports non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'reports' });
      }
      if (salesPath && !featureOn(contract, 'module:sales')) {
        return res.status(403).json({ error: 'Module Ventes non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'sales' });
      }
      if (stockPath && !featureOn(contract, 'module:stock')) {
        return res.status(403).json({ error: 'Module Stocks/Achats non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'stock' });
      }
      const alertConfigPath = path === '/messaging/alert-config';
      const alertCenterPath = path === '/messaging/system-alerts' || /^\/messaging\/system-alerts\/\d+$/.test(path);
      const reportSchedulePath = path === '/messaging/report-schedules' || /^\/messaging\/report-schedules\/\d+$/.test(path);
      if (alertConfigPath || alertCenterPath || reportSchedulePath) {
        if (!featureOn(contract, 'can_use_auto_alerts') && !featureOn(contract, 'module:auto_alerts')) {
          return res.status(403).json({ error: 'Alertes automatiques non incluses dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'auto_alerts' });
        }
      } else if (isPath('/messaging') && !expiredSupportRequest && !featureOn(contract, 'can_use_messaging') && !featureOn(contract, 'module:messaging')) {
        return res.status(403).json({ error: 'Module Messagerie non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'messaging' });
      }
      if (isPath('/invoices') && !featureOn(contract, 'can_use_billing') && !featureOn(contract, 'module:billing')) {
        return res.status(403).json({ error: 'La facturation n’est pas incluse dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'can_use_billing' });
      }
      if (isPath('/imports') && !featureOn(contract, 'module:imports')) {
        return res.status(403).json({ error: 'Imports par lot non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'imports' });
      }
      if ((isPath('/purchases') || isPath('/purchase-orders') || isPath('/suppliers')) && !featureOn(contract, 'module:stock') && !featureOn(contract, 'module:purchases') && !featureOn(contract, 'module:suppliers')) {
        return res.status(403).json({ error: 'Achats / fournisseurs non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'purchases' });
      }
      if (isPath('/exports') && !featureOn(contract, 'can_export_reports') && !featureOn(contract, 'module:reports')) {
        return res.status(403).json({ error: 'Les exports ne sont pas inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'exports' });
      }
      if (isPath('/accounting') && !featureOn(contract, 'can_access_accounting') && !featureOn(contract, 'module:accounting')) {
        return res.status(403).json({ error: 'Module Comptabilité non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'accounting' });
      }
      if (isPath('/fiscal') && !isPath('/admin/clients') && !featureOn(contract, 'can_access_fiscal') && !featureOn(contract, 'module:fiscal')) {
        return res.status(403).json({ error: 'Module Fiscalité non inclus dans votre contrat.', code: 'FEATURE_DISABLED', feature: 'fiscal' });
      }
    }
    next();
  } catch (e) { next(e); }
});
app.use('/api/shifts', require('./shifts'));
app.use('/api', require('./operations'));
app.use('/api', require('./billing')); // Facturation clients
app.use('/api', require('./notification_rules').r); // Règles notification rapports
app.use('/api', require('./purchases'));
app.use('/api', require('./purchase_orders')); // Exploitation › Bon de commande
app.use('/api', require('./fuelsales'));
app.use('/api', require('./hr'));
app.use('/api', require('./employee_access'));   // rôle individuel par employé
app.use('/api', require('./employee_actions'));  // historique des actions au nom d'un employé
app.use('/api', require('./my_profile'));  // profil personnel : indicateurs du poste, autorisations, journal d'activité, exports
app.use('/api', require('./seller_commissions')); // Commissions vendeurs / pompistes (objectifs, taux, primes)
app.use('/api', require('./profile_stats')); // Statistiques agrégées des profils client / fournisseur / employé
app.use('/api', require('./product_profile')); // Fiche produit : agrégats, prix, achats, historique des stocks
app.use('/api', require('./hr_v2')); // RH V2 (extension non destructive)
app.use('/api', require('./payroll_activation')); // Activation AMO/INPS/ITS avec formulaire taux
app.use('/api', require('./contracts').r); // Contrats clients
app.use('/api', require('./ops_plus')); // Dashboard jour J, déclarations, notif, audit
app.use('/api', require('./mobile_alerts')); // Alertes pour les notifications de l'application mobile
app.use('/api', require('./exports')); // Hub exports P9
app.use('/api', require('./docs_render')); // Rendu PDF commun (identité station) pour Comptabilité, Trésorerie, Vendeurs…
app.use('/api', require('./imports')); // Imports Excel par lot
app.use('/api', require('./messaging').r); // Messagerie interne + support
app.use('/api', require('./scheduled_reports').r); // Programmation des rapports opérationnels
app.use('/api', require('./multistation_views').r); // Vue consolidée + Vue par station (lecture seule, avant admin)
app.use('/api', require('./aggregates').r); // Agrégats complémentaires des tableaux de bord (catalogue relié à ses sources)
app.use('/api', require('./monthly_archive').r); // Archivage mensuel ZIP (sous /exports : contrôle de contrat « exports »)
app.use('/api', require('./admin'));
app.use('/api', require('./signature').r); // signature personnalisée du compte client (autorisée par contrat)
app.use('/api', require('./maintenance')); // maintenance globale strictement Super Admin
app.use('/api', require('./tenant-backups')); // sauvegardes isolées par client et sauvegarde plateforme séparée
app.use('/api', require('./platform')); // Finance et rapports de la plateforme (Superadmin uniquement)
app.use('/api', require('./branding').admin);   // identité de l'application : administration
app.use('/api', require('./access_keys').admin);   // gestion des clés d'accès : Super Admin uniquement
app.use('/api', require('./home_page').admin);     // personnalisation de la page d'accueil : Super Admin uniquement
app.use('/api', require('./about_page').r);        // « A propos de Manager PRO » : lecture pour tous, édition Super Admin uniquement
app.use('/api', require('./market'));          // rapprochement Mobile Money ↔ ventes, fidélité, score de risque, prévision de rupture, prix du jour
app.use('/api', require('./gaps'));            // transferts de stock, historique compteurs, prêts, SMTP, licences, préférences dashboard
app.use('/api', require('./client_portal'));   // liens d'espace client (gestion)
app.use('/api', require('./treasury').r);   // Trésorerie + Créances & dettes (agrégats)
app.use('/api', require('./fleet').r);      // Cartes carburant / flottes
app.use('/api', require('./tanks').r);      // Cuves : jauges et réconciliation du stock en cuve
app.use('/api', require('./money_match').r);   // Rapprochement ligne à ligne des relevés Mobile Money / banque
app.use('/api', require('./finance'));
app.use('/api', require('./catalog'));
app.use('/api', require('./search')); // Recherche globale
app.use('/api', require('./reports'));
app.use('/api', require('./profitability').r); // Marge, résultat de gestion et rapport complet du compte client (période libre, exports)
app.use('/api', require('./premium').r); // Modules abonnement activables
app.use('/api/accounting', require('./accounting'));  // Comptabilité OHADA (module contractuel : accounting)
app.use('/api', require('./fiscal').r);  // Module Fiscalité (assistance — non officiel)
app.use('/api', require('./fiscal_wizard'));  // Assistant d'activation individuelle par impôt (paramètres versionnés, paie partagée)
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use((req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.use(errorHandler);

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) { console.error('JWT_SECRET (32 caractères min.) est requis dans .env'); process.exit(1); }
const port = process.env.PORT || 3000;
const host = process.env.HOST || null;
const onListening = () => {
  require('./branding').load().catch(() => {});   // préchauffe le cache d'identité
  console.log('Station Manager API sur ' + (host || 'toutes les interfaces') + ':' + port);
  try { require('./backup').startScheduler(); } catch (e) { console.warn('[backup] planificateur :', e.message); }
  try { require('./alerts_scheduler').startScheduler(); } catch (e) { console.warn('[alertes-auto] planificateur :', e.message); }
  try { require('./scheduled_reports').startScheduler(); } catch (e) { console.warn('[rapports-programmes] planificateur :', e.message); }
  try { require('./notification_rules').startNotificationScheduler(); } catch (e) { console.warn('[notification-rules] planificateur :', e.message); }
};
// Pour un PC derrière Tailscale Funnel, HOST=127.0.0.1 empêche l'exposition directe
// sur le réseau local. Sans HOST, le serveur écoute sur toutes les interfaces (Docker, réseau local).
// Contrôle de disponibilité du schéma au démarrage : éviter qu'une migration manquante
// transforme un module en une suite d'« Erreur interne » difficile à diagnostiquer.
pool.query(`
  SELECT
    to_regclass('public.access_keys') IS NOT NULL AS access_keys,
    to_regclass('public.fiscal_profiles') IS NOT NULL AS fiscal_profiles,
    to_regclass('public.fiscal_module_activations') IS NOT NULL AS fiscal_modules,
    to_regclass('public.fiscal_periods') IS NOT NULL AS fiscal_periods,
    to_regclass('public.fiscal_rules') IS NOT NULL AS fiscal_rules,
    to_regclass('public.fiscal_deadlines') IS NOT NULL AS fiscal_deadlines,
    to_regclass('public.fiscal_documents') IS NOT NULL AS fiscal_documents,
    to_regclass('public.fiscal_checklist_items') IS NOT NULL AS fiscal_checklist,
    to_regclass('public.schema_migrations') IS NOT NULL AS migration_history
`).then(async r => {
  const s = r.rows[0];
  if (!s.access_keys) console.warn('[ATTENTION] Base non à jour : exécutez « npm run migrate » (migration 053 : clés d’accès / page d’accueil).');
  const missing = Object.entries({
    fiscal_profiles: s.fiscal_profiles,
    fiscal_module_activations: s.fiscal_modules,
    fiscal_periods: s.fiscal_periods,
    fiscal_rules: s.fiscal_rules,
    fiscal_deadlines: s.fiscal_deadlines,
    fiscal_documents: s.fiscal_documents,
    fiscal_checklist_items: s.fiscal_checklist
  }).filter(([, exists]) => !exists).map(([name]) => name);
  if (missing.length) console.warn('[FISCALITÉ] Schéma incomplet — tables absentes : ' + missing.join(', ') + '. Vérifiez les migrations 046, 050 et exécutez « npm run migrate » après sauvegarde.');
  if (!s.migration_history) console.warn('[FISCALITÉ] Historique schema_migrations absent : vérifiez la base connectée avant toute migration.');
  else {
    const { rows: applied } = await pool.query("SELECT name FROM schema_migrations WHERE name IN ('046_fiscalite.sql','050_fiscal_checklist.sql','057_fiscal_access_permission.sql','058_fiscalite_admin_platform_only.sql')");
    const done = new Set(applied.map(x => x.name));
    const pending = ['046_fiscalite.sql','050_fiscal_checklist.sql','057_fiscal_access_permission.sql','058_fiscalite_admin_platform_only.sql'].filter(x => !done.has(x));
    if (pending.length) console.warn('[FISCALITÉ] Migrations absentes de l’historique : ' + pending.join(', ') + '. Contrôlez schema_migrations et exécutez « npm run migrate » après sauvegarde.');
    const { rows: perm } = await pool.query("SELECT EXISTS (SELECT 1 FROM permissions WHERE code='fiscal.access') AS present");
    if (!perm[0].present) console.warn('[FISCALITÉ] Permission fiscal.access absente : la migration 057 n’est pas appliquée sur cette base.');
  }
}).catch(e => console.warn('[DIAGNOSTIC BASE] Vérification du schéma impossible : ' + e.message));

if (host) app.listen(port, host, onListening);
else app.listen(port, onListening);
