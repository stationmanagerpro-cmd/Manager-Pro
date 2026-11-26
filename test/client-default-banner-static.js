'use strict';
// Bandeau par défaut personnalisé par client (Super Admin) : routes, isolation, limite de poids, interface, repli.
const fs = require('fs'), assert = require('assert');
const r = f => fs.readFileSync(f, 'utf8'); let n = 0; const ok = (t, f) => { f(); n++; };
const b = r('src/branding.js'), ui = r('public/ext-detail-pages.js'), j = r('public/ext-banner.js');
ok('routes Super Admin uniquement', () => { for (const m of ["admin.get('/admin/clients/:id/default-banner', clientAdAdmin", "admin.get('/admin/clients/:id/default-banner/image', clientAdAdmin", "admin.put('/admin/clients/:id/default-banner', clientAdAdmin", "admin.delete('/admin/clients/:id/default-banner', clientAdAdmin"]) assert(b.includes(m), m); });
ok('clé isolée par client + client vérifié', () => { assert(/client_default_banner_\$\{Number\(id\)\}/.test(b)); const i = b.indexOf("admin.put('/admin/clients/:id/default-banner'"); assert(/ensureClientExists\(id\)/.test(b.slice(i, i + 600))); });
ok('poids limité à 400 Ko côté serveur (413)', () => { assert(/CLIENT_BANNER_MAX = 400 \* 1024/.test(b)); assert(/HttpError\(413, `Image trop lourde/.test(b)); });
ok('journal d’audit sur pose et suppression', () => { assert((b.match(/audit\(pool, req, 'bandeau client'/g) || []).length === 2); });
ok('lecture client : uniquement son propre client, 404 sinon', () => { const i = b.indexOf("admin.get('/me/default-banner'"); assert(i > 0); const s = b.slice(i, i + 500); assert(/currentClientId\(req\)/.test(s) && /404/.test(s) && !/req\.params/.test(s)); });
ok('l’ancienne image est supprimée au remplacement', () => assert(/old\.path !== rel\) \{ try \{ await files\.remove\(old\.path\)/.test(b)));
ok('bandeau : repli sur l’image Manager PRO', () => { assert(/\/api\/me\/default-banner/.test(j) && /return DEFAULT_IMG/.test(j) && /\.catch\(function \(\) \{ return DEFAULT_IMG; \}\)/.test(j)); assert(/var shown = url \|\| await defaultUrl\(\)/.test(j)); });
ok('interface : onglet, recadrage 3:1, compression WebP, aperçu', () => { for (const k of ["['banner','Bandeau par défaut']", 'renderClientBannerEditor', 'clientBannerPick', 'clientBannerRemove', "'image/webp'", 'BN_TARGET = 150 * 1024', 'BN_MAX = 400 * 1024', 'Poids final']) assert(ui.includes(k), k); });
ok('chargement versionné et pré-chargé hors ligne', () => { assert(r('public/index.html').includes('ext-banner.js?v=5') && r('public/sw.js').includes('ext-banner.js?v=5')); });
console.log(n + ' contrôles OK');
