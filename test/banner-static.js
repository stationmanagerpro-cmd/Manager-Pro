'use strict';
// Bandeau d'accueil personnalisable : base, route, interface, contrôle de lisibilité, cache hors ligne.
const fs = require('fs'), assert = require('assert');
const r = f => fs.readFileSync(f, 'utf8'); let n = 0; const ok = (t, f) => { f(); n++; };
ok('migration 099', () => { const m = r('migrations/099_station_banner_style.sql'); for (const c of ['banner_title', 'banner_style', 'banner_legibility', 'banner_checked_at']) assert(m.includes('ADD COLUMN IF NOT EXISTS ' + c)); });
ok('route /station-banner protégée et validée', () => { const a = r('src/admin.js'); const i = a.indexOf("r.put('/station-banner'"); assert(i > 0); const b = a.slice(i, i + 1800); assert(/appearance\.manage/.test(b.slice(0, 300)) && !/settings\.edit/.test(b.slice(0, 300))); assert(/audit\(/.test(b)); assert(/WHERE id = \$1/.test(b), 'filtre station'); assert(/z\.enum\(\['ok', 'warn'\]\)/.test(a)); assert(/\.strict\(\)/.test(a.slice(a.indexOf('bannerStyleSchema'), i))); });
ok('le serveur refuse un nom illisible', () => assert(/b\.legibility === 'warn'\) throw new HttpError\(422/.test(r('src/admin.js'))));
ok('suppression de la photo réinitialise la lisibilité', () => assert(/banner_legibility = NULL/.test(r('src/admin.js'))));
ok('appearance expose titre/style/lisibilité', () => assert(/s\.banner_title, s\.banner_style, s\.banner_legibility/.test(r('src/admin.js'))));
ok('interface', () => { const j = r('public/ext-banner.js'); for (const k of ['openBannerDialog', 'ratioFor', 'optimize', 'Corrigez la lisibilité pour enregistrer', 'risque d’être illisible', "legibility: legib"]) assert(j.includes(k), k); assert(/MIN = 4\.5/.test(j)); assert(!/innerHTML\s*=\s*[^;]*\bo\.name(?!\s*\))/.test(j.replace(/E\(o\.name\)/g, '')), 'nom échappé'); });
ok('nom et slogan échappés', () => assert(/E\(o\.name\)/.test(r('public/ext-banner.js')) && /E\(o\.slogan/.test(r('public/ext-banner.js'))));
ok('chargement + cache hors ligne', () => { const h = r('public/index.html'), w = r('public/sw.js'); for (const f of ['ext-banner.css?v=1', 'ext-banner.js?v=2']) { assert(h.includes(f), f); assert(w.includes(f), f); } });
ok('paramètres : bouton Personnaliser le bandeau', () => assert(/openBannerDialog\(\)/.test(r('public/ext-fin.js'))));
ok('bandeau : modifiable seulement dans Paramètres → Apparence', () => {
  const j = r('public/ext-banner.js'), f = r('public/ext-fin.js'), a = r('src/admin.js');
  assert(!/onclick="openBannerDialog\(\)">🖼 Personnaliser/.test(j), 'plus de bouton sur le bandeau');
  assert(/function canEdit\(\) \{ try \{ return can\('appearance\.manage'\)/.test(j));
  const iApp = f.indexOf('async app()'), iSec = f.indexOf('async sec()'), iGen = f.indexOf('async gen()');
  assert(f.slice(iApp, iSec).includes('openBannerDialog()'), 'bouton dans Apparence');
  assert(!f.slice(iGen, iApp).includes('openBannerDialog()'), 'plus de bouton dans Général');
  assert(/entity === 'banner'\) return req\.user\.perms\.has\('appearance\.manage'\)/.test(a));
});
ok('bandeau en haut de la page, au-dessus de l’en-tête', () => assert(/host\.insertBefore\(h, hd\)/.test(r('public/ext-banner.js'))));
ok('fil d’Ariane cliquable', () => { const j = r('public/ext-skin-pro.js'); assert(/skin-crumb-link/.test(j) && /go\(k\)/.test(j) && /data-go/.test(j)); });
ok('bandeau sur toutes les pages client', () => { const j = r('public/ext-banner.js'); assert(!/cur === 'dash' && typeof ME/.test(j)); assert(/hero-compact/.test(j)); });
ok('bandeau aussi chez le Superadmin', () => assert(/var sa = typeof ME/.test(r('public/ext-banner.js'))));
ok('photo de bandeau du Superadmin (branding)', () => { const b = r('src/branding.js'); assert(/banner: 'app_banner_path'/.test(b) && /pub\.get\('\/banner'/.test(b) && /banner: \{ key: KEYS\.banner/.test(b) && /has_banner/.test(b)); assert(/img\('banner'/.test(r('public/ext-brand-admin.js'))); });
console.log(n + ' contrôles OK');
