const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = require('path').join(__dirname,'..','public');
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

/* ===== « A propos de Manager PRO » : test réel dans Chromium (mobile, tablette, ordinateur) =====
   Vérifie : onglet en bas du menu, 10 solutions × (Objectif, Solutions, Avantages), carte « à venir », approche, « pourquoi choisir »,
   section de téléchargement TOUT EN BAS, « Bientôt disponible » sans lien, absence de débordement horizontal, absence d'erreur JavaScript,
   édition réservée au Super Admin (enregistrement d'un lien https, refus d'un lien http). Captures : SHOTS (défaut : dossier temporaire). */
const About = require('../src/about_logic.js');
const SHOTS = process.env.SHOTS || require('os').tmpdir();
let stored = null, puts = [];
const meta = () => ({ content: stored || About.defaultDoc(), customized: !!stored, editable: !!(me && me.is_global), app_version: 'test' });
async function aboutRoutes(page) {
  await page.route('**/api/me/about', r => json(r, meta()));
  await page.route('**/api/admin/about', async r => {
    if (!me || !me.is_global) return json(r, { error: 'Action réservée au Super Admin.' }, 403);
    const b = JSON.parse(r.request().postData()); puts.push(b);
    try { stored = About.sanitize(b.content); } catch (e) { return json(r, { error: e.message }, 400); }
    return json(r, { ok: true, content: stored });
  });
}
async function resetRoute(page) { await page.route('**/api/admin/about/reset', r => { stored = null; return json(r, { ok: true, content: About.defaultDoc() }); }); }
const VIEWPORTS = [['mobile', 390, 844], ['tablette', 820, 1180], ['ordinateur', 1366, 800]];
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://localhost:' + srv.address().port;
  const br = await chromium.launch(); const errs = [];
  for (const [vname, w, h] of VIEWPORTS) {
    console.log('== ' + vname + ' ' + w + 'x' + h + ' — compte client (gérant)');
    me = null; stored = null; puts = [];
    const ctx = await br.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' }); const page = await ctx.newPage();
    page.on('pageerror', e => { errs.push(vname + ' : ' + e.message); console.log('   [pageerror]', e.message); });
    await mock(page); await aboutRoutes(page);
    await page.goto(base); await page.waitForSelector('#lu');
    await page.fill('#lu', 'admin'); await page.fill('#lp', 'good'); await page.click('.login-card button'); await page.waitForSelector('#app.ready'); await page.waitForTimeout(900);
    if (w > 860) {
      const links = page.locator('#nav .nav-scroll > .nav-link, #nav .nav-scroll > .nav-node');
      const last = links.last(); ok(((await last.textContent()) || '').includes('A propos de Manager PRO'), 'onglet « A propos de Manager PRO » = dernier du menu');
      await page.locator('#nav .nav-link[data-go="apropos"]').click();
    } else { await page.evaluate(() => go('apropos')); }
    await page.waitForSelector('#ab-root .ab-hero');
    ok((await page.textContent('#ttl')).includes('A propos'), 'l’onglet s’ouvre');
    ok(await page.locator('.ab-sol').count() === 10, '10 solutions affichées');
    ok(await page.locator('.ab-sol .ab-blk h4', { hasText: /^Objectif$/ }).count() === 10, 'rubrique « Objectif » sur chaque solution (10/10)');
    ok(await page.locator('.ab-sol .ab-blk h4', { hasText: /^Solutions$/ }).count() === 10, 'rubrique « Solutions » sur chaque solution (10/10)');
    ok(await page.locator('.ab-sol .ab-blk h4', { hasText: /^Avantages$/ }).count() === 10, 'rubrique « Avantages » sur chaque solution (10/10)');
    const names = await page.locator('.ab-sol-t h3').allTextContents();
    ok(['STATION MANAGER PRO', 'SCHOOL MANAGER PRO', 'IKA SÔ MANAGER PRO', 'PHARMA MANAGER PRO', 'FACTURE MANAGER PRO', 'PRESSING MANAGER PRO', 'GESTOCK MANAGER PRO', 'COMMERCE MANAGER PRO', 'COUTURE MANAGER PRO', 'E-COMMERCE MANAGER PRO'].every((n, i) => names[i] === n), 'noms et ordre des 10 solutions');
    ok(await page.locator('.ab-sol-ic').count() === 10 && (await page.locator('.ab-sol-ic').allTextContents()).every(t => t.trim()), 'une icône par solution');
    ok(await page.isVisible('.ab-upcoming') && (await page.textContent('.ab-upcoming')).includes('À VENIR'), 'carte « et bien d’autres solutions à venir »');
    ok(!(await page.textContent('.ab-upcoming')).toLowerCase().includes('disponible'), 'solutions futures non présentées comme disponibles');
    ok((await page.textContent('.ab-approach h2')).includes('ADAPTÉE À CHAQUE MÉTIER') && await page.locator('.ab-commit li').count() === 4, 'approche + 4 engagements');
    ok(await page.locator('.ab-why-grid li').count() === 7, '« Pourquoi choisir » : 7 arguments avec icônes');
    ok((await page.textContent('.ab-dl h2')).includes('VOUS ACCOMPAGNE PARTOUT'), 'section téléchargement : titre');
    const lastId = await page.evaluate(() => document.querySelector('#ab-root').lastElementChild.id);
    ok(lastId === 'ab-download', 'section téléchargement = TOUT DERNIER bloc de la page');
    ok(await page.locator('.ab-dl-card').count() === 2 && await page.locator('.ab-phone').count() === 2, 'deux cartes (Android, iOS) avec smartphone');
    ok(await page.locator('.ab-dl-card[data-os="android"] a.ab-dl-btn[href="/telechargements/Ika-So.apk"][download]').count() === 1 && await page.locator('.ab-dl-card[data-os="ios"] .ab-dl-btn.is-soon', { hasText: 'BIENTÔT DISPONIBLE' }).count() === 1 && await page.locator('a.ab-dl-btn').count() === 1, 'Android : bouton de téléchargement de l’APK hébergé ; iOS sans lien : « Bientôt disponible », aucun faux bouton');
    ok(!(await page.textContent('#ab-root')).match(/play\.google|apps\.apple/), 'aucun lien de store inventé');
    ok(await page.locator('.ab-edit-btn').count() === 0, 'compte client : pas de bouton « Modifier la page »');
    const ov = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, root: document.getElementById('ab-root').scrollWidth - document.getElementById('ab-root').clientWidth }));
    ok(ov.doc <= 1 && ov.root <= 1, 'aucun débordement horizontal (page ' + ov.doc + ' px, contenu ' + ov.root + ' px)');
    const small = await page.evaluate(() => [...document.querySelectorAll('#ab-root a.ab-dl-btn, #ab-root .ab-dl-btn, #ab-root .ab-edit-btn')].every(b => b.getBoundingClientRect().height >= 40));
    ok(small, 'boutons assez hauts pour le tactile (≥ 40 px)');
    await page.screenshot({ path: SHOTS + '/a-propos-' + vname + '-haut.png' });
    await page.locator('#ab-download').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.screenshot({ path: SHOTS + '/a-propos-' + vname + '-telechargement.png' });
    await page.locator('#ab-solutions').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
    await page.screenshot({ path: SHOTS + '/a-propos-' + vname + '-solutions.png' });
    await ctx.close();
  }

  console.log('== Super Admin (ordinateur) : édition et liens de téléchargement');
  me = null; stored = null; puts = [];
  const ctx = await br.newContext({ viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' }); const page = await ctx.newPage();
  page.on('pageerror', e => { errs.push('sa : ' + e.message); console.log('   [pageerror]', e.message); });
  await mock(page); await aboutRoutes(page); await resetRoute(page);
  await page.goto(base); await page.waitForSelector('#lu');
  await page.fill('#lu', 'sa'); await page.fill('#lp', 'good'); await page.click('.login-card button'); await page.waitForSelector('#app.ready'); await page.waitForTimeout(600);
  const lastSa = (await page.locator('#nav .nav-scroll > *').last().textContent()) || '';
  ok(lastSa.includes('A propos de Manager PRO'), 'Super Admin : onglet en dernière position du menu');
  await page.locator('#nav .nav-link[data-go="apropos"]').click(); await page.waitForSelector('#ab-root .ab-hero');
  ok(await page.locator('.ab-edit-btn').count() === 1, 'Super Admin : bouton « Modifier la page »');
  await page.click('.ab-edit-btn'); await page.waitForSelector('.ab-editing');
  ok(await page.locator('.ab-sole').count() === 10 && await page.locator('.ab-com-ed').count() === 4, 'éditeur : 10 solutions et 4 engagements modifiables');
  await page.screenshot({ path: SHOTS + '/a-propos-editeur.png' });
  // lien http refusé côté interface (aucun envoi)
  await page.fill('#ab_android', 'http://exemple.test/app.apk'); await page.click('.ab-save button:has-text("Enregistrer")');
  await page.waitForSelector('#toast.show'); ok((await page.textContent('#toast')).includes('https://') && puts.length === 0, 'lien http:// refusé, rien d’envoyé');
  // lien https enregistré ; ajout d'une solution ; déplacement
  await page.fill('#ab_android', 'https://exemple.test/telecharger-android');
  await page.click('button:has-text("Ajouter une solution")'); await page.waitForFunction(() => document.querySelectorAll('.ab-sole').length === 11);
  ok(await page.locator('.ab-sole').count() === 11, 'ajout d’une solution sans perdre la saisie');
  ok((await page.inputValue('#ab_android')) === 'https://exemple.test/telecharger-android', 'saisie conservée après ajout');
  await page.click('.ab-save button:has-text("Enregistrer")'); await page.waitForSelector('#ab-root .ab-hero');
  ok(puts.length === 1 && puts[0].content.downloads.android_url === 'https://exemple.test/telecharger-android' && puts[0].content.solutions.length === 11, 'enregistrement envoyé au serveur (PUT /admin/about)');
  const a = page.locator('a.ab-dl-btn');
  ok(await a.count() === 1 && (await a.getAttribute('href')) === 'https://exemple.test/telecharger-android' && (await a.getAttribute('target')) === '_blank' && (await a.getAttribute('rel')).includes('noopener'), 'bouton Android actif avec le lien configuré (nouvel onglet, noopener)');
  ok((await page.textContent('.ab-dl-card[data-os="ios"]')).includes('BIENTÔT DISPONIBLE'), 'iOS sans lien : toujours « Bientôt disponible »');
  ok((await page.textContent('.ab-dl-card[data-os="android"]')).includes('Disponible sur Android'), 'Android : « Disponible sur Android » seulement une fois le lien renseigné');
  ok(await page.locator('.ab-sol').count() === 11, 'la nouvelle solution apparaît sur la page');
  await page.screenshot({ path: SHOTS + '/a-propos-sa-telechargement.png', fullPage: false });
  // XSS : le texte saisi est affiché comme du texte
  await page.click('.ab-edit-btn'); await page.waitForSelector('.ab-editing');
  await page.fill('#ab_title', '<img src=x onerror="window.__xss=1">Titre'); await page.click('.ab-save button:has-text("Enregistrer")'); await page.waitForSelector('#ab-root .ab-hero');
  ok(await page.evaluate(() => !window.__xss) && await page.locator('#ab-root img[src="x"]').count() === 0, 'HTML saisi non interprété (aucune injection)');
  // retour au modèle d'origine (avec confirmation)
  ok(stored !== null, 'avant : contenu personnalisé enregistré');
  await page.click('.ab-edit-btn'); await page.waitForSelector('.ab-editing'); await page.click('button:has-text("Rétablir le modèle d’origine")');
  await page.click('#yes'); await page.waitForFunction(() => document.querySelectorAll('.ab-sol').length === 10 && !document.querySelector('.ab-editing'));
  ok(stored === null && (await page.textContent('.ab-hero h2')).trim() === 'A propos de Manager PRO', 'modèle d’origine rétabli (10 solutions, titre d’origine)');
  ok(await page.locator('.ab-dl-card[data-os="android"] a.ab-dl-btn[href="/telechargements/Ika-So.apk"]').count() === 1, 'après retour au modèle : lien Android par défaut (APK hébergé) rétabli');
  await ctx.close(); await br.close(); srv.close();
  ok(errs.length === 0, 'aucune erreur JavaScript (' + errs.length + ')');
  console.log(fails ? '\n' + fails + ' ÉCHEC(S)' : '\nTOUS LES TESTS UI « A PROPOS » PASSENT'); process.exit(fails ? 1 : 0);
})();
