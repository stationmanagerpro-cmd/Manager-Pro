/* Manager PRO — Service Worker léger
 * - Précache assets statiques versionnés uniquement
 * - /api/** → network-only (jamais de cache : auth JWT, données métier)
 * - Navigation HTML → network-first, fallback cache index si offline total
 */
const CACHE = 'smp-static-bb3d22fbf28';

/* PRECACHE:BEGIN (généré par scripts/build-sw.js — ne pas modifier à la main) */
const PRECACHE = [
  '/',
  '/app.css',
  '/app.js',
  '/design-v2.css',
  '/ext-about.css',
  '/ext-about.js',
  '/ext-accounting.css?v=2',
  '/ext-accounting.js?v=3',
  '/ext-achats.js?v=3',
  '/ext-aggregates.js?v=1',
  '/ext-aide-demo.js',
  '/ext-alert-config.js',
  '/ext-archive.js',
  '/ext-avenir.js',
  '/ext-banner.css?v=1',
  '/ext-banner.js?v=2',
  '/ext-billing.js?v=2',
  '/ext-brand-admin.js',
  '/ext-branded-pdf.js?v=2',
  '/ext-calc.css',
  '/ext-calc.js',
  '/ext-confort.js',
  '/ext-contracts.js',
  '/ext-core.js?v=2',
  '/ext-dash-range.js?v=1',
  '/ext-design.js?v=3',
  '/ext-detail-pages.js',
  '/ext-direction.js?v=2',
  '/ext-export-all.js?v=1',
  '/ext-fin.js',
  '/ext-finance-p4.js?v=2',
  '/ext-fiscal-admin.js',
  '/ext-fiscal-wizard.js',
  '/ext-fiscal.js',
  '/ext-fleet.js?v=2',
  '/ext-form-drafts.js?v=1',
  '/ext-home.js',
  '/ext-hr-v2.js',
  '/ext-import.js?v=3',
  '/ext-improvements.js',
  '/ext-license-ticker.css?v=1',
  '/ext-license-ticker.js?v=1',
  '/ext-magasins.js?v=2',
  '/ext-map.js?v=2',
  '/ext-market.js?v=1',
  '/ext-messaging.js?v=3',
  '/ext-modern-pack.js?v=2',
  '/ext-money-match.js?v=1',
  '/ext-multistation-views.js?v=4',
  '/ext-multistation.js',
  '/ext-my-profile.css?v=2',
  '/ext-my-profile.js?v=2',
  '/ext-nav-colors.js',
  '/ext-notif-rules.js',
  '/ext-offline-close.js',
  '/ext-offline-sales.js',
  '/ext-ops.js',
  '/ext-p10.js',
  '/ext-p11.js',
  '/ext-p12.js',
  '/ext-p3.js',
  '/ext-p5.js?v=2',
  '/ext-p6.js',
  '/ext-p7.js',
  '/ext-p8.js',
  '/ext-p9.js',
  '/ext-parties.css?v=1',
  '/ext-parties.js?v=1',
  '/ext-period-range.js',
  '/ext-pilotage-pdf.js?v=1',
  '/ext-platform.js',
  '/ext-polish.css?v=2',
  '/ext-premium.js',
  '/ext-product-catalog.css?v=1',
  '/ext-product-catalog.js?v=1',
  '/ext-product-profile.css?v=2',
  '/ext-product-profile.js',
  '/ext-profile-stats.js',
  '/ext-profit.js',
  '/ext-proposals.js',
  '/ext-purchase-order.js',
  '/ext-purchase-orders.js?v=2',
  '/ext-push.js',
  '/ext-report-tools.js?v=1',
  '/ext-roles.js',
  '/ext-sa-dash.css',
  '/ext-sa-dash.js',
  '/ext-sale-shift.js',
  '/ext-shell.css',
  '/ext-shell.js',
  '/ext-shifts-sales-pdf.js?v=1',
  '/ext-sidebar-pub.js',
  '/ext-skin-pro.css?v=2',
  '/ext-skin-pro.js?v=2',
  '/ext-stock-reports.js',
  '/ext-tabs-motion.css?v=1',
  '/ext-tanks.js',
  '/ext-teamroles.js',
  '/ext-time24.js',
  '/ext-treasury.css?v=1',
  '/ext-treasury.js?v=4',
  '/ext-ux-v2.js',
  '/ext-vendeurs.js',
  '/home-core.js',
  '/home-editor.css',
  '/home-editor.js',
  '/i18n.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/index.html',
  '/manifest.json',
  '/native-bridge.js?v=2',
  '/performance-motion.css',
  '/pwa.js',
  '/responsive-phone.css?v=2',
  '/responsive-v3.css',
  '/responsive-v3.js',
  '/table-fit.js?v=1',
  '/vendor/chart.umd.min.js'
];
/* PRECACHE:END */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/c/')) return;   // espace client : page publique à lien privé, jamais mise en cache ni confondue avec l'application

  // Critique : aucune mise en cache des API (JWT, sessions, données stations)
  if (isApi(url)) {
    event.respondWith(fetch(req));
    return;
  }

  // Navigation : réseau d'abord
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Assets statiques : cache-first, puis réseau
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (url.pathname.endsWith('.js') || url.pathname.endsWith('.css') ||
            url.pathname.endsWith('.png') || url.pathname.endsWith('.svg') ||
            url.pathname.endsWith('.woff2') || url.pathname.includes('/icons/'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});


/* Notifications push locales (message depuis la page) */
self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'smp-notify' && self.registration && self.registration.showNotification) {
    self.registration.showNotification(data.title || 'Station Manager', {
      body: data.body || '',
      tag: data.tag || 'smp-alert',
      icon: '/icons/icon-192.png',
      data: { url: '/' }
    });
  }
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
