'use strict';
// Sans base de données ni dépendances : npm run test:product-pdf-photo-archive
// 1) export PDF de la fiche produit (sections, droits, masquage des coûts) ; 2) contrôles structurels :
// produits actifs/inactifs, photo du produit, refus de commander un produit inactif.
const Module = require('module');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const calls = []; let handler = () => [];
const client = { query: async (sql, params) => { calls.push({ sql, params: params || [] }); return { rows: handler(sql, params || []), rowCount: 1 }; } };
const routes = {}; const audits = []; const sent = {}; let pdfDef = null;
const chain = new Proxy(function () {}, { get: () => chain, apply: () => chain });
const coreStub = { canCost: req => !!(req.user && req.user.perms && req.user.perms.has('cost.view')), maskCost: (req, x) => x, pool: client, tx: async fn => fn(client), HttpError, wrap: f => f, body: () => ({ body: true }), need: (...perms) => ({ gate: perms }), audit: async (...a) => { audits.push(a); } };
const mkRouter = () => ({ get: (p, ...fns) => { routes['GET ' + p] = fns; }, post: (p, ...fns) => { routes['POST ' + p] = fns; } });
const docsStub = {
  cellText: v => (typeof v === 'number' ? String(v) : v ?? ''), fmtDate: d => String(d),
  branding: async () => ({ currency: 'FCFA' }), buildPdf: async def => { pdfDef = def; return Buffer.from('%PDF-fake'); },
  send: (res, fmt, buf, name) => { sent.fmt = fmt; sent.name = name; sent.size = buf.length; res.sent = true; }
};
const origLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && /(profile_stats|product_profile)\.js$/.test(parent.filename)) {
    if (request === 'express') return { Router: mkRouter };
    if (request === 'zod') return { z: chain };
    if (request === './core') return coreStub;
    if (request === './docs') return docsStub;
  }
  return origLoad.apply(this, arguments);
};
require(path.join(__dirname, '..', 'src', 'product_profile.js'));
Module._load = origLoad;

let failed = 0;
const check = async (label, fn) => { try { calls.length = 0; audits.length = 0; pdfDef = null; await fn(); console.log('✔ ' + label); } catch (e) { failed++; console.log('✖ ' + label + '\n    ' + (e.stack || e).split('\n').slice(0, 3).join('\n    ')); } };
const req = (perms, extra = {}) => ({ sid: 5, user: { id: 9, perms: new Set(perms) }, query: {}, params: { id: '12' }, body: {}, ...extra });
const run = (key, rq) => { const res = { json: v => { res.body = v; return res; }, status: c => { res.code = c; return res; } }; const fns = routes[key]; return fns[fns.length - 1](rq, res).then(() => res); };
const PRODUCT = { id: 12, name: 'Huile 5L', category: 'HUILE', category_label: 'Huile', unit: 'L', buy_price: '1000.00', sell_price: '1500.00', tax_rate: '0', min_stock: '10', stock: '40', active: false, main_supplier_id: 3, supplier_name: 'Total', barcode: 'B1', photo_path: 'products/abc.png' };
const base = extra => (sql, params) => {
  if (/FROM products p JOIN categories/.test(sql)) return [PRODUCT];
  if (/generate_series/.test(sql)) return ['2026-09', '2026-10'].map(k => ({ k }));
  if (/AS from_date/.test(sql)) return [{ from_date: '2026-08-01', to_date: '2026-10-27' }];
  return (extra && extra(sql, params)) || [];
};
const titles = () => pdfDef.sections.filter(s => s.title).map(s => s.title);
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

(async () => {
  await check('route PDF déclarée avec une garde de permission', () => {
    const r = routes['GET /products/:id/profile.pdf']; assert.ok(r && r[0].gate && r[0].gate.length);
  });
  await check('PDF complet : identité + toutes les sections autorisées, fichier PDF envoyé et audité', async () => {
    handler = base();
    const res = await run('GET /products/:id/profile.pdf', req(['price.edit', 'report.view']));
    assert.ok(res.sent && sent.fmt === 'pdf' && /^fiche-produit-12-/.test(sent.name), sent.name);
    const t = titles(); assert.ok(t.includes('Identité du produit') && t.some(x => /Historique complet des prix/.test(x)), t.join(' | '));
    assert.strictEqual(pdfDef.title, 'FICHE PRODUIT COMPLETE');
    assert.ok(pdfDef.sections[0].rows.some(r => r[0] === 'Statut' && /Inactif/.test(r[1])), 'statut inactif imprimé');
    assert.ok(audits.some(a => /Export PDF/.test(a[3])), 'audit');
  });
  await check('PDF d\'un seul onglet : nom de fichier et titre propres à l\'onglet', async () => {
    handler = base();
    await run('GET /products/:id/profile.pdf', req(['price.edit'], { query: { section: 'prices' } }));
    assert.ok(/-prices-/.test(sent.name) && /GESTION DES PRIX/.test(pdfDef.title), sent.name + ' / ' + pdfDef.title);
  });
  await check('section inconnue → 400 ; section sans droit → 403', async () => {
    handler = base();
    await assert.rejects(() => run('GET /products/:id/profile.pdf', req(['sale.create'], { query: { section: 'zzz' } })), e => e.status === 400);
    await assert.rejects(() => run('GET /products/:id/profile.pdf', req(['sale.create'], { query: { section: 'stock' } })), e => e.status === 403);
    await assert.rejects(() => run('GET /products/:id/profile.pdf', req(['sale.create'], { query: { section: 'supply' } })), e => e.status === 403);
  });
  await check('PDF complet sans droit achats/stocks : ces sections sont omises sans erreur', async () => {
    handler = base();
    await run('GET /products/:id/profile.pdf', req(['sale.create']));
    const t = titles().join(' | '); assert.ok(!/dotation|Synthèse des mouvements|Historique des stocks/.test(t), t);
  });
  await check('PDF : sans droit sur les coûts, prix d\'achat et marge ne sont pas imprimés', async () => {
    handler = base();
    await run('GET /products/:id/profile.pdf', req(['sale.create']));
    const kv = pdfDef.sections[0].rows.map(r => r[0]);
    assert.ok(!kv.includes("Prix d'achat") && !kv.includes('Marge unitaire'), kv.join(','));
  });
  await check('produit d\'une autre station → 404 ; identifiant invalide → 400', async () => {
    handler = () => [];
    await assert.rejects(() => run('GET /products/:id/profile.pdf', req(['price.edit'])), e => e.status === 404);
    await assert.rejects(() => run('GET /products/:id/profile.pdf', req(['price.edit'], { params: { id: 'abc' } })), e => e.status === 400);
  });
  await check('la fiche expose la photo du produit', async () => {
    handler = base();
    const res = await run('GET /products/:id/profile', req(['price.edit', 'report.view']));
    assert.strictEqual(res.body.product.photo_path, 'products/abc.png');
  });

  // ---- contrôles structurels ----
  await check('migration 077 : photo_path et deactivated_at sur products', () => {
    const m = read('migrations/077_produits_photo_inactifs.sql');
    assert.ok(/ALTER TABLE products ADD COLUMN IF NOT EXISTS photo_path/.test(m) && /deactivated_at/.test(m));
  });
  await check('liste produits : actifs par défaut, ?inactive=1 pour les inactifs ; route de statut protégée', () => {
    const c = read('src/catalog.js');
    assert.ok(/p\.active = \$2/.test(c) && /req\.query\.inactive === '1'/.test(c));
    assert.ok(/r\.patch\('\/products\/:id\/status', need\('price\.edit'\)/.test(c));
    assert.ok(/compteur de pompe/.test(c), 'refus si relié à un compteur de pompe');
  });
  await check('images : produits acceptés, réservés à image.manage / price.edit / stock.adjust', () => {
    const a = read('src/admin.js');
    assert.ok(/products: 'products'/.test(a) && /productPhoto/.test(a) && /price\.edit/.test(a));
  });
  await check('achats : un produit inactif ne peut plus être commandé (409), les commandes existantes restent réceptionnables', () => {
    const p = read('src/purchases.js');
    assert.ok(/AND active'/.test(p) && /Produit inactif \(archivé\)/.test(p));
    const recv = p.slice(p.indexOf('// 2. RÉCEPTION'), p.indexOf('// 5. ARCHIVAGE'));
    assert.ok(!/Produit inactif/.test(recv));
  });
  await check('interface : bouton produits inactifs, archivage par ligne, photo cliquable, boutons PDF', () => {
    assert.ok(/products: \{ view: 'prod'/.test(read('public/ext-archive.js')));
    const app = read('public/app.js'); assert.ok(/archToggleBtn\('products'\)/.test(app) && /archRowBtn\('products'/.test(app));
    assert.ok(/ent === 'products' && \(can\('price\.edit'\)/.test(read('public/ext-core.js')));
    const pp = read('public/ext-product-profile.js'); assert.ok(/window\.ppPdf/.test(pp) && /pickImage\('products'/.test(pp) && /ppPdf\('all'\)/.test(pp));
  });

  if (failed) { console.log('\n' + failed + ' test(s) en échec'); process.exit(1); }
  console.log('\nTous les tests (PDF fiche produit, photo, produits inactifs) passent.');
})();
