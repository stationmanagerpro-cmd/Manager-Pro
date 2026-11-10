/* A8 — Aide intégrée, lien vers le manuel et mode démonstration.
 *
 * MODE DÉMONSTRATION — séparation stricte, par construction :
 *  - Aucune donnée réelle n'est lue : api() (app.js) renvoie les données d'exemple ci-dessous (station « Badialan 3 »).
 *  - Aucune écriture n'est possible : toute requête POST/PUT/PATCH/DELETE est simulée localement (rien n'est envoyé au serveur),
 *    et un garde sur fetch() refuse toute écriture vers /api tant que la démonstration est active (seule la déconnexion passe).
 *  - Seules quelques lectures de configuration sans donnée métier sont autorisées (profil, apparence, notifications…).
 *  - Réservé aux administrateurs de station ; rien n'est conservé : recharger la page quitte le mode démonstration. */
(function () {
  const MANUAL = '/manuel/Manuel_Utilisation_Manager_Pro.pdf?v=8';
  const state = { active: false, realFetch: null, lastToast: 0 };

  /* ===================== Données d'exemple (station fictive) ===================== */
  const iso = (offH) => new Date(Date.now() - offH * 3600e3).toISOString();
  function dataset() {
    const prods = [
      [1, 'Gasoil', null, 'CARBURANT', 'Carburant', 640, 775, 18450, 'L', 3000],
      [2, 'Super sans plomb', null, 'CARBURANT', 'Carburant', 690, 800, 2650, 'L', 3000],
      [3, 'Pétrole lampant', null, 'CARBURANT', 'Carburant', 520, 600, 6200, 'L', 1500],
      [4, 'Huile moteur 15W40 (1 L)', '6111000012345', 'LUBRIFIANT', 'Lubrifiant', 2800, 3500, 64, 'pce', 20],
      [5, 'Huile moteur 20W50 (4 L)', 'HM-20W50-4', 'LUBRIFIANT', 'Lubrifiant', 9500, 12000, 9, 'pce', 12],
      [6, 'Eau minérale 1,5 L', '6111000099871', 'BOUTIQUE', 'Boutique', 300, 500, 240, 'pce', 50],
      [7, 'Liquide de refroidissement', null, 'ACCESSOIRES', 'Accessoires', 1800, 2500, 31, 'pce', 10],
      [8, 'Recharge téléphone 5 000', null, 'AUTRES', 'Autres', 4700, 5000, 120, 'pce', 30]
    ].map(([id, name, barcode, category, category_label, buy_price, sell_price, stock, unit, min_stock]) =>
      ({ id, name, barcode, sku: barcode, category, category_label, buy_price, sell_price, stock, unit, min_stock, active: true }));
    const counter = (pumpId, n, product_id, product, idx) => ({ id: pumpId * 10 + n, counter_number: n, product_id, product, current_index: idx });
    const pumps = [
      { id: 1, number: 1, name: 'Pompe 1', location: 'Îlot A', status: 'active', counters: [counter(1, 1, 1, 'Gasoil', 482310.5), counter(1, 2, 2, 'Super sans plomb', 301775.2)] },
      { id: 2, number: 2, name: 'Pompe 2', location: 'Îlot A', status: 'active', counters: [counter(2, 1, 1, 'Gasoil', 518902), counter(2, 2, 2, 'Super sans plomb', 276440.8)] },
      { id: 3, number: 3, name: 'Pompe 3', location: 'Îlot B', status: 'active', counters: [counter(3, 1, 3, 'Pétrole lampant', 120455)] }
    ];
    const closedAt = iso(20);
    const pumpsStatus = {
      note: 'État des compteurs au dernier quart clôturé (données d\'exemple).',
      pumps: pumps.map(p => ({ ...p, counters: p.counters.map(c => ({ ...c, last_closed_index: c.current_index, last_closed_at: closedAt })) }))
    };
    const sale = (id, shift_id, kind, input_mode, h, total, status) => ({ id, invoice_no: 'FAC-000' + id, shift_id, kind, input_mode, sold_at: iso(h), total, status });
    return {
      products: prods,
      categories: ['CARBURANT', 'LUBRIFIANT', 'BOUTIQUE', 'ACCESSOIRES', 'AUTRES'].map(code => ({ code, label: code.charAt(0) + code.slice(1).toLowerCase() })),
      pumps, pumpsStatus,
      customers: [
        { id: 1, name: 'Transport Sahel SARL', kind: 'entreprise', phone: '', credit_limit: 2000000, balance: 640000, photo_path: null },
        { id: 2, name: 'Mairie de la Commune III', kind: 'professionnel', phone: '', credit_limit: 1500000, balance: 0, photo_path: null },
        { id: 3, name: 'Oumar Maïga', kind: 'particulier', phone: '', credit_limit: 100000, balance: 45000, photo_path: null },
        { id: 4, name: 'Coopérative Agricole du Mandé', kind: 'credit', phone: '', credit_limit: 800000, balance: 215000, photo_path: null }
      ],
      suppliers: [
        { id: 1, name: 'Dépôt Pétrolier de Koulikoro', phone: '20 24 11 00', balance_due: 3250000, photo_path: null },
        { id: 2, name: 'Lubrimali SA', phone: '20 21 35 90', balance_due: 0, photo_path: null },
        { id: 3, name: 'Grossiste Bamako Distribution', phone: '44 90 12 34', balance_due: 180000, photo_path: null }
      ],
      purchases: [
        { id: 1, order_no: 'CMD-2026-0042', supplier: 'Dépôt Pétrolier de Koulikoro', status: 'facture', total: 8400000, invoice_no: 'F-8841', paid: 5150000 },
        { id: 2, order_no: 'CMD-2026-0043', supplier: 'Lubrimali SA', status: 'recu', total: 960000, invoice_no: '', paid: 0 },
        { id: 3, order_no: 'CMD-2026-0044', supplier: 'Grossiste Bamako Distribution', status: 'commande', total: 420000, invoice_no: '', paid: 0 }
      ],
      employees: [
        [1, 'E001', 'Moussa', 'Traoré', 'pompiste'], [2, 'E002', 'Aminata', 'Coulibaly', 'caissier'], [3, 'E003', 'Seydou', 'Diarra', 'pompiste'],
        [4, 'E004', 'Fatoumata', 'Keïta', 'superviseur'], [5, 'E005', 'Ibrahim', 'Sangaré', 'magasinier']
      ].map(([id, matricule, first_name, last_name, position]) => ({ id, matricule, first_name, last_name, position, phone: '', status: 'actif' })),
      shifts: [
        { id: 5, number: 5, kind: 'Matin', opened_at: iso(3), closed_at: null, status: 'ouvert', cash_gap: null },
        { id: 4, number: 4, kind: 'Nuit', opened_at: iso(24), closed_at: iso(12), status: 'cloture', cash_gap: 0 },
        { id: 3, number: 3, kind: 'Après-midi', opened_at: iso(36), closed_at: iso(25), status: 'cloture', cash_gap: -2500 },
        { id: 2, number: 2, kind: 'Matin', opened_at: iso(48), closed_at: iso(37), status: 'cloture', cash_gap: 0 },
        { id: 1, number: 1, kind: 'Nuit', opened_at: iso(60), closed_at: iso(49), status: 'cloture', cash_gap: 500 }
      ],
      currentShift: {
        id: 5, number: 5, kind: 'Matin', opened_at: iso(3), opening_cash: 250000,
        sales: { n: 38, total: 612500 }, fuel_declared: { liters: 1840.5, total: 1431200 },
        anomalies: [{ id: 1, description: 'Pompe 2 : écran lent au démarrage' }]
      },
      sales: [
        sale(120, 5, 'carburant', 'index', 2, 155000, 'valide'), sale(119, 5, 'produits', null, 2.5, 7000, 'valide'),
        sale(118, 5, 'carburant', 'litres', 2.7, 40000, 'valide'), sale(117, 5, 'carburant', 'montant', 3, 20000, 'valide'),
        sale(116, 5, 'produits', null, 3.4, 12000, 'annule'), sale(115, 4, 'carburant', 'index', 16, 310000, 'valide')
      ],
      registers: [{ id: 1, name: 'Caisse principale', balance: 1845000 }, { id: 2, name: 'Caisse boutique', balance: 312500 }],
      movements: [
        { id: 1, created_at: iso(5), kind: 'encaissement', label: 'Versement du quart 4', amount: 450000 },
        { id: 2, created_at: iso(9), kind: 'depot_bancaire', label: 'Dépôt à la banque', amount: -800000 },
        { id: 3, created_at: iso(30), kind: 'decaissement', label: 'Achat fournitures', amount: -18500 }
      ]
    };
  }

  /* ===================== Routage des lectures + simulation des écritures ===================== */
  const READ_THROUGH = ['/me', '/appearance', '/branding', '/stations', '/notifications', '/settings', '/messaging', '/contracts', '/auth/session'];
  const READ_ROUTES = [
    [/^\/shifts\/current$/, d => d.currentShift], [/^\/shifts$/, d => d.shifts], [/^\/pumps\/status$/, d => d.pumpsStatus], [/^\/pumps$/, d => d.pumps],
    [/^\/products$/, d => d.products], [/^\/categories$/, d => d.categories], [/^\/sales$/, d => d.sales], [/^\/customers$/, d => d.customers],
    [/^\/suppliers$/, d => d.suppliers], [/^\/purchases$/, d => d.purchases], [/^\/employees$/, d => d.employees],
    [/^\/cash\/registers$/, d => d.registers], [/^\/cash\/movements$/, d => d.movements]
  ];
  const clone = v => JSON.parse(JSON.stringify(v));
  const notice = () => {
    if (Date.now() - state.lastToast < 1500) return; state.lastToast = Date.now();
    try { toast('Mode démonstration : action simulée, rien n\'est enregistré dans la vraie base.', 'success'); } catch (_) { /* toast indisponible */ }
  };

  /** Point d'entrée appelé par api() (app.js) tant que la démonstration est active : AUCUN appel réseau pour les données. */
  async function handle(method, p, body) {
    const path = String(p || '').split('?')[0];
    if (method !== 'GET') {
      if (method === 'POST' && path === '/auth/logout') return state.realFetch ? realApi(method, p, body) : { ok: true };
      notice();
      return { ok: true, demo: true, id: 9000 + Math.floor(Math.random() * 999) };
    }
    for (const [re, fn] of READ_ROUTES) if (re.test(path)) return clone(fn(dataset()));
    if (READ_THROUGH.some(x => path === x || path.startsWith(x + '/'))) return realApi(method, p, body);
    throw Object.assign(new Error('Cet écran n\'est pas disponible dans le mode démonstration.'), { status: 404, demo: true });
  }
  // Lectures de configuration (profil, apparence…) et déconnexion : seules requêtes réseau autorisées en démonstration.
  async function realApi(method, p, body) {
    const r = await state.realFetch('/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(typeof TK !== 'undefined' && TK && { Authorization: 'Bearer ' + TK }) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error((j && j.error) || 'Erreur'), { status: r.status });
    return j;
  }

  /* ===================== Garde réseau : aucune écriture vers /api en démonstration ===================== */
  function installGuard() {
    if (state.realFetch) return;
    state.realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (state.active && /(^|\/\/[^/]+)\/api\//.test(url) && method !== 'GET' && !/\/api\/auth\/logout$/.test(url)) {
        return Promise.reject(Object.assign(new Error('Écriture bloquée : mode démonstration.'), { demo: true }));
      }
      return state.realFetch(input, init);
    };
  }
  function removeGuard() { if (state.realFetch) { window.fetch = state.realFetch; state.realFetch = null; } }

  /* ===================== Entrée / sortie du mode démonstration ===================== */
  const isAdmin = () => typeof ME !== 'undefined' && ME && !ME.is_global && typeof can === 'function' && (can('settings.edit') || can('user.manage'));
  function banner() {
    let b = document.getElementById('demo-banner');
    if (!state.active) { if (b) b.remove(); document.body.classList.remove('demo-on'); return; }
    if (!b) {
      b = document.createElement('div'); b.id = 'demo-banner'; b.setAttribute('role', 'alert');
      b.innerHTML = '<span>🧪 MODE DÉMONSTRATION – rien n\'est enregistré dans la vraie base</span><button type="button" onclick="demoLeave()">Quitter la démonstration</button>';
      document.body.appendChild(b);
    }
    document.body.classList.add('demo-on');
  }
  window.demoEnter = function () {
    if (!isAdmin()) { try { toast('Le mode démonstration est réservé aux administrateurs.', 'error'); } catch (_) { /* toast indisponible */ } return; }
    installGuard(); state.active = true; banner();
    if (typeof go === 'function') go('quart');
  };
  window.demoLeave = function () {
    state.active = false; banner(); removeGuard();
    if (typeof go === 'function') go('dash');
  };
  // Sécurité : plus d'utilisateur connecté (déconnexion, session expirée) = fin de la démonstration.
  setInterval(() => { if (state.active && (typeof ME === 'undefined' || !ME || typeof TK === 'undefined' || !TK)) { state.active = false; banner(); removeGuard(); } }, 2000);

  /* ===================== Aide : manuel, chapitres et boutons « ? » ===================== */
  /* Pagination du manuel v8 (compte client, 80 pages) — à mettre à jour si le PDF change. */
  const CHAPTERS = [
    ['Premiers pas : installer, accéder et se connecter', 6], ['Découvrir l\'écran et ses boutons', 9], ['Le tableau de bord et ses indicateurs', 11], ['Le quart de service : ouvrir et clôturer', 13], ['Les ventes : carburant et produits', 17],
    ['Pompes et compteurs', 20], ['Produits et stocks', 22], ['Fournisseurs et bons de commande', 24], ['Clients, crédit et facturation', 26], ['Caisse, dépenses, Mobile Money et liquidités', 28],
    ['Employés, ressources humaines et paie', 31], ['Alertes et notifications', 33], ['Rapports, exports et fin de journée', 35], ['Agrégats et marges : le Rapport client & marges', 37],
    ['La calculatrice', 40], ['La carte des stations et la géolocalisation', 42], ['Le logo et l\'identité de la station', 45], ['La clé d\'accès : comment l\'utiliser', 46],
    ['La signature personnalisée', 48], ['Les couleurs du menu et de l\'en-tête', 50], ['Abonnement et licence', 52], ['Utiliser Manager Pro sur téléphone', 54], ['L\'aide intégrée et le mode démo', 56],
    ['Routine quotidienne et bonnes pratiques', 57], ['Problèmes fréquents et solutions', 58], ['Glossaire', 59],
    ['Nouveautés v8 : vue d\'ensemble', 62], ['Design Pro et formulaires', 63], ['Quart partagé : employé, pompes, écarts', 67], ['Vendre : nouveaux écrans', 68], ['Travailler hors ligne', 70], ['Cuves et jaugeage', 71], ['Cartes flotte', 73], ['Rapprochement Mobile Money ligne à ligne', 74], ['Avoirs clients et fournisseurs', 76], ['Fiscalité, sécurité, profil', 77], ['Mises à jour et dépannage', 79]
  ];
  const HELP = { quart: 13, clot: 15, ventes: 17, pompes: 20, prod: 22, stock: 22, four: 24, cli: 26, caisse: 28, mmcomm: 29, emp: 31, alert: 33, alertcfg: 33, notifrules: 33, rapports: 35, eod: 36, profit: 37, stations: 43, carte: 44, onboard: 7, aide: 56, teamroles: 5, roles: 5, dash: 11, cuves: 71, flotte: 73, treso: 74, offlineq: 70, fiscalhub: 77, moi: 77 };
  const manualUrl = page => MANUAL + (page ? '#page=' + page : '');
  window.openManual = page => window.open(manualUrl(page), '_blank', 'noopener');

  function helpButton(k) {
    const ttl = document.getElementById('ttl'); if (!ttl) return;
    let b = document.getElementById('help-btn');
    const page = HELP[k];
    if (!page) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'help-btn'; b.className = 'b2 icon-btn help-btn';
      b.textContent = '?'; b.setAttribute('aria-label', 'Aide : ouvrir le chapitre correspondant du manuel');
      ttl.after(b);
    }
    b.hidden = false; b.dataset.page = String(page);
    b.title = 'Aide : chapitre correspondant du manuel (page ' + page + ')';
    b.onclick = () => openManual(page);
  }
  if (typeof window.go === 'function') {
    const prevGo = window.go;
    window.go = async function (k, a) { const r = await prevGo.call(this, k, a); try { helpButton(k); } catch (_) { /* aide facultative */ } return r; };
  }
  // « ? » dans les fenêtres difficiles (ouverture de quart, vente de carburant, correction d'index, commande)
  const MODAL_HELP = [[/Ouverture de quart/i, 14], [/Vente de carburant/i, 18], [/Corriger index/i, 20], [/Nouvelle commande|Commande fournisseur|Achat/i, 24]];
  function decorateModal() {
    const m = document.getElementById('m'); if (!m || m.querySelector('.help-q')) return;
    const h = m.querySelector('h3, h2'); if (!h) return;
    const hit = MODAL_HELP.find(([re]) => re.test(h.textContent || '')); if (!hit) return;
    const q = document.createElement('button'); q.type = 'button'; q.className = 'b2 help-q'; q.textContent = '?'; q.title = 'Aide : voir le chapitre du manuel';
    q.onclick = () => openManual(hit[1]); h.appendChild(q);
  }
  (function watchModal() {
    const m = document.getElementById('m'); if (!m) return setTimeout(watchModal, 500);
    new MutationObserver(() => decorateModal()).observe(m, { childList: true, subtree: true });
  })();

  /* ===================== Page « Manuel d'utilisation & aide » (menu Mon profil & aide) ===================== */
  async function vAide() {
    const rows = CHAPTERS.map(([t, pg]) => `<tr><td>${esc(t)}</td><td>page ${pg}</td><td><button class="b2" onclick="openManual(${pg})">Ouvrir</button></td></tr>`).join('');
    const demoCard = isAdmin() ? `<div class="card" style="text-align:left;margin-top:14px">
        <h3 style="margin-top:0">🧪 Mode démonstration</h3>
        <p style="color:var(--m);font-size:13px">Pour former un nouvel employé <b>sans toucher aux vraies données</b> : une station fictive (« Badialan 3 ») avec pompes, produits, clients, fournisseurs et employés d'exemple.
        Un bandeau orange reste affiché en haut de l'écran. <b>Rien n'est lu ni enregistré dans la vraie base</b> ; recharger la page quitte la démonstration.</p>
        <button onclick="demoEnter()">Entrer en mode démonstration</button>
      </div>` : '';
    return `<h2 style="margin-top:0">Manuel d'utilisation & aide</h2>
      <div class="card" style="text-align:left">
        <p style="margin-top:0">Le guide complet de Manager Pro, en français simple, avec des images de l'écran.</p>
        <a class="btn" href="${MANUAL}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 16px;border-radius:10px;background:var(--p);color:var(--on-p);text-decoration:none;font-weight:600">📘 Ouvrir le manuel d'utilisation (PDF)</a>
        <p style="color:var(--m);font-size:13px">Astuce : le bouton « ? » en haut de certaines pages (Quarts, Clôture, Ventes, Pompes, Achats…) ouvre directement le bon chapitre.</p>
      </div>
      <h3 style="margin:18px 0 8px">Aller directement à un chapitre</h3>
      <div class="tw"><table><thead><tr><th>Chapitre</th><th>Page</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${demoCard}`;
  }
  Object.assign(V, { aide: ['Manuel & aide', '*'] });
  Object.assign(VM, { aide: vAide });
  if (typeof NAV_ICONS !== 'undefined') NAV_ICONS.aide = '📘';

  window.SMP_DEMO = { handle, installGuard, removeGuard, state, dataset, isAdmin };   // utilisé par app.js (api) et par les tests
})();
