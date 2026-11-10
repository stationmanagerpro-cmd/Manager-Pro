const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname,'..','..','public');
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json' };
const srv = http.createServer((q, s) => { let p = q.url.split('?')[0]; if (p === '/') p = '/index.html'; const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(fs.readFileSync(f)); });
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✔ ' : '  ✖ ') + m); if (!c) fails++; };
const ADMIN_PERMS = ['report.view','finance.view','sale.create','cash.manage','settings.edit','user.manage','appearance.manage','customer.view','customer.edit','supplier.view','supplier.edit','export.customers','export.suppliers','debt.view','receivable.view','role.assign','purchase.manage','stock.adjust','audit.view','hr.view','image.manage'];
const CASH_PERMS = ['sale.create','shift.open','customer.view'];
let brand = { name: 'Station Manager Pro', tagline: 'Gestion intelligente de votre station-service', has_logo: false, has_favicon: false, v: 1 };
let me = null, exportCalls = [], blocked = [];
const json = (r, o, st = 200) => r.fulfill({ status: st, contentType: 'application/json', body: JSON.stringify(o) });
async function mock(page) {
  await page.route('**/api/**', async r => {
    const u = new URL(r.request().url()), p = u.pathname.replace('/api', ''), m = r.request().method();
    if (p === '/branding') return json(r, brand);
    if (p === '/public/home') return json(r, { error: 'indisponible' }, 404);   // ANO-09 : l'accueil public est facultatif → repli sur l'écran de connexion
    if (me && me.is_global && p !== '/auth/login' && !['/admin', '/users', '/roles', '/auth', '/me', '/contracts', '/branding', '/messaging'].some(x => p === x || p.startsWith(x + '/'))) { blocked.push(p); return json(r, { error: 'Administrateur Principal : les données métier des stations sont interdites.' }, 403); }
    if (p === '/auth/login') { const b = JSON.parse(r.request().postData()); if (b.password !== 'good') return json(r, { error: 'Identifiant ou mot de passe incorrect' }, 401);
      me = b.login === 'sa' ? { id: 9, login: 'sa', full_name: 'Baba KONTAO', job_title: 'Directeur', role: 'ADMIN', role_label: 'Administrateur', is_global: true, permissions: ADMIN_PERMS, has_photo: false }
        : b.login === 'admin' ? { id: 1, login: 'admin', full_name: 'Moussa Diarra', job_title: 'Gérant', role: 'GERANT', role_label: 'Gérant', is_global: false, permissions: ADMIN_PERMS, has_photo: false }
        : { id: 2, login: 'caisse', full_name: 'Awa Traoré', job_title: 'Caissière', role: 'CAISSIER', role_label: 'Caissier', is_global: false, permissions: CASH_PERMS, has_photo: false };
      me.stations = me.is_global ? [] : [{ id: 1, name: 'Station Test', currency: 'FCFA' }]; return json(r, { token: 't-' + b.login, user: me }); }
    if (p === '/me') return json(r, me);
    if (p === '/appearance') return json(r, { theme: { mode: 'light', primary: '#0a6b5c', secondary: '#647184' }, footer: {}, station: { id: 1, name: 'Station Test', currency: 'FCFA' }, payment_methods: [], expense_categories: [] });
    if (p === '/admin/branding' && m === 'GET') return json(r, { ...brand, defaults: { name: 'Station Manager Pro', tagline: 'Gestion intelligente de votre station-service' }, editable: me.is_global });
    if (p === '/admin/branding' && m === 'PUT') { if (!me.is_global) return json(r, { error: 'Réservé' }, 403); const b = JSON.parse(r.request().postData()); brand = { ...brand, name: b.name, tagline: b.tagline, v: brand.v + 1 }; return json(r, { ok: true }); }
    if (p === '/customers') return json(r, [{ id: 1, name: 'Client Alpha', kind: 'entreprise', phone: '70000000', credit_limit: 50000, balance: 12000 }, { id: 2, name: 'Bako Transport', kind: 'credit', phone: '', credit_limit: 0, balance: 0 }].map(c => me.permissions.includes('receivable.view') ? c : { ...c, balance: null }));
    if (p === '/suppliers') return json(r, [{ id: 1, name: 'Fournisseur Un', phone: '66000000', balance_due: 8000 }]);
    if (p === '/purchases') return json(r, []);
    if (p.startsWith('/exports/')) { exportCalls.push(u.pathname + u.search); return r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 test' }); }
    if (p === '/notifications') return json(r, [{ id: 1, level: 'info', message: 'x', created_at: new Date().toISOString(), read_at: null }]);
    if (p === '/dashboard') return json(r, { period: { from: '2026-10-04', to: '2026-10-04' }, revenue: 1000, fuel_revenue: 0, product_revenue: 1000, sales_count: 1, fuel_by_product: [], expenses: 0, net: 1000, low_stock: [], cash_balance: 0, cash_registers: [], open_shifts: [], receivables: 5, payables: 6, payments_by_method: [], unread_alerts: 0, recent_activity: [], profile: {} });
    if (p === '/dashboard/daily') return json(r, []);
    if (p === '/admin/licenses/dashboard') return json(r, { totals: { clients: 2, active: 1, expiring_soon: 0, expired: 0, suspended: 1 }, pending_renewal_requests: [{ id: 1, client_id: 1, client_name: 'Client Alpha', requester_login: 'gerant', requested_at: new Date().toISOString() }], items: [] });
    if (p === '/admin/overview') return json(r, { users: 3, locked_users: 0, roles: 5, backups: 1, settings_keys: [], station: null, is_global: true, role: 'ADMIN' });
    if (p === '/admin/platform/summary') return json(r, { period: {}, invoiced: 100000, collected: 60000, expenses_committed: 30000, expenses_paid: 10000, receivables: 40000, receivables_overdue: 0, payables: 20000, treasury: 50000, result_accrual: 70000, result_cash: 50000, expenses_by_category: [{ category: 'hebergement', committed: 30000 }], method: 'Méthode de test.' });
    if (p === '/admin/platform/invoices' || p === '/admin/platform/expenses') return json(r, []);
    if (p === '/admin/platform/reports') return json(r, [{ key: 'licences', title: 'Licences et abonnements' }]);
    if (p === '/admin/roles' || p === '/admin/roles/assignable') return json(r, [{ role: 'ADMIN', code: 'ADMIN', label: 'Administrateur', permissions: ADMIN_PERMS, users_count: 1 }]);
    if (p === '/admin/permissions') return json(r, ADMIN_PERMS.map(c => ({ code: c, label: c })));
    if (p === '/users') return json(r, []);
    return json(r, [], 200);
  });
}
// ANO-09 : serviceWorkers: 'block' (le SW PWA contourne page.route) ; /public/home → 404 (accueil public facultatif)
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch(); const ctx = await br.newContext({ viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' }); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => { errs.push(e.message); console.log('   [pageerror]', e.message); }); await mock(page);
  console.log('== Connexion / branding');
  page.on('console', m => { if (m.type()==='error') console.log('   [console.error]', m.text()); });
  await page.goto(base); await page.waitForSelector('.login-brand');
  ok((await page.textContent('.login-brand h1')) === 'Station Manager Pro', 'login : nom par défaut à gauche');
  ok((await page.textContent('.login-tagline')).includes('intelligente'), 'login : slogan par défaut');
  await page.fill('#lu', 'admin'); await page.fill('#lp', 'bad'); await page.click('.login-card button');
  await page.waitForSelector('#toast.show'); ok((await page.textContent('#toast')).includes('incorrect'), 'mauvais mot de passe refusé');
  await page.fill('#lp', 'good'); await page.click('.login-card button'); await page.waitForSelector('#app.ready');
  console.log('== Profil / barre supérieure');
  await page.waitForSelector('#user-chip .uc-text b');
  ok((await page.textContent('#user-chip .uc-text b')) === 'Moussa Diarra', 'nom complet affiché');
  ok((await page.textContent('#user-chip .uc-text small')).includes('Gérant'), 'rôle affiché');
  const t1 = await page.textContent('.clk-time'); await page.waitForTimeout(1300); const t2 = await page.textContent('.clk-time');
  ok(t1 !== t2, 'heure dynamique (' + t1 + ' → ' + t2 + ')'); ok((await page.textContent('.clk-date')).length > 6, 'date affichée : ' + await page.textContent('.clk-date'));
  ok(await page.isVisible('#bell-n'), 'pastille d\'alertes');
  console.log('== Menu vertical & sous-menus flottants');
  ok(await page.isVisible('#nav .nav-title b'), 'nom d\'application dans le menu'); 
  const parent = page.locator('#nav .nav-parent', { hasText: 'Gestion commerciale' });
  await parent.hover(); await page.waitForTimeout(300);
  ok(await page.isVisible('.nav-node.open > .flyout'), 'sous-menu ouvert au survol');
  const fb = await page.locator('.nav-node.open > .flyout').boundingBox(), vb = page.viewportSize();
  ok(fb.x + fb.width <= vb.width && fb.y >= 0 && fb.y + fb.height <= vb.height, 'sous-menu dans l\'écran');
  ok(fb.height < vb.height * 0.6, 'sous-menu compact (pas pleine hauteur)');
  ok(await page.isVisible('.flyout >> text=Clients') && await page.isVisible('.flyout >> text=Fournisseurs'), 'entrées Clients / Fournisseurs');
  await page.mouse.move(700, 500); await page.waitForTimeout(500);
  ok(!(await page.isVisible('.nav-node.open > .flyout').catch(() => false)), 'sous-menu fermé quand le curseur part');
  await parent.hover(); await page.locator('.flyout >> text=Clients').click(); await page.waitForSelector('.pc-q');
  ok((await page.textContent('#ttl')) === 'Clients', 'navigation vers Clients');
  ok(await page.locator('.nav-node.has-active').count() > 0, 'menu parent actif signalé');
  console.log('== Clients : permissions UI + export');
  ok(await page.isVisible('text=Exporter PDF'), 'bouton Exporter PDF (admin)'); ok(await page.isVisible('th:has-text("Solde")'), 'colonne Solde visible (receivable.view)');
  await page.click('text=Exporter PDF'); await page.waitForTimeout(400);
  ok(exportCalls.some(c => c.includes('/exports/customers') && c.includes('format=pdf')), 'appel /exports/customers?format=pdf');
  await page.fill('.pc-q', 'Alpha'); await page.click('text=Exporter PDF'); await page.waitForTimeout(300);
  ok(exportCalls.some(c => c.includes('q=Alpha')), 'filtre de recherche transmis à l\'export');
  await page.locator('#nav .nav-parent', { hasText: 'Gestion commerciale' }).hover(); await page.locator('.flyout >> text=Fournisseurs').click(); await page.waitForSelector('.pc-q');
  ok(await page.isVisible('text=Exporter PDF'), 'Fournisseurs : Exporter PDF');
  console.log('== Menu réduit');
  await page.click('.nav-collapse'); await page.waitForTimeout(300);
  ok((await page.locator('#nav').boundingBox()).width < 90, 'menu réduit en icônes');
  await page.locator('#nav .nav-scroll > .nav-link').first().hover(); await page.waitForTimeout(150);
  ok(await page.isVisible('#nav-tip'), 'infobulle sur icône réduite');
  await page.click('.nav-collapse'); await page.waitForTimeout(300);
  console.log('== Superadmin : connexion, menus, profil, périmètre');
  await page.evaluate(() => logout()); await page.waitForSelector('.login-brand');
  blocked.length = 0; const toasts = []; await page.exposeFunction('__t', t => toasts.push(t));
  await page.fill('#lu', 'sa'); await page.fill('#lp', 'good'); await page.click('.login-card button'); await page.waitForSelector('#app.ready'); await page.waitForTimeout(800);
  ok(await page.locator('#nav .nav-link').count() > 0, 'menus visibles dès la connexion (sans cliquer sur la cloche)');
  ok(!(await page.textContent('#toast')).includes('interdites'), 'aucun message « données métier interdites » après connexion');
  ok(blocked.length === 0, 'aucune requête métier envoyée par le Superadmin (bloquées : ' + blocked.join(', ') + ')');
  const navTxt = await page.textContent('#nav');
  ok(['Tableau de bord plateforme', 'Clients & licences', 'Finance plateforme', 'Administration'].every(x => navTxt.includes(x)), 'rubriques Superadmin présentes');
  ok(!['Ressources humaines', 'Gestion commerciale', 'Ventes', 'Caisse', 'Quarts de service'].some(x => navTxt.includes(x)), 'aucune rubrique métier/RH de station dans le menu Superadmin');
  ok((await page.textContent('#ttl')) === 'Tableau de bord plateforme', 'page d\'accueil : tableau de bord de la plateforme');
  ok((await page.textContent('#user-chip .uc-text b')) === 'Baba KONTAO' && (await page.textContent('#user-chip .uc-text small')).includes('Superadmin'), 'profil : nom réel et rôle Superadmin');
  ok((await page.textContent('#my-av')).trim().length > 0, 'avatar par défaut (initiales)'); ok((await page.textContent('.clk-date')).length > 6, 'date et heure affichées');
  ok(!(await page.isVisible('.top-focus')), 'bouton Focus (mode pompiste) absent');
  ok(!(await page.isVisible('.top-shortcuts button')), 'aucun raccourci de vente/caisse');
  const ttl0 = await page.textContent('#ttl'); await page.click('#bell'); await page.waitForSelector('#m h3');
  ok((await page.textContent('#m h3')) === 'Notifications' && (await page.textContent('#ttl')) === ttl0, 'la cloche ouvre uniquement les notifications');
  await page.click('#m >> text=Fermer');
  await page.locator('#nav .nav-parent', { hasText: 'Clients & licences' }).hover(); await page.waitForTimeout(300);
  const fb2 = await page.locator('.nav-node.open > .flyout').boundingBox(), nb = await page.locator('#nav').boundingBox();
  ok(fb2 && fb2.x >= nb.x + nb.width - 6, 'sous-menu : aucun chevauchement avec le menu principal');
  ok(await page.isVisible('.flyout >> text=Comptes clients & licences'), 'Exploitation = comptes clients et licences');
  await page.mouse.move(900, 600); await page.waitForTimeout(400);
  await page.evaluate(() => go('quart')); await page.waitForTimeout(500);
  ok((await page.textContent('#ttl')) === 'Tableau de bord plateforme', 'accès direct à une vue métier : redirection vers l\'administration');
  await page.evaluate(() => go('pfin')); await page.waitForSelector('text=Finance de la plateforme');
  ok(await page.isVisible('text=Dettes à ce jour') && await page.isVisible('text=Trésorerie'), 'Finance plateforme : indicateurs affichés');
  for (const v of ['clients', 'packs', 'roles']) { await page.evaluate(k => go(k), v); await page.waitForTimeout(350); }
  for (const t of ['users', 'roles', 'contracts', 'identity', 'backups', 'system']) { await page.evaluate(k => goAdminTab(k), t); await page.waitForTimeout(350); }
  ok(blocked.length === 0, 'vues clients/offres/rôles et 6 onglets d\'administration : aucun appel métier interdit (' + blocked.join(', ') + ')');
  ok(blocked.length === 0 && errs.length === 0, 'session Superadmin : 0 appel interdit, 0 erreur JavaScript' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  console.log('== Identité (Superadmin)');
  await page.locator('#nav .nav-link', { hasText: 'Tableau de bord plateforme' }).first().click(); await page.waitForTimeout(500);
  await page.evaluate(() => { window.__adminTab = 'identity'; go('admin'); }); await page.waitForSelector('#br_name');
  await page.fill('#br_name', 'Total Énergies Kati'); await page.fill('#br_tag', 'Votre énergie au quotidien'); await page.click('text=Enregistrer');
  await page.waitForTimeout(600);
  ok((await page.textContent('#nav .nav-title b')) === 'Total Énergies Kati', 'menu : nouveau nom appliqué sans rechargement');
  ok((await page.title()) === 'Total Énergies Kati', 'titre de l\'onglet mis à jour');
  await page.reload(); await page.waitForSelector('#app.ready'); await page.waitForTimeout(1000);
  ok((await page.textContent('#nav .nav-title b')) === 'Total Énergies Kati', 'après actualisation : nom conservé');
  await page.click('#user-chip .uc-btn'); await page.click('text=Déconnexion'); await page.waitForSelector('.login-brand');
  ok((await page.textContent('.login-brand h1')) === 'Total Énergies Kati', 'login : nouveau nom à gauche');
  ok((await page.textContent('.login-tagline')) === 'Votre énergie au quotidien', 'login : nouveau slogan');
  console.log('== Utilisateur non administrateur');
  await page.fill('#lu', 'caisse'); await page.fill('#lp', 'good'); await page.click('.login-card button'); await page.waitForFunction(() => (document.querySelector('#user-chip .uc-text b') || {}).textContent === 'Awa Traoré');
  ok((await page.textContent('#user-chip .uc-text b')) === 'Awa Traoré', 'profil caissier affiché');
  ok(!(await page.isVisible('#nav .nav-parent:has-text("Administration")')), 'pas de menu Administration pour le caissier');
  await page.evaluate(() => go('cli')); await page.waitForSelector('.pc-q');
  ok(!(await page.isVisible('text=Exporter PDF')), 'pas d\'Exporter PDF sans permission'); ok(!(await page.isVisible('th:has-text("Solde")')), 'colonne Solde masquée sans receivable.view');
  ok(!(await page.isVisible('button:has-text("Ajouter un client")')), 'pas de création sans customer.edit');
  await page.evaluate(() => go('admin')); await page.waitForTimeout(400);
  ok((await page.textContent('#ttl')) !== 'Tableau de bord plateforme' && !(await page.isVisible('text=Centre de contrôle administrateur')), 'accès direct à la vue admin refusé côté interface (redirection)');
  await page.click('#user-chip .uc-btn'); await page.click('text=Déconnexion'); await page.waitForSelector('.login-brand');
  ok(true, 'déconnexion');
  console.log('== Responsive');
  for (const [w, h, n] of [[1920, 1080, 'grand écran'], [1366, 768, 'portable'], [820, 1100, 'tablette'], [390, 800, 'mobile']]) {
    await page.setViewportSize({ width: w, height: h }); await page.fill('#lu', 'admin'); await page.fill('#lp', 'good'); await page.click('.login-card button'); await page.waitForSelector('#app.ready'); await page.waitForTimeout(400);
    await page.evaluate(() => go('cli')); await page.waitForSelector('.pc-q');
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    ok(!over, n + ' (' + w + 'px) : pas de débordement horizontal');
    if (w <= 860) { await page.click('#nav-toggle'); await page.waitForTimeout(350); ok(await page.isVisible('#nav .nav-title'), n + ' : tiroir de menu ouvert');
      await page.locator('#nav .nav-parent', { hasText: 'Gestion commerciale' }).click(); await page.waitForTimeout(200); ok(await page.isVisible('.nav-node.open .flyout >> text=Fournisseurs'), n + ' : sous-menu en accordéon (clic)');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
    await page.screenshot({ path: require("path").join(require("os").tmpdir(), `smp-shot-${w}.png`) });   // hors du dépôt
    await page.evaluate(() => logout()); await page.waitForSelector('.login-brand'); const lo = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); ok(!lo, n + ' : login sans débordement');
  }
  ok(errs.length === 0, 'aucune erreur JavaScript' + (errs.length ? ' : ' + errs.join(' | ') : ''));
  await br.close(); srv.close(); console.log(fails ? `\n${fails} ÉCHEC(S)` : '\nTOUS LES TESTS UI PASSENT'); process.exit(fails ? 1 : 0);
})();
