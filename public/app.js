'use strict';
// Client web de Manager PRO : toutes les données et tous les calculs passent par l'API.
let TK = null, ME = null, SID = null, CUR = 'FCFA', cur = 'quart', arg, P = 'today', CA, CB, SH, PR = [], PSC = [], PT;
// Jetons de génération : empêchent une réponse d'une ancienne station/vue de repeupler l'écran après un changement.
let STATION_EPOCH = 0, NAV_EPOCH = 0;
try { TK = localStorage.getItem('smp-tk'); SID = localStorage.getItem('smp-sid'); } catch (e) {}
const keep = () => { try { TK ? localStorage.setItem('smp-tk', TK) : localStorage.removeItem('smp-tk'); SID ? localStorage.setItem('smp-sid', SID) : localStorage.removeItem('smp-sid'); } catch (e) {} };
/** Nettoyage strict de la session navigateur.
 *  Corrige le bug de confusion de rôles lors de connexions successives (A se déconnecte → B se connecte)
 *  en effaçant le jeton, la station et tout état volatil, tout en conservant les thèmes personnels (clés smp-theme-user-*). */
const clearSession = () => {
  try {
    localStorage.removeItem('smp-tk');
    localStorage.removeItem('smp-sid');
    // Nettoyer d'éventuelles clés de cache volatiles (ne pas toucher aux thèmes par utilisateur)
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('smp-') && !k.startsWith('smp-theme-user-')) toRemove.push(k);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
};
/** Remise à zéro complète de l'état mémoire (obligatoire avant chaque login / après logout). */
const resetInMemoryState = () => {
  TK = null; ME = null; SID = null; STATION_EPOCH++; NAV_EPOCH++; CUR = 'FCFA'; cur = 'quart'; arg = undefined; P = 'today';
  CA = undefined; CB = undefined; SH = undefined; PR = []; PSC = []; PT = undefined;
  try { if (typeof NAV_HISTORY !== 'undefined') NAV_HISTORY.length = 0; } catch (_) {}
  try { if (typeof updateBackBtn === 'function') updateBackBtn(); } catch (_) {}
};
const accessError = e => !!e && (e.status === 401 || e.status === 403 || /permission|accès.*refus|non authent|interdit|non inclus|licence.*expir/i.test(String(e.message || '')));
const defaultView = () => {
  if (ME?.is_global && typeof VM.admin === 'function') return 'admin';
  return Object.keys(V || {}).find(k => canView(k) && typeof VM[k] === 'function') || 'dash';
};
const $ = s => document.querySelector(s), esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])), jsArg = s => esc(JSON.stringify(String(s ?? '')).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')), fl = n => Math.round((+n || 0) * 100) / 100;
const loc = () => (typeof I18N !== 'undefined' ? I18N.locale() : 'fr-FR');
/* A5 — affichage uniforme à la française (jamais de modification des valeurs stockées) */
const nfr = (n, max) => new Intl.NumberFormat(loc(), { maximumFractionDigits: max }).format(+n || 0).replace(/^-/, '−');
const f = n => nfr(fl(n), 2) + ' ' + CUR;                                   // montant : « 2 845 000 FCFA », « −2 500 FCFA »
const fq = (n, unit = 'L') => nfr(n, 3) + (unit ? ' ' + unit : '');          // quantité : « 1 840,5 L »
const dt = t => t ? new Date(t).toLocaleString(loc(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';   // « 21/10/2026 16:53 »
const dts = t => t ? new Date(t).toLocaleString(loc(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';   // secondes : journal d'audit seulement
const STATUS_FR = { cloture: 'Clôturé', ouvert: 'Ouvert', annule: 'Annulé', facture: 'Facturé', recu: 'Reçu', commande: 'Commandé', active: 'Actif', inactive: 'Inactif' };
const stFr = s => STATUS_FR[String(s ?? '').trim().toLowerCase()] || (s ?? '');
const errMsg = e => e.message + (Array.isArray(e.details) && e.details.length ? ' : ' + e.details.map(d => typeof d == 'string' ? d : d.description).join(' ; ') : '');
/* ---------- Identité de l'application : nom, slogan, logo (configuration centralisée, modifiable par l'administrateur) ----------
   Un seul point de vérité : BRAND, alimenté par GET /api/branding. Aucun nom n'est codé dans les pages : tout élément portant
   data-brand="name|tagline|mark" est mis à jour automatiquement (connexion, navigation, titre du navigateur, favicon…). */
const BRAND_DEFAULT = {
  name: 'Station Manager PRO', tagline: 'Gestion intelligente de votre station-service',
  has_logo: false, has_favicon: false, v: 0,
  login_bg_color: '#0a6b5c', has_login_bg_image: false,
  ad_title: 'PANNEAU PUBLICITAIRE', ad_text: '', ad_enabled: true
};
let BRAND = { ...BRAND_DEFAULT };
const brandName = () => (BRAND.name && BRAND.name.trim()) || BRAND_DEFAULT.name;
const brandInitial = () => (brandName().trim().charAt(0) || 'S').toUpperCase();
const brandMarkInner = () => BRAND.has_logo ? `<img src="/api/branding/logo?v=${BRAND.v}" alt="">` : '<img src="/icons/icon-192.png" alt="Station Manager PRO">';   // sans logo téléversé : logo Manager Pro par défaut
/** Bandeau publicitaire dashboard (configurable SuperAdmin). */
window.adPanelHtml = function () {
  if (!BRAND.ad_enabled) return '';
  const title = BRAND.ad_title || 'PANNEAU PUBLICITAIRE';
  const text = BRAND.ad_text || '';
  if (!title && !text) return '';
  return `<div class="ad-panel" role="complementary" aria-label="Panneau publicitaire">
    <div class="ad-panel-inner"><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}</div>
  </div>`;
};
function applyBrand() {
  // Identité plateforme (Manager Pro) : login, pages publiques, SuperAdmin.
  // Comptes clients : les éléments data-brand-scope="tenant" ne sont PAS écrasés par le logo / nom du site.
  const isClientSession = !!(typeof ME !== 'undefined' && ME && !ME.is_global);
  const platformOnly = (e) => !isClientSession || e.getAttribute('data-brand-scope') !== 'tenant';
  document.title = isClientSession
    ? ((typeof AP !== 'undefined' && AP && AP.station && (AP.station.name || AP.station.client_name)) || brandName())
    : brandName();
  document.querySelectorAll('[data-brand="name"]').forEach(e => {
    if (!platformOnly(e)) return;
    e.textContent = brandName();
    if (typeof fitNavName === 'function') fitNavName();
  });
  document.querySelectorAll('[data-brand="tagline"]').forEach(e => {
    if (!platformOnly(e)) return;
    e.textContent = BRAND.tagline || ''; e.hidden = !BRAND.tagline;
  });
  document.querySelectorAll('[data-brand="mark"]').forEach(e => {
    if (!platformOnly(e)) return;
    e.innerHTML = brandMarkInner(); e.classList.add('has-img');
  });
  const d = document.querySelector('meta[name="description"]'); if (d) d.content = brandName() + (BRAND.tagline ? ' – ' + BRAND.tagline : '');
  const ic = document.querySelector('link[rel="icon"]');
  const fill = BRAND.login_bg_color || '#0d7a6b';
  if (ic) ic.href = BRAND.has_favicon ? '/api/branding/favicon?v=' + BRAND.v
    : "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='20' fill='${fill}'/><text x='50' y='68' font-size='52' text-anchor='middle' fill='white' font-family='system-ui' font-weight='700'>${brandInitial()}</text></svg>`);
  // Panneau gauche connexion : couleur et/ou image de fond
  const lb = document.querySelector('.login-brand');
  if (lb) {
    const raw = String(BRAND.login_bg_color || '').toLowerCase();
    const custom = /^#[0-9a-f]{6}$/.test(raw) && raw !== '#0a6b5c' && raw !== '#0d7a6b';   // anciennes couleurs par défaut = nouveau design
    const color = custom ? raw : '#0c1f45';
    const lum = h => { const n = parseInt(h.slice(1, 7), 16), g = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * g(n >> 16 & 255) + .7152 * g(n >> 8 & 255) + .0722 * g(n & 255); };
    const second = custom ? color + 'cc' : '#123a7a';
    if (BRAND.has_login_bg_image) {
      lb.style.background = `linear-gradient(160deg, ${color}ee, ${second}99), url('/api/branding/login-bg?v=${BRAND.v}') center/cover no-repeat`;
      lb.style.color = '#fff';
    } else {
      lb.style.background = `linear-gradient(160deg, ${color}, ${second})`;
      lb.style.color = custom && lum(color) > .45 ? '#0f172a' : '#fff';   // texte toujours lisible sur la couleur choisie
    }
  }
}
async function loadBrand() {
  try { const r = await fetch('/api/branding', { cache: 'no-store' }); if (r.ok) BRAND = { ...BRAND_DEFAULT, ...(await r.json()) }; } catch (e) { /* hors ligne */ }
  applyBrand();
}
/* ---------- UI moderne : toast, skeleton, thème, focus ---------- */
let _toastTimer = null;
const toast = (m, type = '') => {
  const t = $('#toast');
  if (!t) return;
  clearTimeout(_toastTimer);
  t.textContent = m;
  t.className = type || '';
  t.classList.add('show');
  t.style.display = 'block';
  _toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => { t.style.display = 'none'; t.className = ''; }, 250);
  }, type === 'error' ? 6000 : 4000);
};
// Enveloppe d'action : affiche l'erreur dans un toast au lieu de la laisser remonter
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(errMsg(e)); } };
const modal = h => { $('#m').style.display = 'flex'; $('#m').innerHTML = '<div>' + h + '</div>'; };
const closeM = () => { $('#m').style.display = 'none'; };
const ask = (m, cb) => {
  modal(`<p>${m}</p><div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="yes">Confirmer</button></div>`);
  $('#yes').onclick = async () => { closeM(); try { await cb(); } catch (e) { toast(errMsg(e), 'error'); } };
};
const skeleton = (type = 'page') => {
  if (type === 'cards') return `<div class="cards">${[1,2,3,4].map(() => '<div class="card skeleton sk-card"></div>').join('')}</div>`;
  if (type === 'table') return '<div class="tw skeleton sk-table"></div>';
  return skeleton('cards') + skeleton('table');
};

try { if (typeof I18N !== 'undefined') { document.documentElement.lang = I18N.getLang() === 'en' ? 'en' : 'fr'; const lb = document.getElementById('lang-toggle'); if (lb) lb.textContent = I18N.getLang() === 'fr' ? 'EN' : 'FR'; } } catch (e) {}
const theme = async () => {
  // Délègue à la bascule jour/nuit unifiée (bouton haut de page + menu profil)
  if (typeof window.toggleDayNight === 'function') return window.toggleDayNight();
  const d = document.documentElement;
  const next = d.dataset.theme === 'dark' ? 'light' : 'dark';
  const base = (typeof AP !== 'undefined' && AP.theme) || { primary: '#0a6b5c', secondary: '#647184' };
  const value = { mode: next, primary: base.primary || '#0a6b5c', secondary: base.secondary || '#647184' };
  if (typeof paint === 'function') paint(value); else d.dataset.theme = next;
  try { if (ME) localStorage.setItem('smp-theme-user-' + ME.id, JSON.stringify(value)); } catch (e) {}
  if (typeof window.savePersonalTheme === 'function') { try { await window.savePersonalTheme(value); } catch (e) { toast(errMsg(e), 'error'); } }
};
const toggleFocusMode = async () => {
  document.body.classList.toggle('focus-mode');
  const on = document.body.classList.contains('focus-mode');
  toast(on ? 'Mode Focus activé (écran simplifié)' : 'Mode Focus désactivé', on ? 'success' : '');
  if (on && typeof renderFocusQuickSale === 'function') {
    try {
      const html = await renderFocusQuickSale();
      const pg = document.getElementById('pg');
      if (pg) pg.innerHTML = html;
      const ttl = document.getElementById('ttl');
      if (ttl) ttl.textContent = 'Mode pompiste';
    } catch (e) { console.warn(e); }
  } else if (!on && typeof go === 'function') {
    go(cur || 'dash');
  }
};
const NAV_ICONS = {
  dash: '📊', quart: '⏱️', ventes: '🛒', prod: '📦', pompes: '⛽',
  cli: '👥', four: '🏭', achats: '🧾', vendeurs: '🏆', stations: '🏪',
  emp: '👤', caisse: '💰', alert: '🔔',
  audit: '📋', param: '⚙️'
};
const BOTTOM_KEYS = ['dash', 'quart', 'ventes', 'caisse', 'emp'];

async function api(m, p, b) {
  const requestSid = SID;
  const requestStationEpoch = STATION_EPOCH;
  const method = String(m || 'GET').toUpperCase();
  // A8 — Mode démonstration : données d'exemple locales, écritures simulées (voir ext-aide-demo.js). Aucun appel réseau pour les données.
  if (window.SMP_DEMO && window.SMP_DEMO.state.active) return window.SMP_DEMO.handle(method, p, b);
  const r = await fetch('/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(TK && { Authorization: 'Bearer ' + TK }), ...(requestSid && { 'X-Station-Id': requestSid }) }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => null);
  // Les lectures en cours pour l'ancienne station ne doivent jamais alimenter la nouvelle vue.
  if (method === 'GET' && requestStationEpoch !== STATION_EPOCH) {
    throw Object.assign(new Error('Lecture obsolète après changement de station'), { code: 'STALE_STATION_RESPONSE', stale: true });
  }
  if (r.status === 401 && TK && p !== '/auth/login') {
    resetInMemoryState();
    clearSession();
    showLogin();
    throw Object.assign(new Error('Session expirée : reconnectez-vous'), { status: 401 });
  }
  if (!r.ok) {
    if (r.status === 403 && j && j.code === 'LICENSE_EXPIRED' && typeof window.__onLicenseExpired === 'function') {
      try { window.__onLicenseExpired(j); } catch (_) {}
    }
    throw Object.assign(new Error((j && j.error) || 'Erreur ' + r.status), { details: j && j.details, status: r.status, code: j && j.code });
  }
  return j;
}
const G = p => api('GET', p), Po = (p, b) => api('POST', p, b), Pu = (p, b) => api('PUT', p, b);
const T = (h, r, oc) => `<div class="tw"><table><thead><tr>${h.map(x => `<th>${x}`).join('')}</tr></thead><tbody>${r.map((x, i) => `<tr ${oc && oc(i) ? `onclick="${oc(i)}"` : ''}>${x.map(y => `<td>${y}`).join('')}</tr>`).join('') || `<tr><td colspan="${h.length}">Aucune donnée</td></tr>`}</tbody></table></div>`;
const flt = i => { const q = i.value.toLowerCase(); document.querySelectorAll('#pg tbody tr').forEach(r => r.hidden = !r.textContent.toLowerCase().includes(q)); };
function form(t, fs, v, ok, extra = '') {
  let packBar = '';
  try {
    if (typeof authPacksExtraHtml === 'function' && /licence|contrat|client|autorisation/i.test(String(t))) {
      packBar = authPacksExtraHtml();
    }
  } catch (_) {}
  // Grouper visuellement les labels d'autorisations par préfixe
  const htmlFields = fs.map(([k, l, ty, o]) => {
    const lab = `<label data-fkey="${esc(k)}">${l}${ty == 's' ? `<select id="f_${k}" onchange="typeof updateAuthSummary==='function'&&updateAuthSummary()">${o.map(x => { const a = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(a[0])}" ${String(a[0]) == String(v[k]) ? 'selected' : ''}>${esc(a[1])}</option>`; }).join('')}</select>` : ty == 'textarea' ? `<textarea id="f_${k}" rows="8" style="width:100%;font-family:monospace;font-size:12px">${esc(v[k] ?? '')}</textarea>` : `<input id="f_${k}" type="${ty || 'text'}" step="any" value="${esc(v[k] ?? '')}">`}</label>`;
    return lab;
  }).join('');
  modal(`<h3>${t}</h3>${packBar}<div class="g" style="max-height:55vh;overflow:auto">${htmlFields}</div>${extra}<div class="r"><button class="b2" onclick="closeM()">Annuler</button><button id="ok">Enregistrer</button></div>`);
  try { if (typeof updateAuthSummary === 'function') setTimeout(updateAuthSummary, 50); } catch (_) {}
  $('#ok').onclick = async () => { const b = $('#ok'); b.disabled = true; try { const d = {}; for (const [k, , ty] of fs) { const x = $('#f_' + k).value; d[k] = ty == 'number' ? (parseFloat(x) || 0) : x; } await ok(d); } catch (e) { toast(errMsg(e)); } b.disabled = false; };
}
const V = { dash: ['Tableau de bord', 'report.view|finance.view'], quart: ['Quarts de service', 'shift.open|shift.close|report.view|shift.report.own|sale.create'], ventes: ['Ventes', 'sale.create'], prod: ['Produits et stock', 'stock.adjust|price.edit|sale.create|report.view'], pompes: ['Pompes et compteurs', 'settings.edit|shift.open'], cli: ['Clients', 'customer.view|sale.create'], four: ['Fournisseurs et achats', 'supplier.view|purchase.manage|purchase.pay|stock.adjust'], achats: ['Achats', 'supplier.view|purchase.manage|purchase.pay|stock.adjust'], vendeurs: ['Vendeurs & commissions', 'commission.own|commission.manage|report.view|hr.view|settings.edit|sale.create'], stations: ['Mes stations', 'settings.edit|user.manage|report.view'], emp: ['Employés', 'settings.edit|shift.open'], caisse: ['Caisse et dépenses', 'cash.manage|finance.view|expense.create'], alert: ['Alertes', 'settings.edit|user.manage'], audit: ["Journal d'audit", 'audit.view'], param: ['Utilisateurs', 'user.manage'] };
const featTruthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
const featOff = (v) => v === false || v === 'false' || v === 0 || v === '0';
const contractAllowsView = k => {
  const c = ME?.contract;
  if (!c || c.unrestricted) return true;
  if (c.suspended) return false;
  const f = c.features || {};
  const mods = f.modules || {};
  const modOn = (key, defaultOn = true) => {
    if (!(key in mods) && !(('can_' + key) in f)) return defaultOn;
    if (key in mods) return !featOff(mods[key]);
    return true;
  };
  const flagOn = (key, defaultOn = true) => {
    if (!(key in f)) return defaultOn;
    return !featOff(f[key]);
  };
  // Finance / caisse / rapprochement
  if (['fin', 'finevents', 'reconcile', 'mmcomm', 'caisse'].includes(k)) {
    return flagOn('can_access_finance', true) && modOn('finance', true);
  }
  // RH
  if (['rhdash','rh','rhalerts','rhr','audrh','rhatt','rhleaves','rhot','rhsched','rhcontracts','rhdocs','rhctl','rhperiods','declarations','act','rhsettings','empf'].includes(k)) {
    return featTruthy(f.can_access_hr) || featTruthy(mods.hr) || flagOn('can_access_hr', true);
  }
  // Rapports / exports
  if (['exports', 'archive', 'auditx', 'rapports', 'direction', 'eod', 'profit'].includes(k)) {
    if (k === 'direction') return modOn('direction', true) && flagOn('can_view_reports', true);
    if (k === 'eod') return modOn('eod', true) && flagOn('can_view_reports', true);
    return flagOn('can_view_reports', true);
  }
  // Messagerie (toujours visible : guide si OFF)
  if (k === 'msg') return true;
  if (k === 'avenir') return flagOn('can_view_coming_soon', true);
  // Facturation
  if (k === 'factures') return flagOn('can_use_billing', true) && modOn('billing', true);
  // Stocks / produits / achats / fournisseurs
  if (k === 'stock' || k === 'prod') return modOn('stock', true);
  if (k === 'bcommande') return modOn('suppliers', true) && modOn('purchases', true);
  if (k === 'four' || k === 'achats') return modOn('suppliers', true) && modOn('purchases', true);
  if (k === 'cli') return modOn('customers', true);
  // Ventes / quarts / pompes / employés / vendeurs & commissions
  if (k === 'ventes') return modOn('sales', true);
  if (k === 'vendeurs') {
    // Module commissions + (équipe OU permission commission.own) + portail contrat si own
    const modsOk = modOn('sales', true) && modOn('seller_commissions', true);
    if (!modsOk) return false;
    if (typeof can === 'function' && (can('commission.manage') || can('report.view') || can('hr.view') || can('settings.edit') || can('hr.manage') || can('hr.payroll'))) return true;
    // Employé : portail commissions + permission commission.own
    const portalOn = f.employee_portal_commissions !== false && f.employee_portal_commissions !== 'false';
    return portalOn && typeof can === 'function' && can('commission.own');
  }
  if (k === 'quart' || k === 'clot' || k === 'rapq') return modOn('shifts', true);
  if (k === 'pompes') return modOn('pumps', true);
  if (k === 'emp') return modOn('employees', true);
  // Imports
  if (k === 'imports') return modOn('imports', true);
  // Multi-stations / Mes stations
  if (k === 'stations') return modOn('multistation', true);
  // Alertes
  if (k === 'alert' || k === 'alertcfg') return flagOn('can_use_auto_alerts', true) && modOn('auto_alerts', true);
  // Paramètres / personnalisation
  if (k === 'param' || k === 'dashcfg') return flagOn('can_access_settings', true);
  // Comptabilité OHADA (module contractuel, désactivé par défaut)
  if (String(k).startsWith('compta')) {
    const accSubOn = Object.entries(mods).some(([name, value]) => name.startsWith('accounting_') && featTruthy(value));
    return featTruthy(f.can_access_accounting) || featTruthy(mods.accounting) || accSubOn;
  }
  // Fiscalité
  if (String(k).startsWith('fiscal')) {
    // Tolérer les contrats non encore normalisés côté client : un sous-module fiscal
    // explicitement accordé par le Superadmin implique l'accès au menu Fiscalité.
    const fiscalSubmoduleOn = Object.entries(mods).some(([name, value]) =>
      name.startsWith('fiscal_') && featTruthy(value)
    );
    return featTruthy(f.can_access_fiscal) || featTruthy(mods.fiscal) || fiscalSubmoduleOn;
  }
  return true;
};
const can = p => {
  if (p == '*') return true;
  return p.split('|').some(x => {
    if (x === 'fiscal.access') {
      const f = (ME && ME.contract && ME.contract.features) || {};
      const truthy = v => v === true || v === 'true' || v === 1 || v === '1';
      const modules = f.modules || {};
      const submoduleOn = Object.entries(modules).some(([name, value]) => name.startsWith('fiscal_') && truthy(value));
      const contractAllowed = !!(ME && ME.contract && ME.contract.unrestricted)
        || truthy(f.can_access_fiscal) || truthy(modules.fiscal) || submoduleOn;
      return !!(ME && Array.isArray(ME.permissions) && ME.permissions.includes('fiscal.access')) && contractAllowed;
    }
    return ME && ME.permissions && ME.permissions.includes(x);
  });
};
/* Périmètre strict des rôles :
   - SuperAdmin (is_global) : UNIQUEMENT les vues plateforme (admin, clients, packs, roles, pfin, dashcfg…).
   - Compte client / gérant : JAMAIS les vues plateforme (« Contrôle administrateur », finance plateforme, etc.).
   Le serveur refuse de toute façon les routes métier au SuperAdmin (403). Le masquage UI est un confort + défense en profondeur. */
// Pas de vues Fiscalité opérationnelles ni pilotage multi-clients : Superadmin = licences + autorisations uniquement.
const SUPERADMIN_VIEWS = new Set(['admin', 'clients', 'packs', 'roles', 'pfin', 'msg']);
const GLOBAL_ONLY_VIEWS = SUPERADMIN_VIEWS;
// Vues partagées : accessibles au Super Admin (support) ET aux comptes clients (messagerie interne, isolée par client côté serveur).
const SHARED_VIEWS = new Set(['msg']);
// On n'affiche que les actions réellement permises (pas de bouton qui finit en refus) :
// un administrateur local n'est géré que par un autre administrateur local, et on ne change pas son propre rôle.
const isSelfUser = u => !!ME && Number(u.id) === Number(ME.id);
const canTouchUser = u => !!ME && (ME.is_global || u.role !== 'ADMIN' || ME.role === 'ADMIN');
const canView = k => {
  const v = V[k];
  if (!v) return false;
  // « Abonnement » : réservé à l'administrateur local du compte client (le Superadmin garde sa configuration des paiements).
  if (k === 'subscription' && !ME?.is_global) return ME?.role === 'ADMIN';
  if (ME?.is_global) {
    // SuperAdmin : uniquement les vues plateforme
    return SUPERADMIN_VIEWS.has(k) && can(v[1]);
  }
  // Compte client : jamais les vues réservées à la plateforme
  if (GLOBAL_ONLY_VIEWS.has(k) && !SHARED_VIEWS.has(k)) return false;
  return can(v[1]) && contractAllowsView(k);
};
/* ---------- tableau de bord ---------- */
function range(p) { const n = new Date(), iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10), t = new Date(n.getFullYear(), n.getMonth(), n.getDate()); let a = t, b = t;
  if (p == 'yday') a = b = new Date(t - 864e5); else if (p == 'd7') a = new Date(t - 6 * 864e5); else if (p == 'd30') a = new Date(t - 29 * 864e5); else if (p == 'lastmonth') { a = new Date(n.getFullYear(), n.getMonth() - 1, 1); b = new Date(n.getFullYear(), n.getMonth(), 0); } else if (p == 'week') a = new Date(t - ((t.getDay() + 6) % 7) * 864e5); else if (p == 'month') a = new Date(n.getFullYear(), n.getMonth(), 1);
  else if (p == 'quarter') a = new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3, 1); else if (p == 'year') a = new Date(n.getFullYear(), 0, 1); else if (p == 'custom') return [CA || iso(t), CB || iso(t)];
  return [iso(a), iso(b)]; }
const hb = (t, e) => { const mx = Math.max(1, ...e.map(x => x[1])); return `<div class="card"><b>${t}</b>${e.map(x => `<div style="margin-top:8px"><small>${esc(x[0])} : ${x[2] || f(x[1])}</small><div style="height:8px;background:var(--bd);border-radius:4px"><i style="display:block;height:8px;width:${Math.max(0, x[1]) / mx * 100}%;background:var(--p);border-radius:4px"></i></div></div>`).join('') || '<p style="color:var(--m)">Aucune donnée</p>'}</div>`; };
async function vDash() {
  const [a, b] = range(P), [d, dl, pilot] = await Promise.all([G(`/dashboard?from=${a}&to=${b}`), G('/dashboard/daily?days=7'), G(`/dashboard/pilotage?from=${a}&to=${b}`).catch(() => null)]), mx = Math.max(1, ...dl.map(x => x.revenue)), C = (l, v) => `<div class="card"><small>${l}</small><b>${v}</b></div>`;
  const chartId = 'dashChart' + Date.now();
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const ctx = document.getElementById(chartId);
    if (!ctx) return;
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dl.map(x => x.day.slice(8) + '/' + x.day.slice(5, 7)),
        datasets: [{
          label: "Chiffre d'affaires",
          data: dl.map(x => x.revenue),
          backgroundColor: 'rgba(13, 122, 107, 0.75)',
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: v => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v) } },
          x: { grid: { display: false } }
        }
      }
    });
  }, 50);
  return `<div class="bar"><select onchange="P=this.value;go('dash')">${[['today', "Aujourd'hui"], ['yday', 'Hier'], ['week', 'Semaine'], ['month', 'Mois'], ['quarter', 'Trimestre'], ['year', 'Année'], ['custom', 'Période personnalisée']].map(x => `<option value="${x[0]}" ${x[0] == P ? 'selected' : ''}>${x[1]}</option>`).join('')}</select>${P == 'custom' ? `<input type="date" value="${a}" onchange="CA=this.value;go('dash')"><input type="date" value="${b}" onchange="CB=this.value;go('dash')">` : ''}</div>
<div class="cards">${C("Chiffre d'affaires", f(d.revenue))}${C('Ventes carburant', f(d.fuel_revenue))}${C('Ventes produits', f(d.product_revenue))}${C('Dépenses', f(d.expenses))}${C("CA moins dépenses", f(d.revenue - d.expenses))}${d.gross_margin != null ? C('Marge brute' + (d.margin_reliable === false ? ' (partielle)' : ''), f(d.gross_margin)) + C('Taux de marge brute', d.margin_pct_label) + C('Résultat de gestion', f(d.operating_result)) : ''}${C('Caisse', f(d.cash_balance))}${C('Quart ouvert', d.open_shift ? 'N° ' + d.open_shift.number + ' (' + esc(d.open_shift.kind) + ')' : 'Aucun')}${d.receivables != null ? C('Créances clients', f(d.receivables)) : ''}${d.payables != null ? C('Dettes fournisseurs', f(d.payables)) : ''}${d.connected_users != null ? C('Utilisateurs connectés', d.connected_users) : ''}</div>
${pilot ? `<section class="card" style="margin:14px 0"><h3 style="margin-top:0">Centre de pilotage</h3><p style="color:var(--m)">Comparaison avec la période précédente (${esc(pilot.period.previous_from)} au ${esc(pilot.period.previous_to)}). Les variations sont affichées uniquement si la période précédente comporte une valeur de référence.</p><div class="cards">${C('Variation du chiffre d’affaires', pilot.kpis.revenue.change_pct == null ? 'Référence indisponible' : (pilot.kpis.revenue.change_pct > 0 ? '+' : '') + pilot.kpis.revenue.change_pct + '%')}${C('Variation des dépenses', pilot.kpis.expenses.change_pct == null ? 'Référence indisponible' : (pilot.kpis.expenses.change_pct > 0 ? '+' : '') + pilot.kpis.expenses.change_pct + '%')}${C('Litres de carburant', fl(pilot.kpis.fuel_liters))}${C('Ventes produits validées', pilot.kpis.product_sales_count)}${C('Écarts de caisse à traiter', pilot.kpis.cash_gaps)}${C('Alertes RH ouvertes', pilot.kpis.hr_alerts)}</div><h4>Actions prioritaires</h4>${pilot.actions.length ? pilot.actions.map(x => `<div class="${x.level === 'critical' ? 'warn' : 'card'}" style="margin:8px 0"><b>${esc(x.label)}</b><p>${esc(x.advice)}</p></div>`).join('') : '<p>Aucune action prioritaire détectée par les contrôles disponibles.</p>'}<p style="font-size:12px;color:var(--m)">${esc(pilot.note)}</p></section>` : ''}<div class="chart-wrap"><b style="display:block;margin-bottom:10px">Chiffre d'affaires sur 7 jours</b><canvas id="${chartId}" height="220"></canvas></div>
<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${hb('Carburant par produit', d.fuel_by_product.map(x => [x.name, x.amount, fl(x.liters) + ' L / ' + f(x.amount)]))}${hb('Encaissements par mode', d.payments_by_method.map(x => [x.method, x.amount]))}${hb('Stock sous le seuil', d.low_stock.map(x => [x.name, x.quantity, fl(x.quantity) + ' (seuil ' + x.min_stock + ')']))}</div>`;
}
/* ---------- quarts ---------- */
async function vQuart() {
  __shiftSalesOpen = null;
  const rq = k => (window.RT && RT.query(k)) ? RT.query(k) : '';   // période appliquée (filtre + export PDF)
  const [cu, ls] = await Promise.all([G('/shifts/current'), G('/shifts' + (rq('quart') ? '?' + rq('quart') : ''))]); SH = cu; window.__rtShifts = ls; let h = '';
  if (cu) {
    const _cuPast = (() => {
      const ymd = String(cu.opened_at || '').slice(0, 10);
      const today = (typeof dayNow === 'function' ? dayNow() : new Date().toISOString().slice(0, 10));
      return ymd && ymd < today;
    })();
    h += `<div class="card" style="margin-bottom:12px"><b>Quart N° ${cu.number} : OUVERT</b> <span class="tag" id="shift-timer" data-start="${esc(cu.opened_at)}" title="Temps écoulé depuis l'ouverture du quart">00:00:00</span>${_cuPast ? ' <span class="tag x" title="Quart saisi avec une date antérieure">passé</span>' : ''}<p>${esc(cu.kind)}, début ${dt(cu.opened_at)}, caisse initiale ${f(cu.opening_cash)}<br>Ventes de produits : ${cu.sales.n} pour ${f(cu.sales.total)}<br>Carburant déclaré : ${fq(cu.fuel_declared.liters)} pour ${f(cu.fuel_declared.total)}<br>Crédit : ${f((cu.credit || {}).total || 0)}<br>Dépense : ${f((cu.expenses || {}).total || 0)}${(cu.expenses || {}).n ? ' (' + cu.expenses.n + ')' : ''}<br>Chef de quart : ${esc(cu.chief || '—')}</p>${cu.anomalies.map(a => `<span class="tag x">${esc(a.description)}</span> `).join('')}<div class="r">${can('sale.create') ? `<button class="b2" onclick="addS()">＋ Vente</button>` : ''}${can('expense.create') ? `<button class="b2" onclick="addX()">Dépense</button>` : ''}${can('sale.create') ? `<button class="b2" onclick="anom(${cu.id})">Ajouter une note / anomalie</button>` : ''}${can('shift.close') ? `<button onclick="go('clot')">Clôturer le quart</button>` : ''}</div></div>`;
  }
  else if (can('shift.open')) h += `<div class="bar"><button onclick="openQ()">Ouvrir un quart</button></div>`;
  if (cu) setTimeout(startShiftTimer, 0);
  const todayYmd = (typeof dayNow === 'function' ? dayNow() : new Date().toISOString().slice(0, 10));
  const isPastShift = (s) => {
    if (!s || !s.opened_at) return false;
    const ymd = String(s.opened_at).slice(0, 10);
    return !!(ymd && ymd < todayYmd);
  };
  return (window.RT ? RT.bar('quart') : '') + h + T(['N°', 'Type', 'Début', 'Fin', 'Statut', 'Écart caisse', ''], ls.map(s => [
    s.number,
    esc(s.kind) + (isPastShift(s) ? ' <span class="tag x" title="Quart saisi avec une date antérieure">passé</span>' : ''),
    dt(s.opened_at),
    dt(s.closed_at),
    `<span class="tag ${s.status == 'ouvert' ? '' : 'x'}">${stFr(s.status)}</span>`,
    s.cash_gap == null || s.cash_gap === '' ? '' : f(s.cash_gap),
    can('shift.report.own|report.view|shift.open|shift.close')
      ? `<button class="b2" type="button" onclick="event.preventDefault();event.stopPropagation();window.showShiftFull(${Number(s.id)})">Voir</button> <button class="bg" type="button" data-shift-sales-btn="${Number(s.id)}" onclick="event.preventDefault();event.stopPropagation();window.showShiftSales(${Number(s.id)})">Afficher</button>`
      : ''
  ]), null) + '<div id="shift-sales-panel" style="margin-top:18px"></div>';
}

/* Ventes rattachées à un quart : bouton « Afficher » (affichage en bas de la liste, second clic = masquer) */
let __shiftSalesOpen = null;
window.showShiftSales = async function (id) {
  id = Number(id);
  const box = document.getElementById('shift-sales-panel');
  if (!box || !id) return;
  const mark = on => document.querySelectorAll('[data-shift-sales-btn]').forEach(b => {
    const me = Number(b.dataset.shiftSalesBtn) === id && on;
    b.textContent = me ? 'Masquer' : 'Afficher';
  });
  if (__shiftSalesOpen === id) { box.innerHTML = ''; __shiftSalesOpen = null; mark(false); return; }
  box.innerHTML = '<p class="muted">Chargement des ventes du quart…</p>';
  try {
    const d = await G('/shifts/' + id + '/sales');
    if (!document.getElementById('shift-sales-panel')) return;
    const sh = d.shift || {}, sm = d.summary || {}, rows = d.sales || [];
    const kindFr = k => k === 'carburant' ? 'Carburant' : 'Produits';
    const pay = m => String(m || '').split(', ').filter(Boolean).map(x => ({ especes: 'Espèces', carte: 'Carte', mobile_money: 'Mobile money', credit: 'Crédit', autre: 'Autre' }[x] || x)).join(', ');
    box.innerHTML = `<h3 style="margin:0 0 8px">Ventes du quart N° ${esc(sh.number)} <span class="tag x">${esc(sh.kind || '')}</span></h3>
      <div class="cards" style="margin-bottom:10px">
        <div class="card"><small>Total des ventes</small><b>${f(sm.total)}</b></div>
        <div class="card"><small>Carburant</small><b>${f(sm.fuel_total)}</b></div>
        <div class="card"><small>Produits</small><b>${f(sm.products_total)}</b></div>
        <div class="card"><small>Nombre de ventes</small><b>${sm.count || 0}${sm.cancelled ? ` <small>(+ ${sm.cancelled} annulée${sm.cancelled > 1 ? 's' : ''})</small>` : ''}</b></div>
      </div>` + T(['N°', 'Facture', 'Date', 'Type', 'Détail', 'Client', 'Vendeur', 'Paiement', 'Total', 'Statut'], rows.map(x => [
      x.id, esc(x.invoice_no || ''), dt(x.sold_at), kindFr(x.kind), esc(x.items || ''), esc(x.customer || ''), esc(x.employee || ''),
      esc(pay(x.methods)), f(x.total), `<span class="tag ${x.status == 'valide' ? '' : 'x'}">${stFr(x.status)}</span>`
    ]), null);
    __shiftSalesOpen = id; mark(true);
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    box.innerHTML = '';
    __shiftSalesOpen = null;
    toast((typeof errMsg === 'function' ? errMsg(e) : e && e.message) || 'Impossible de charger les ventes du quart', 'error');
  }
};

/* Minuterie du quart : temps écoulé depuis l'ouverture (s'arrête seule quand on quitte la page) */
let __shiftTimerId = null;
function startShiftTimer() {
  if (__shiftTimerId) { clearInterval(__shiftTimerId); __shiftTimerId = null; }
  const tick = () => {
    const el = document.getElementById('shift-timer');
    if (!el) { clearInterval(__shiftTimerId); __shiftTimerId = null; return; }
    const t0 = Date.parse(el.dataset.start);
    if (isNaN(t0)) { el.textContent = '—'; return; }
    const sec = Math.max(0, Math.floor((Date.now() - t0) / 1000));
    const p = n => String(n).padStart(2, '0');
    el.textContent = p(Math.floor(sec / 3600)) + ':' + p(Math.floor(sec % 3600 / 60)) + ':' + p(sec % 60);
  };
  tick();
  __shiftTimerId = setInterval(tick, 1000);
}
const anom = async id => {
  const sh = (typeof SH !== 'undefined' && SH && String(SH.id) === String(id)) ? SH : await G('/shifts/' + id), team = sh.team || [];
  const fs = [['description', 'Description'], ['amount', 'Montant concerné (facultatif)', 'number']];
  if (team.length) fs.push(['employee_id', team.length > 1 ? 'Employé concerné (obligatoire)' : 'Employé concerné', 's', team.map(t => [t.id, t.name])]);
  form('Anomalie', fs, {}, async d => {
    const b = { description: d.description }; if (d.amount !== '' && d.amount != null && !isNaN(+d.amount)) b.amount = +d.amount; if (d.employee_id) b.employee_id = +d.employee_id;
    await Po(`/shifts/${id}/anomalies`, b); closeM(); go('quart');
  });
};
async function openQ() {
  const [pm, rg, em] = await Promise.all([G('/pumps'), G('/cash/registers'), G('/employees').catch(() => [])]);
  const cs = pm.filter(p => p.status == 'active').flatMap(p => p.counters.map(c => ({ ...c, pn: p.name })));
  const pumps = pm.filter(p => p.status == 'active');
  const empOpts = '<option value="">— Choisir —</option>' + (em || []).map(e =>
    `<option value="${Number(e.id)}">${esc((e.first_name || '') + ' ' + (e.last_name || ''))}</option>`).join('');
  const roleOpts = ['Pompiste', 'Caissier', 'Responsable', 'Aide', 'Autre'].map(r => `<option value="${r}">${r}</option>`).join('');
  const pumpOpts = '<option value="">Aucune pompe</option>' + pumps.map(p =>
    `<option value="${Number(p.id)}">${esc(p.name)}</option>`).join('');
  const regOpts = (rg || []).map(x => `<option value="${Number(x.id)}">${esc(x.name)} (${fl(x.balance)})</option>`).join('');
  const counterRows = cs.map((c, i) =>
    `<label>${esc(c.pn)}, compteur ${esc(String(c.counter_number))} (${esc(c.product)}) : index initial
      <input type="number" class="oq-idx" data-cid="${Number(c.id)}" value="${c.current_index != null ? c.current_index : ''}" step="0.001" ${c.current_index != null ? 'readonly style="background:var(--bg,#f1f1f1);cursor:not-allowed" title="Index initial repris du dernier index connu"' : ''}></label>`).join('');

  function partRow() {
    return `<div class="oq-part g" style="align-items:end;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--bd)">
      <label>Participant<select class="oq-emp">${empOpts}</select></label>
      <label>Rôle<select class="oq-role"><option value="">— Rôle —</option>${roleOpts}</select></label>
      <label>Pompe affectée<select class="oq-pump">${pumpOpts}</select></label>
      <button type="button" class="b2 oq-del" title="Retirer">×</button>
    </div>`;
  }

  const _oqNow = new Date();
  const _oqDate = (typeof dayNow === 'function' ? dayNow() : _oqNow.toISOString().slice(0, 10));
  const _oqTime = String(_oqNow.getHours()).padStart(2, '0') + ':' + String(_oqNow.getMinutes()).padStart(2, '0');
  modal(`<h3 style="margin-top:0">Ouverture de quart</h3>
    <div class="g">
      <label>Quart<select id="oq_kind"><option>Matin</option><option>Après-midi</option><option>Nuit</option><option>Personnalisé</option></select></label>
      <label>Caisse<select id="oq_reg">${regOpts}</select></label>
      <label>Caisse initiale (${CUR})<input type="number" id="oq_ci" value="${rg[0] && rg[0].balance != null ? rg[0].balance : 0}" step="0.01"></label>
      <label>Date d'ouverture<input type="date" id="oq_date" value="${_oqDate}" max="${_oqDate}" title="Permet d'enregistrer un quart passé"></label>
      <label>Heure d'ouverture<input type="time" id="oq_time" value="${_oqTime}" title="Heure réelle d'ouverture du quart"></label>
    </div>
    <p class="muted" style="font-size:12px;margin:6px 0 0">Pour un quart antérieur, choisissez la date (et l'heure) correspondante. Les rapports et agrégats par période utiliseront cette date.</p>
    ${counterRows ? `<div style="margin-top:12px"><b style="font-size:13px">Index des compteurs</b><div class="g" style="margin-top:6px">${counterRows}</div></div>` : ''}
    <div style="margin-top:14px">
      <b style="font-size:13px">Participants</b>
      <div id="oq_parts">${partRow()}</div>
      <button type="button" class="b2" id="oq_add" style="margin-top:6px">+ Ajouter un participant</button>
    </div>
    <div class="r" style="margin-top:16px">
      <button type="button" class="b2" onclick="closeM()">Annuler</button>
      <button type="button" id="oq_ok">Enregistrer</button>
    </div>`);

  const partsBox = document.getElementById('oq_parts');
  function bindDel(row) {
    row.querySelector('.oq-del').onclick = () => {
      if (partsBox.querySelectorAll('.oq-part').length <= 1) { toast('Au moins une ligne de participant', 'error'); return; }
      row.remove();
    };
  }
  partsBox.querySelectorAll('.oq-part').forEach(bindDel);
  document.getElementById('oq_add').onclick = () => {
    if (partsBox.querySelectorAll('.oq-part').length >= 20) { toast('Maximum 20 participants', 'error'); return; }
    partsBox.insertAdjacentHTML('beforeend', partRow());
    bindDel(partsBox.lastElementChild);
  };
  document.getElementById('oq_ok').onclick = async function () {
    const kind = document.getElementById('oq_kind').value;
    const reg = document.getElementById('oq_reg').value;
    const ci = parseFloat(document.getElementById('oq_ci').value);
    if (!reg) { toast('Choisissez une caisse', 'error'); return; }
    const oqDate = (document.getElementById('oq_date') || {}).value || '';
    const oqTime = (document.getElementById('oq_time') || {}).value || '08:00';
    if (!oqDate) { toast('Indiquez la date d\'ouverture', 'error'); return; }
    // Construit un ISO local (sans Z) pour que le serveur interprète correctement ; refuse le futur côté UI aussi.
    const openedLocal = oqDate + 'T' + (oqTime.length === 5 ? oqTime + ':00' : oqTime);
    const openedMs = new Date(openedLocal).getTime();
    if (Number.isNaN(openedMs)) { toast('Date/heure d\'ouverture invalide', 'error'); return; }
    if (openedMs > Date.now() + 60_000) { toast('La date/heure d\'ouverture ne peut pas être dans le futur', 'error'); return; }
    const employee_roles = [], pump_assignments = [], employee_ids = [];
    const seen = new Set();
    partsBox.querySelectorAll('.oq-part').forEach(row => {
      const eid = Number(row.querySelector('.oq-emp').value);
      if (!eid || seen.has(eid)) return;
      seen.add(eid);
      employee_ids.push(eid);
      const role = (row.querySelector('.oq-role').value || '').trim();
      if (role) employee_roles.push({ employee_id: eid, role });
      const pid = Number(row.querySelector('.oq-pump').value);
      if (pid) pump_assignments.push({ employee_id: eid, pump_id: pid });
    });
    const counters = [...document.querySelectorAll('.oq-idx')].map(inp => ({
      counter_id: Number(inp.dataset.cid),
      index_start: parseFloat(inp.value) || 0
    }));
    const doOpen = async () => {
      this.disabled = true;
      try {
        await Po('/shifts/open', {
          kind, cash_register_id: +reg, opening_cash: isFinite(ci) ? ci : 0,
          employee_ids, employee_roles, pump_assignments, counters,
          shift_date: oqDate,
          opened_at: new Date(openedMs).toISOString()
        });
        closeM(); go('quart');
      } catch (e) {
        this.disabled = false;
        toast(typeof errMsg === 'function' ? errMsg(e) : e.message, 'error');
      }
    };
    const todayStr = (typeof dayNow === 'function' ? dayNow() : new Date().toISOString().slice(0, 10));
    if (oqDate < todayStr) {
      ask('Ce quart sera comptabilisé sur la période du ' + oqDate + ' (date antérieure). Continuer ?', doOpen);
    } else {
      await doOpen();
    }
  };
}
const repHtml = r => `<div class="card"><b>Quart N° ${r.shift.number} (${esc(r.shift.kind)})</b><p>Ouvert : ${dt(r.shift.opened_at)} · Responsable : ${esc(r.shift.manager)}</p></div><h3>Compteurs → litres</h3>`
  + T(['Pompe', 'Cpt', 'Produit', 'Initial', 'Final', 'Litres', 'Prix', 'Montant'], r.counters.map(c => [esc(c.pump), c.counter, esc(c.product), c.index_start, c.index_end, c.liters, f(c.unit_price), f(c.amount)]))
  + '<h3>Ventes</h3>' + T(['Poste', 'Montant'], [['Carburant (compteurs)', f(r.fuel_total)], ...(r.fuel_declared ? [['&nbsp;&nbsp;dont déclaré à la saisie', f(r.fuel_declared.total)], ['&nbsp;&nbsp;dont non déclaré (compté en espèces)', f(r.fuel_declared.undeclared)]] : []), ...r.fuel.map(x => ['&nbsp;&nbsp;' + esc(x.name) + ' : ' + x.liters + ' L', f(x.amount)]), ['Autres produits', f(r.other_sales.total)], ...r.other_sales.by_method.map(x => ['&nbsp;&nbsp;' + x.method, f(x.amount)]), ['Carburant en espèces', f(r.fuel_payments.especes)], ['Carburant mobile money', f(r.fuel_payments.mobile_money)], ['Carburant carte', f(r.fuel_payments.carte)], ['Carburant crédit', f(r.fuel_payments.credit)]])
  + '<h3>Caisse</h3>' + T(['Initiale', 'Théorique', 'Comptée', 'Écart'], [[f(r.cash.opening), f(r.cash.theoretical), f(r.cash.counted), `<b style="color:${r.cash.gap ? 'var(--r)' : 'var(--p)'}">${f(r.cash.gap)}</b>`]])
  + '<h3>Stock</h3>' + T(['Produit', 'Théorique', 'Physique', 'Écart'], r.stock.map(x => [esc(x.product), x.theoretical, x.physical ?? '', x.gap ?? '']))
  + (r.employees && r.employees.length ? '<h3>Situation par employé</h3>' + T(['Employé', 'Pompes', 'Litres', 'Espèces attendues', 'Espèces remises', 'Écart de caisse', 'Écarts de stock'], r.employees.map(e => [esc(e.name), esc((e.pumps || []).join(', ') || '-'), e.fuel_liters, e.expected_cash == null ? '' : f(e.expected_cash), e.counted_cash == null ? '' : f(e.counted_cash), e.cash_gap == null ? '' : `<b style="color:${e.cash_gap ? 'var(--r)' : 'var(--p)'}">${f(e.cash_gap)}</b>`, (e.stock_gaps || []).map(x => esc(String(x.product || '').trim()) + ' : ' + (Math.round(Number(x.amount) * 100) / 100)).join('<br>') || '-']).concat(r.unassigned && ((r.unassigned.cash_gap && Math.abs(r.unassigned.cash_gap) > 0.004) || (r.unassigned.stock_gaps || []).length) ? [['<i>Non attribué à un employé</i>', '', '', '', '', r.unassigned.cash_gap ? f(r.unassigned.cash_gap) : '', (r.unassigned.stock_gaps || []).map(x => esc(String(x.product || '').trim()) + ' : ' + (Math.round(Number(x.amount) * 100) / 100)).join('<br>')]] : [])) : '')
  + `<div class="card"><b>Anomalies détectées</b><p>${r.anomalies.map(a => (a.employee ? '<b>' + esc(a.employee) + '</b> : ' : (r.shared ? '<i>Ensemble du quart</i> : ' : '')) + esc(a.description) + (a.reported_by && !/^ecart_|^rattachement$/.test(a.kind || '') ? ' <i style="color:var(--m)">(signalée par ' + (a.reported_self ? 'l\'employé lui-même' : esc(a.reported_by)) + ')</i>' : '')).join('<br>') || 'Aucune'}</p></div>`;
async function vClot() {
  let cu, pr, cl;
  try { [cu, pr, cl] = await Promise.all([G('/shifts/current'), G('/products'), G('/customers').catch(() => [])]); }
  catch (e) { if (window.smpCloseOfflineForm && window.SMPOffline && SMPOffline.isNetworkError(e)) return window.smpCloseOfflineForm(); throw e; }   // CORR-044 : relevé hors ligne
  if (!cu) return '<p>Aucun quart ouvert.</p>'; SH = cu; PR = pr; if (window.smpCloseDraft) setTimeout(smpCloseDraft.apply, 50); const multi = (cu.team || []).length >= 2;
  return `<div class="card"><b>CLÔTURE DU QUART N° ${cu.number}</b><p>Début ${dt(cu.opened_at)}. Les calculs sont faits par le serveur.</p></div><h3>A. Compteurs</h3>`
    + T(['Pompe', 'Cpt', 'Produit', 'Initial', 'Final'], cu.counters.map((c, i) => [esc(c.pump), c.counter_number, esc(c.product), c.index_start, `<input id="c${i}" type="number" step="any" style="width:130px" oninput="pvd()">`]))
    + (multi ? empCloseBlock(cu, cl) : `<h3>B. Carburant payé autrement qu'en espèces</h3><div class="g"><label>Mobile money<input id="pm" type="number" oninput="pvd()"></label><label>Carte<input id="pc" type="number" oninput="pvd()"></label><label>À crédit<input id="pk" type="number" oninput="pvd()"></label><label>Client (si crédit)<select id="pk_c" onchange="pvd()"><option value="">Aucun</option>${cl.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div>`)
    + `<h3>C. Caisse</h3><div class="g"><label>Caisse physique comptée<input id="cp" type="number" step="any" oninput="pvd()"></label></div><h3>D. Stock physique (facultatif)</h3>`
    + T(['Produit', 'Stock système', 'Physique'], pr.map(p => [esc(p.name), fl(p.stock), `<input id="s${p.id}" type="number" step="any" style="width:110px" oninput="pvd()">`]))
    + (() => {
      const _now = new Date();
      const _od = SH && SH.opened_at ? String(SH.opened_at).slice(0, 10) : (typeof dayNow === 'function' ? dayNow() : _now.toISOString().slice(0, 10));
      const _today = (typeof dayNow === 'function' ? dayNow() : _now.toISOString().slice(0, 10));
      // Par défaut : aujourd'hui / heure courante ; si quart passé, préremplir date d'ouverture + 8h
      let defDate = _today, defTime = String(_now.getHours()).padStart(2,'0') + ':' + String(_now.getMinutes()).padStart(2,'0');
      if (_od && _od < _today) {
        defDate = _od;
        const o = new Date(SH.opened_at);
        if (!isNaN(o.getTime())) {
          const c = new Date(o.getTime() + 8 * 3600 * 1000);
          defTime = String(c.getHours()).padStart(2,'0') + ':' + String(c.getMinutes()).padStart(2,'0');
        } else defTime = '16:00';
      }
      return `<h3>Date de clôture</h3><div class="g"><label>Date<input type="date" id="cl_date" value="${defDate}" max="${_today}" min="${_od}"></label><label>Heure<input type="time" id="cl_time" value="${defTime}"></label></div><p class="muted" style="font-size:12px;margin:4px 0 8px">Pour un quart antérieur, indiquez la date/heure réelle de fin. Doit être ≥ ouverture et ≤ maintenant.</p>`;
    })()
    + `<h3>Résumé avant validation</h3><div id="pvbox"><p style="color:var(--m)">Saisissez les index finaux pour voir le résumé.</p></div><br><label>Justification des écarts et anomalies<textarea id="jus" rows="2"></textarea></label><br><label>Observations<textarea id="obs" rows="2"></textarea></label><div class="r"><button class="b2" onclick="go('quart')">Retour</button><button onclick="doClose()">VALIDER LA CLÔTURE</button></div>`;
}
// Quart partagé : chaque employé remet SES espèces ; les paiements non espèces sont ceux de SES pompes
function empCloseBlock(cu, cl) {
  const pn = t => [...new Set((cu.counters || []).filter(c => (t.pump_ids || []).includes(c.pump_id)).map(c => c.pump))].join(', ') || 'aucune pompe';
  const inp = id => `<input id="${id}" type="number" step="any" style="width:100px" oninput="pvd()">`;
  const taken = new Set(cu.team.flatMap(t => t.pump_ids || [])), free = [...new Set((cu.counters || []).filter(c => !taken.has(c.pump_id)).map(c => c.pump))];
  return `<h3>B. Situation de chaque employé (quart partagé)</h3><p class="muted" style="font-size:12px">Chaque employé n'est responsable que de ses pompes, de ses ventes et de ses espèces. Saisissez ce que CHACUN remet et les paiements non espèces de SES pompes.</p>`
    + T(['Employé', 'Pompes', 'Espèces remises', 'Mobile money', 'Carte', 'À crédit'], cu.team.map(t => [esc(t.name), esc(pn(t)), inp('ec' + t.id), inp('em' + t.id), inp('ek' + t.id), inp('er' + t.id)]))
    + (free.length ? `<h4>Pompes sans employé : ${esc(free.join(', '))}</h4><p class="muted" style="font-size:12px">Paiements non espèces de ces pompes (les espèces sont comptées dans la caisse physique).</p><div class="g"><label>Mobile money<input id="pm" type="number" step="any" oninput="pvd()"></label><label>Carte<input id="pc" type="number" step="any" oninput="pvd()"></label><label>À crédit<input id="pk" type="number" step="any" oninput="pvd()"></label></div>` : '')
    + `<div class="g"><label>Client (si crédit)<select id="pk_c" onchange="pvd()"><option value="">Aucun</option>${cl.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label></div>`;
}
function cbody() {
  const g = i => parseFloat($('#' + i).value), n = i => (($('#' + i) && g(i)) || 0);
  const b = { counters: SH.counters.map((c, i) => ({ counter_id: c.counter_id, index_end: g('c' + i) })).filter(x => !isNaN(x.index_end)), non_cash: { mobile_money: n('pm'), card: n('pc'), credit: n('pk') }, counted_cash: n('cp'), stock_counts: PR.map(p => ({ product_id: p.id, physical: g('s' + p.id) })).filter(x => !isNaN(x.physical)), justification: $('#jus').value, observations: $('#obs').value };
  if (SH && (SH.team || []).length >= 2) b.employee_closings = SH.team.map(t => ({ employee_id: +t.id, counted_cash: n('ec' + t.id), mobile_money: n('em' + t.id), card: n('ek' + t.id), credit: n('er' + t.id) }));
  if ($('#pk_c') && $('#pk_c').value) b.non_cash.credit_customer_id = +$('#pk_c').value;
  const cd = ($('#cl_date') || {}).value, ct = ($('#cl_time') || {}).value || '12:00';
  if (cd) {
    const local = cd + 'T' + (ct.length === 5 ? ct + ':00' : ct);
    const ms = new Date(local).getTime();
    if (!isNaN(ms)) b.closed_at = new Date(ms).toISOString();
  }
  return b;
}
const pvd = () => { clearTimeout(PT); PT = setTimeout(pv, 500); if (window.smpCloseDraft) smpCloseDraft.save(); };
async function pv() { if (!$('#pvbox')) return; try { const j = await Po(`/shifts/${SH.id}/close?preview=1`, cbody()); $('#pvbox').innerHTML = repHtml(j.report); } catch (e) {
  const fix = Array.isArray(e.details) ? e.details.filter(d => d && typeof d === 'object' && d.sale_id != null) : [];
  $('#pvbox').innerHTML = fix.length
    ? `<p style="color:var(--r)">${esc(e.message)}.</p>` + fix.map(d => `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;margin:6px 0"><span style="color:var(--r);font-size:13px">${esc(d.description)}</span><button type="button" class="b2" onclick="fixSaleOwner(${Number(d.sale_id)})">Remettre au responsable de la pompe</button></div>`).join('')
    : `<p style="color:var(--r)">${esc(errMsg(e))}</p>`; } }
async function fixSaleOwner(saleId) { try { await Po(`/shifts/${SH.id}/sales/${Number(saleId)}/reassign-to-pump-owner`, {}); toast('Vente remise au responsable de la pompe', 'success'); pv(); } catch (e) { toast(errMsg(e), 'error'); } }
window.fixSaleOwner = fixSaleOwner;
function doClose() {
  if (!$('#cp').value) return toast('Saisissez la caisse physique comptée');
  const miss = (SH && (SH.team || []).length >= 2) ? SH.team.find(t => !$('#ec' + t.id) || $('#ec' + t.id).value === '') : null;
  if (miss) return toast('Saisissez les espèces remises par ' + miss.name + ' (0 si rien)');
  const cd = ($('#cl_date') || {}).value || '';
  const today = (typeof dayNow === 'function' ? dayNow() : new Date().toISOString().slice(0, 10));
  const msg = (cd && cd < today)
    ? ('Clôturer ce quart à la date du ' + cd + ' ? Il sera verrouillé.')
    : 'Valider la clôture ? Le quart sera verrouillé.';
  ask(msg, async () => { try { const sid0 = SH.id; await Po(`/shifts/${SH.id}/close`, cbody()); if (window.smpCloseDraft) smpCloseDraft.clear(sid0); go('rapq', SH.id); } catch (e) { toast(errMsg(e)); pv(); } });
}
// ---- Partage du rapport de quart clôturé : e-mail (PDF joint) et WhatsApp (message prérempli, envoi confirmé par l'utilisateur) ----
async function shiftShareEmail(id, mode, btn) {
  const lab = mode === 'closer' ? 'complet à la personne qui a clôturé (avec l’employé à l’origine de chaque situation)' : 'individuel à chaque employé concerné (chacun reçoit sa seule situation)';
  ask(`Envoyer le rapport PDF par e-mail ${lab} ?`, async () => {
    if (btn) btn.disabled = true;
    try {
      const j = await Po(`/shifts/${Number(id)}/report-email`, { mode });
      toast(`Rapport envoyé à : ${j.sent_to.join(', ')}` + (j.fallback_company ? ' (e-mail de l’entreprise : aucune adresse individuelle)' : '') + (j.failed && j.failed.length ? ` · échec : ${j.failed.map(f => f.email).join(', ')}` : ''), j.failed && j.failed.length ? 'error' : 'success');
    } catch (e) { toast(errMsg(e), 'error'); }
    finally { if (btn) btn.disabled = false; }
  });
}
const waLink = (num, text) => 'https://wa.me/' + String(num).replace(/\D/g, '') + '?text=' + encodeURIComponent(text);
async function shiftShareWa(id, mode) {
  try {
    const j = await G(`/shifts/${Number(id)}/report-contacts`);
    const rows = [];
    if (mode === 'closer') {
      const c = j.closer || {};
      const num = c.whatsapp || (j.station && j.station.whatsapp) || null;
      rows.push({ name: c.name || 'Personne qui a clôturé', num, note: c.whatsapp ? '' : (num ? 'numéro de l’entreprise (aucun numéro valide sur la fiche)' : '') });
    } else {
      for (const e of j.employees || []) rows.push({ name: e.name, num: e.whatsapp, msg: e.message, note: e.whatsapp ? '' : (e.phone ? 'numéro invalide : format +223 XX XX XX XX' : 'pas de numéro') });
    }
    if (!rows.length) return toast('Aucun employé concerné par ce quart.', 'error');
    modal(`<h3 style="margin-top:0">WhatsApp — rapport du quart ${esc(String(j.shift.number).padStart(6, '0'))}</h3>
      <p class="muted">Chaque lien ouvre WhatsApp avec le message prérempli : vous devez confirmer l’envoi dans WhatsApp. Numéros attendus avec indicatif pays (ex. +223…).${mode === 'closer' ? '' : ' <b>Chaque employé reçoit uniquement sa propre situation.</b>'}</p>
      <pre style="white-space:pre-wrap;max-height:160px;overflow:auto;background:var(--pl);padding:8px;border-radius:8px;font-size:12px">${esc(j.message)}</pre>
      <div>${rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd)"><span>${esc(r.name)}${r.note ? `<br><small style="color:var(--m)">${esc(r.note)}</small>` : ''}</span>${r.num ? `<a class="b2" style="padding:4px 10px;border-radius:8px" target="_blank" rel="noopener noreferrer" href="${esc(waLink(r.num, r.msg || j.message))}">Ouvrir WhatsApp</a>` : '<span class="tag x">indisponible</span>'}</div>`).join('')}</div>
      <div class="r" style="margin-top:12px"><button class="b2" onclick="closeM()">Fermer</button></div>`);
  } catch (e) { toast(errMsg(e), 'error'); }
}
window.shiftShareEmail = shiftShareEmail; window.shiftShareWa = shiftShareWa;

async function vRapq() {
  const s = await G('/shifts/' + arg); if (!s.report) return '<p>Aucun rapport : le quart n\'est pas clôturé.</p>';
  return `<div class="bar"><button onclick="window.print()">Imprimer</button><button onclick="dlFile('/shifts/${s.id}/report.pdf','quart-${s.number}')">Exporter en PDF</button><button class="b2" onclick="go('quart')">Retour</button></div><div class="bar" id="share-bar"><button class="b2" onclick="shiftShareEmail(${Number(s.id)},'employees',this)">✉ PDF individuel à chaque employé</button><button class="b2" onclick="shiftShareEmail(${Number(s.id)},'closer',this)">✉ Rapport complet au clôturant</button><button class="b2" onclick="shiftShareWa(${Number(s.id)},'employees')">WhatsApp individuel</button><button class="b2" onclick="shiftShareWa(${Number(s.id)},'closer')">WhatsApp clôturant</button></div>` + repHtml(s.report) + `<div class="card"><b>Justification</b><p>${esc(s.gap_justification) || '-'}</p><b>Observations</b><p>${esc(s.observations) || '-'}</p></div><p style="margin-top:40px">Responsable : ____________ &nbsp; Employé : ____________ &nbsp; Gérant : ____________</p>`;
}
/* ---------- ventes ---------- */
async function vVentes() {
  const rqv = (window.RT && RT.query('ventes')) ? RT.query('ventes') : '';   // période appliquée (filtre + export PDF)
  const [ls, cu] = await Promise.all([G('/sales' + (rqv ? '?' + rqv : '')), G('/shifts/current').catch(() => null)]); window.__rtSales = ls;
  const qLabel = cu ? `<b>Quart N° ${esc(cu.number)}</b> <span style="color:#c00">(En cours…)</span>` : `<b style="color:#c00">Aucun quart ouvert</b>`;
  return (window.RT ? RT.bar('ventes') : '') + `<div class="bar">${can('sale.create') ? `<button onclick="addS()">＋ Nouvelle vente</button><button class="b2" onclick="typeof addProductSale==='function'?addProductSale():addS()">Produit</button><button class="b2" onclick="addFuel()">Carburant</button>` : ''}${can('expense.create') ? `<button class="b2" onclick="addX()">Dépense</button>` : ''}<span style="margin-left:auto">${qLabel}</span></div>` + T(['N°', 'Facture', 'Quart', 'Type', 'Date', 'Total', 'Statut', ''], ls.map(x => [x.id, esc(x.invoice_no), x.shift_id, x.kind == 'carburant' ? 'Carburant (' + esc(x.input_mode) + ')' : 'Produits', dt(x.sold_at), f(x.total), `<span class="tag ${x.status == 'annule' ? 'x' : ''}">${x.status}</span>`, (can('sale.delete') && x.status == 'valide' ? `<button class="b2" onclick="cancelS(${x.id})">Annuler</button>` : '') + (x.status == 'valide' && typeof billFromSale === 'function' ? ` <button class="b2" onclick="billFromSale(${x.id})">Facturer</button>` : '')]));
}
// addS / addProductSale : définis dans ext-core.js (choix Produit | Carburant)
function notifyIfPastShift() {
  try {
    const cu = typeof SH !== 'undefined' ? SH : null;
    if (!cu || !cu.opened_at) return;
    const ymd = String(cu.opened_at).slice(0, 10);
    const today = (typeof dayNow === 'function' ? dayNow() : new Date().toISOString().slice(0, 10));
    if (ymd && ymd < today) {
      toast('Quart antérieur (début ' + ymd + ') : cette opération sera datée sur cette période.', 'info');
    }
  } catch (_) { /* ignore */ }
}
async function addS() {
  // Repli si ext-core non chargé : vente produit uniquement
  notifyIfPastShift();
  const [pr, cl, em] = await Promise.all([G('/products'), G('/customers').catch(() => []), G('/employees').catch(() => [])]), ps = pr.filter(p => p.category != 'CARBURANT' && p.active);
  form('Vente de produit', [['p', 'Produit', 's', ps.map(p => [p.id, `${p.name} (${p.sell_price}) stock ${fl(p.stock)}`])], ['q', 'Quantité', 'number'], ['pay', 'Paiement', 's', ['especes', 'mobile_money', 'carte', 'credit']], ['c', 'Client (si crédit)', 's', [['', 'Aucun'], ...cl.map(c => [c.id, c.name])]], ['e', 'Employé', 's', em.map(e => [e.id, e.first_name + ' ' + e.last_name])]], { q: 1 }, async d => {
    const p = ps.find(x => x.id == d.p); if (!p) throw new Error('Aucun produit disponible');
    await Po('/sales', { items: [{ product_id: p.id, quantity: d.q }], payments: [{ method: d.pay, amount: fl(d.q * p.sell_price) }], customer_id: d.c ? +d.c : undefined, employee_id: d.e ? +d.e : undefined }); closeM(); go('ventes'); });
}
const cancelS = id => form('Annuler la vente', [['reason', 'Motif (obligatoire)']], {}, async d => { await Po(`/sales/${id}/cancel`, d); closeM(); go('ventes'); });
/* ---------- produits et stock ---------- */
async function vProd() {
  const hasArch = typeof archQuery === 'function', inactiveView = hasArch && ARCH.products;
  PSC = await G('/products' + (hasArch ? archQuery('products') : ''));
  return `<div class="bar"><input class="q" placeholder="Rechercher nom, code-barres, SKU…" oninput="flt(this)">${can('price.edit') && !inactiveView ? `<button onclick="addP()">Ajouter un produit</button>` : ''}${can('settings.edit') ? `<button class="b2" onclick="manageProductCategories()">Gérer les catégories</button>` : ''}${can('stock.adjust') ? `<button class="b2" onclick="addMv()">Mouvement de stock</button>` : ''}<button class="b2" onclick="go('stock')">Vue stocks</button><button class="b2" onclick="go('rapports')">Rapports</button>${hasArch ? archToggleBtn('products') : ''}</div>` + (hasArch ? archBanner('products', PSC.length) : '') + T(['Produit', 'Code-barres', 'Catégorie', 'Prix achat', 'Prix vente', 'Stock', 'Seuil', ''], PSC.map(p => [(typeof av === 'function' ? av('products', p.id, p.photo_path, p.name) + ' ' : '') + esc(p.name), esc(p.barcode || p.sku || '—'), esc(p.category_label || p.category), f(p.buy_price), f(p.sell_price), fl(p.stock) + ' ' + esc(p.unit) + (p.stock <= p.min_stock ? ' <span class="tag x">bas</span>' : ''), p.min_stock, hasArch ? archRowBtn('products', p.id, !!inactiveView, p.name) : '']), i => can('price.edit') ? `editP(${PSC[i].id})` : '');
}
let CAT = ['CARBURANT', 'LUBRIFIANT', 'HUILE', 'ACCESSOIRES', 'BOUTIQUE', 'AUTRES'];
async function loadProductCategories() { const rows = await G('/categories'); CAT = rows.map(x => x.code); return rows; }
async function manageProductCategories() {
  const rows = await loadProductCategories();
  const body = rows.map(c => `<div class="r" style="justify-content:space-between;margin:6px 0"><span>${esc(c.label)}${c.has_meter ? ' · compteurs' : ''}</span><button class="b2" onclick="editProductCategory(${c.id})">Modifier</button>${c.code !== 'CARBURANT' ? `<button class="b2" onclick="deleteProductCategory(${c.id})">Supprimer</button>` : ''}</div>`).join('');
  modal(`<h3>Catégories de produits</h3><p>Les catégories sont partagées par les stations de cette base. Le code interne reste stable pour préserver les ventes et les rapports.</p><div style="max-height:45vh;overflow:auto">${body}</div><div class="r"><button class="b2" onclick="closeM()">Fermer</button><button id="addCat">Ajouter une catégorie</button></div>`);
  $('#addCat').onclick = () => form('Nouvelle catégorie', [['label','Nom de la catégorie'],['has_meter','Catégorie avec compteurs','s',[['false','Non'],['true','Oui']]]], {has_meter:'false'}, async d => { await Po('/categories',{label:d.label,has_meter:String(d.has_meter).toLowerCase()==='true'}); await manageProductCategories(); });
}
async function editProductCategory(id) { const rows=await G('/categories'), c=rows.find(x=>x.id===id); if(!c)return; form('Modifier la catégorie', [['label','Nom']], {label:c.label}, async d=>{await api('PATCH','/categories/'+id,{label:d.label}); await manageProductCategories();}); }
async function deleteProductCategory(id) { if(!confirm('Supprimer cette catégorie ? Les catégories utilisées par des produits ne peuvent pas être supprimées.'))return; await api('DELETE','/categories/'+id); await manageProductCategories(); }
const addP = async () => { await loadProductCategories(); form('Produit', [['category', 'Catégorie', 's', CAT], ['name', 'Nom'], ['barcode', 'Code-barres / EAN'], ['sku', 'Référence interne (SKU)'], ['unit', 'Unité'], ...(can('cost.view') ? [['buy_price', 'Prix achat', 'number']] : []), ['sell_price', 'Prix vente', 'number'], ['min_stock', 'Seuil minimum', 'number'], ['initial_stock', 'Stock initial', 'number']], { unit: 'L' }, async d => { await Po('/products', d); closeM(); go('prod'); }); };
function editP(id) {
  const p = PSC.find(x => x.id == id);
  if (!p) return toast('Produit introuvable', 'error');
  loadProductCategories().then(() => form('Modifier ' + esc(p.name), [
    ['category', 'Catégorie', 's', CAT],
    ['name', 'Nom'],
    ['barcode', 'Code-barres / EAN'],
    ['sku', 'Référence interne (SKU)'],
    ['unit', 'Unité'],
    ...(can('cost.view') ? [['buy_price', 'Prix achat', 'number']] : []),
    ['sell_price', 'Prix vente', 'number'],
    ['min_stock', 'Seuil', 'number']
  ], p, async d => {
    const ch = {};
    for (const k of ['category', 'name', 'barcode', 'sku', 'unit', ...(can('cost.view') ? ['buy_price'] : []), 'sell_price', 'min_stock']) {
      if (String(d[k] ?? '') !== String(p[k] ?? '')) ch[k] = d[k];
    }
    if (!Object.keys(ch).length) { closeM(); return; }
    await api('PATCH', '/products/' + id, ch);
    closeM();
    toast('Produit mis à jour', 'success');
    if (cur === 'prodf') go('prodf', arg); else go('prod');
  }));
}
const addMv = () => form('Mouvement de stock', [['product_id', 'Produit', 's', PSC.map(p => [p.id, p.name])], ['kind', 'Type', 's', ['entree', 'retour', 'perte', 'casse', 'correction']], ['quantity', 'Quantité (correction : + ou −)', 'number'], ['comment', 'Motif (obligatoire, 3 caractères min.)']], {}, async d => { if (String(d.comment || '').trim().length < 3) { toast('Motif obligatoire (3 caractères minimum).', 'error'); return; } await Po('/stock/movements', { ...d, product_id: +d.product_id }); closeM(); go('prod'); });
/* ---------- pompes ---------- */
async function vPompes() {
  const ps = await G('/pumps'); window.PU = ps;
  const canEdit = can('settings.edit');
  return `<div class="bar">${canEdit ? `<button onclick="addPump()">Ajouter une pompe</button>` : ''}</div>`
    + T(['Pompe', 'Emplacement', 'Statut', 'Compteurs → produit (index)', ''],
      ps.map(p => [
        esc(p.name),
        esc(p.location),
        p.status,
        (p.counters || []).map(c =>
          `Cpt ${c.counter_number} → <b>${esc(c.product)}</b> : <b>${fl(c.current_index)}</b>`
          + (canEdit ? ` <button class="b2" style="padding:2px 8px;font-size:12px" onclick="event.stopPropagation();correctCounterIndex(${p.id},${c.counter_number},${Number(c.current_index)})">Corriger index</button>` : '')
        ).join('<br>'),
        canEdit ? `<button class="b2" onclick="editPump(${p.id})">Modifier</button>` : ''
      ]))
    + '<p style="color:var(--m)">Chaque compteur est lié au produit de votre choix. Utilisez « Corriger index » pour rectifier une erreur de saisie (action journalisée dans l\'audit).</p>';
}
async function fuelOpts() { return (await G('/products')).filter(p => p.category == 'CARBURANT').map(p => [p.id, p.name]); }
async function addPump() { const fo = await fuelOpts(); form('Nouvelle pompe', [['number', 'Numéro', 'number'], ['name', 'Nom'], ['location', 'Emplacement'], ['p1', 'Compteur 1 → produit', 's', fo], ['p2', 'Compteur 2 → produit', 's', [['', 'Aucun (1 compteur)'], ...fo]]], {}, async d => { const counters = [{ counter_number: 1, product_id: +d.p1 }]; if (d.p2) counters.push({ counter_number: 2, product_id: +d.p2 }); await Po('/pumps', { number: d.number, name: d.name, location: d.location, counters }); closeM(); go('pompes'); }); }
async function editPump(id) {
  const p = PU.find(x => x.id == id), fo = await fuelOpts();
  const c1 = (p.counters || []).find(c => c.counter_number == 1), c2 = (p.counters || []).find(c => c.counter_number == 2);
  const fs = [['number', 'Numéro', 'number'], ['name', 'Nom'], ['location', 'Emplacement'],
    ['status', 'Statut', 's', [['active', 'Actif'], ['inactive', 'Inactif'], ['maintenance', 'En maintenance']]],
    ['p1', 'Compteur 1 → produit', 's', fo],
    ['p2', 'Compteur 2 → produit', 's', c2 ? fo : [['', 'Aucun (1 compteur)'], ...fo]],
    ['reason', 'Motif de la modification (facultatif)']];
  const v = { number: p.number, name: p.name, location: p.location || '', status: p.status, p1: c1 ? c1.product_id : '', p2: c2 ? c2.product_id : '', reason: '' };
  form('Modifier la pompe ' + esc(p.name), fs, v, async d => {
    const counters = [];
    if (d.p1 && (!c1 || +d.p1 !== Number(c1.product_id))) counters.push({ counter_number: 1, product_id: +d.p1 });
    if (d.p2 && (!c2 || +d.p2 !== Number(c2.product_id))) counters.push({ counter_number: 2, product_id: +d.p2 });
    await api('PATCH', '/pumps/' + id, { number: d.number, name: d.name, location: d.location, status: d.status, counters, reason: d.reason || undefined });
    closeM(); toast('Pompe modifiée', 'success'); go('pompes');
  });
}
/** Correction manuelle de l'index d'un compteur (erreurs) — enregistrée dans l'audit. */
async function correctCounterIndex(pumpId, counterNumber, currentIndex) {
  // productName retiré des args onclick (casse HTML si le nom contient des guillemets)
  let productLabel = '—';
  try {
    const p = (window.PU || []).find(x => Number(x.id) === Number(pumpId));
    const c = p && (p.counters || []).find(x => Number(x.counter_number) === Number(counterNumber));
    if (c && c.product) productLabel = c.product;
  } catch (_) {}
  form(
    `Corriger index — Cpt ${counterNumber} (${productLabel})`,
    [
      ['current_index', 'Nouvel index', 'number'],
      ['reason', 'Motif de la correction (obligatoire, 3 caractères min.)']
    ],
    { current_index: currentIndex },
    async d => {
      const idx = parseFloat(d.current_index);
      if (isNaN(idx) || idx < 0) throw Object.assign(new Error('Index invalide'), { status: 400 });
      const reason = String(d.reason || '').trim();
      if (reason.length < 3) throw Object.assign(new Error('Motif obligatoire (3 caractères minimum)'), { status: 400 });
      const res = await api('PATCH', `/pumps/${pumpId}/counters/${counterNumber}/index`, {
        current_index: idx,
        reason
      });
      closeM();
      if (res.warning) toast(res.warning, 'error');
      else toast(`Index corrigé : ${res.old_index} → ${res.new_index}`, 'success');
      go('pompes');
    }
  );
}
window.correctCounterIndex = correctCounterIndex;
/* ---------- clients, employés ---------- */
async function vCli() {
  const ls = await G('/customers');
  return `<div class="bar"><input class="q" placeholder="Rechercher" oninput="flt(this)"><button onclick="addCli()">Ajouter un client</button></div>` + T(['', 'Client', 'Type', 'Limite', 'Solde dû', ''], ls.map(c => [av('customers', c.id, c.photo_path, c.name), esc(c.name), c.kind, f(c.credit_limit), f(c.balance), c.balance > 0 ? `<button class="b2" onclick="payCli(${c.id},${c.balance})">Encaisser</button>` : '']));
}
const addCli = () => form('Client', [['name', 'Nom'], ['kind', 'Type', 's', ['particulier', 'entreprise', 'professionnel', 'credit']], ['phone', 'Téléphone'], ['address', 'Adresse'], ['credit_limit', 'Limite de crédit', 'number']], {}, async d => { await Po('/customers', d); closeM(); go('cli'); });
const payCli = async (id, due) => { await refreshPmAccounts(); const opts = pmAccOpts(['credit']); if (!opts.length) return toast('Aucun compte actif disponible : rattachez un moyen de paiement à un compte (Finance).', 'error'); return form('Encaissement client', [['amount', 'Montant', 'number'], ['method', 'Compte / mode de règlement', 's', opts]], { amount: due, method: opts[0][0] }, async d => { await Po(`/customers/${id}/payments`, d); closeM(); go('cli'); }); };
async function vEmp() { const ls = await G('/employees'); return `<div class="bar">${can('settings.edit') ? `<button onclick="addEmp()">Ajouter un employé</button>` : ''}</div>` + T(['Matricule', 'Nom', 'Poste', 'Téléphone', 'Statut'], ls.map(e => [esc(e.matricule), esc(e.first_name + ' ' + e.last_name), esc(e.position), esc(e.phone), e.status])); }
const addEmp = () => form('Employé', [['matricule', 'Matricule'], ['last_name', 'Nom'], ['first_name', 'Prénom'], ['phone', 'Téléphone'], ['position', 'Poste', 's', ['administrateur', 'gérant', 'caissier', 'pompiste', 'superviseur', 'magasinier', 'comptable']]], {}, async d => { await Po('/employees', d); closeM(); go('emp'); });
/* ---------- fournisseurs et achats ---------- */
async function vFour() {
  const [sp, pu] = await Promise.all([G('/suppliers'), G('/purchases')]);
  return `<div class="bar">${can('purchase.manage') ? `<button onclick="addSup()">Ajouter un fournisseur</button><button onclick="addPO()">Nouvelle commande</button>` : ''}</div>` + T(['', 'Fournisseur', 'Téléphone', 'Dette'], sp.map(s => [av('suppliers', s.id, s.photo_path, s.name), esc(s.name), esc(s.phone), f(s.balance_due)]))
    + '<h3>Achats</h3>' + T(['Commande', 'Fournisseur', 'Statut', 'Total commandé', 'Facture', 'Payé'], pu.map(p => [esc(p.order_no), esc(p.supplier), `<span class="tag">${p.status}</span>`, f(p.total), esc(p.invoice_no || ''), f(p.paid)]), i => `showPO(${pu[i].id})`);
}
const addSup = () => form('Fournisseur', [['name', 'Nom'], ['company', 'Entreprise'], ['phone', 'Téléphone'], ['email', 'Email'], ['address', 'Adresse'], ['contact', 'Contact']], {}, async d => { await Po('/suppliers', d); closeM(); go('four'); });
async function addPO() {
  if (typeof window.poNew === 'function') return window.poNew();
  toast('Module bon de commande indisponible — rechargez la page', 'error');
}
async function showPO(id) {
  const p = await G('/purchases/' + id), rec = fl(p.details.reduce((a, d) => a + d.qty_received * d.unit_cost, 0)), m = can('purchase.manage'), b = [];
  if (m && ['commande', 'partiel'].includes(p.status)) b.push(`<button onclick="recvPO(${id})">Réceptionner</button>`);
  if (m && p.status == 'commande') b.push(`<button class="bd" onclick="cancPO(${id})">Annuler</button>`);
  if (m && p.status == 'recu') b.push(`<button onclick="invPO(${id},${rec})">Enregistrer la facture</button>`);
  if (can('purchase.pay') && p.status == 'facture') b.push(`<button onclick="payPO(${id},${fl(p.invoice_total - p.paid)})">Payer</button>`);
  if (m && p.status == 'paye') b.push(`<button onclick="archPO(${id})">Archiver</button>`);
  modal(`<h3>${esc(p.order_no)} · ${esc(p.supplier)} · <span class="tag">${p.status}</span></h3>` + T(['Produit', 'Commandé', 'Reçu', 'Coût unitaire'], p.details.map(d => [esc(d.product), d.qty_ordered, d.qty_received, f(d.unit_cost)])) + `<p>Total commandé : ${f(p.total)}${p.invoice_no ? ` · Facture ${esc(p.invoice_no)} : ${f(p.invoice_total)} · Payé : ${f(p.paid)}` : ''}</p>` + (p.payments.length ? T(['Paiement', 'Mode', 'Montant'], p.payments.map(x => [dt(x.paid_at), x.method, f(x.amount)])) : '') + `<div class="r"><button class="b2" onclick="closeM()">Fermer</button>${b.join('')}</div>`);
}
const act = async (path, b) => { await Po(path, b); closeM(); go(typeof cur !== 'undefined' && cur === 'achats' ? 'achats' : 'four'); };
async function recvPO(id) { const p = await G('/purchases/' + id); form('Réception ' + esc(p.order_no), p.details.map(d => ['q' + d.id, `${d.product} (reste ${fl(d.qty_ordered - d.qty_received)})`, 'number']), Object.fromEntries(p.details.map(d => ['q' + d.id, fl(d.qty_ordered - d.qty_received)])), d => act(`/purchases/${id}/receive`, { lines: p.details.filter(x => d['q' + x.id] > 0).map(x => ({ detail_id: x.id, quantity: d['q' + x.id] })) })); }
const invPO = (id, rec) => form('Facture fournisseur', [['invoice_no', 'N° de facture'], ['invoice_date', 'Date de facture', 'date'], ['due_date', 'Échéance', 'date'], ['invoice_total', 'Montant facturé', 'number']], { invoice_total: rec }, d => act(`/purchases/${id}/invoice`, { invoice_no: d.invoice_no, invoice_date: d.invoice_date || undefined, due_date: d.due_date || undefined, invoice_total: d.invoice_total || undefined }));
const payPO = (id, rest) => form('Paiement fournisseur', [['amount', 'Montant (reste ' + fl(rest) + ')', 'number'], ['method', 'Mode', 's', pmOpts(['credit'])]], { amount: rest }, d => act(`/purchases/${id}/pay`, d));
const archPO = id => ask('Archiver cet achat soldé ?', () => act(`/purchases/${id}/archive`));
const cancPO = id => form('Annuler la commande', [['reason', 'Motif (obligatoire)']], {}, d => act(`/purchases/${id}/cancel`, d));
/* ---------- caisse, alertes, audit, utilisateurs ---------- */
async function vCaisse() {
  const [rg, mv] = await Promise.all([G('/cash/registers'), G('/cash/movements')]);
  return `<div class="cards">${rg.map(x => `<div class="card"><small>${esc(x.name)}</small><b>${f(x.balance)}</b></div>`).join('')}</div><div class="bar">${can('expense.create') ? `<button onclick="addX()">Nouvelle dépense</button>` : ''}${can('cash.manage') ? `<button class="b2" onclick="addM()">Mouvement de caisse</button>` : ''}</div>` + T(['Date', 'Type', 'Libellé', 'Montant'], mv.map(x => [dt(x.created_at), x.kind, esc(x.label), f(x.amount)]));
}
const addX = () => { notifyIfPastShift(); form('Dépense', [['category', 'Catégorie', 's', ['Carburant véhicule', 'Électricité', 'Eau', 'Salaires', 'Maintenance', 'Transport', 'Fournitures', 'Sécurité', 'Autres']], ['amount', 'Montant', 'number'], ['method', 'Mode', 's', pmOpts(['credit'])], ['beneficiary', 'Bénéficiaire'], ['comment', 'Commentaire']], {}, async d => { await Po('/expenses', d); closeM(); go(cur, arg); }); };
const addM = async () => {
  let accOpts = [];
  try {
    const accs = await G('/money/accounts');
    accOpts = (accs || []).filter(a => a.active !== false).map(a => [String(a.id), (a.kind || '') + ' — ' + a.name]);
  } catch (e) { /* comptes optionnels si non autorisé */ }
  form('Mouvement de caisse', [
    ['kind', 'Type', 's', ['encaissement', 'decaissement', 'depot_bancaire', 'retrait']],
    ['amount', 'Montant', 'number'],
    ['label', 'Libellé'],
    ...(accOpts.length ? [['account_id', 'Compte (obligatoire si dépôt/retrait banque)', 's', accOpts]] : [])
  ], {}, async d => {
    if ((d.kind === 'depot_bancaire' || d.kind === 'retrait') && !d.account_id) {
      toast('Sélectionnez le compte bancaire / Mobile Money pour un dépôt ou un retrait.', 'error');
      return;
    }
    if (d.account_id) d.account_id = Number(d.account_id);
    await Po('/cash/movements', d);
    closeM();
    go('caisse');
  });
};
async function vAlert() { const ls = await G('/notifications'); return T(['Date', 'Niveau', 'Message', ''], ls.map(n => [dt(n.created_at), `<span class="tag ${n.level == 'info' ? '' : 'x'}">${n.level}</span>`, esc(n.message), n.read_at ? '' : `<button class="b2" onclick="Po('/notifications/${n.id}/read').then(()=>go('alert'))">Lu</button>`])); }
async function vAudit() { const ls = await G('/audit'); const mo = new Date().toISOString().slice(0, 8) + '01', td = new Date().toISOString().slice(0, 10); return `<div class="bar"><input class="q" placeholder="Filtrer" oninput="flt(this)"><button class="b2" onclick="dlFile('/finance/audit?from=${mo}&to=${td}&format=pdf','audit')">Rapport PDF (mois)</button><button class="b2" onclick="dlFile('/finance/audit?from=${mo}&to=${td}&format=xlsx','audit')">Excel</button></div>` + T(['Date', 'Utilisateur', 'Module', 'Action', 'Avant', 'Après'], ls.map(a => [dts(a.created_at), esc(a.login), esc(a.module), esc(a.action), esc(a.old_value ? JSON.stringify(a.old_value) : ''), esc(a.new_value ? JSON.stringify(a.new_value) : '')])); }
async function vParam() {
  const us = await G('/users');
  const consistency = typeof roleConsistencyBanner === 'function' ? await roleConsistencyBanner().catch(() => '') : '';
  const canManageUsers = can('user.manage');
  // role.assign OU user.manage (Gérant) peut changer le rôle
  const canAssignRoles = can('role.assign') || canManageUsers;

  const actions = u =>
    (canManageUsers && u.failed_logins >= 5 ? `<button class="b2" onclick="Po('/users/${u.id}/unlock').then(()=>go('param'))">Débloquer</button> ` : '') +
    (canManageUsers && canTouchUser(u) ? `<button class="b2" onclick="typeof editUserProfile==='function'&&editUserProfile(${Number(u.id)},${jsArg(u.login)},${jsArg(u.full_name||'')},${jsArg(u.job_title||'')},${!!u.active})">Modifier</button> ` : '') +
    (canAssignRoles && canTouchUser(u) && !isSelfUser(u) ? `<button class="b2" onclick="typeof changeUserRole==='function'?changeUserRole(${Number(u.id)},${jsArg(u.login)},${jsArg(u.role)}):toast('Fonction rôle indisponible','error')">Rôle</button>` : '');

  return consistency + `<div class="bar">
    ${canManageUsers ? '<button onclick="addU()">Ajouter un utilisateur</button>' : ''}
   ${canManageUsers ? `<button class="b2" onclick="go(ME&&ME.is_global?'roles':'teamroles')">Gérer les rôles</button>` : ''}
  </div>` +
    T(['Identifiant', 'Rôle', 'Échecs', 'Dernière connexion', ''],
      us.map(u => [esc(u.login), u.role, u.failed_logins, dt(u.last_login_at), actions(u)]));
}
/* addU délégué à window.addU (ext-roles.js) — exige employee_id */
const addU = (...args) => { if (typeof window.addU === 'function') return window.addU(...args); toast('Module rôles non chargé', 'error'); };
/* ---------- navigation et session ---------- */
const NAVOF = { clot: 'quart', rapq: 'quart', empf: 'emp' }, TITLES = { clot: 'Clôture du quart', rapq: 'Rapport de quart', empf: 'Fiche employé' };
const VM = { dash: vDash, quart: vQuart, clot: vClot, rapq: vRapq, ventes: vVentes, prod: vProd, pompes: vPompes, cli: vCli, four: vFour, emp: vEmp, caisse: vCaisse, alert: vAlert, audit: vAudit, param: vParam };
/** Historique SPA pour le bouton Retour (toutes interfaces SuperAdmin + client). */
const NAV_HISTORY = [];
const MAX_NAV_HISTORY = 40;
let __navSilent = false;
function updateBackBtn() {
  const btn = document.getElementById('nav-back');
  if (!btn) return;
  const canBack = NAV_HISTORY.length > 0;
  btn.disabled = !canBack;
  btn.style.opacity = canBack ? '1' : '0.45';
  btn.title = canBack ? 'Retour à la page précédente' : 'Aucune page précédente';
}
window.updateBackBtn = updateBackBtn;
window.goBack = async function () {
  if (!NAV_HISTORY.length) {
    const home = typeof defaultView === 'function' ? defaultView() : (ME?.is_global ? 'admin' : 'dash');
    return go(home);
  }
  const prev = NAV_HISTORY.pop();
  updateBackBtn();
  __navSilent = true;
  try { await go(prev.k, prev.a); } finally { __navSilent = false; }
};
async function go(k, a) {
  const navEpoch = ++NAV_EPOCH;
  // Empiler la vue courante avant changement (sauf retour arrière)
  if (!__navSilent && cur && (cur !== k || arg !== a)) {
    const last = NAV_HISTORY[NAV_HISTORY.length - 1];
    if (!last || last.k !== cur || last.a !== arg) {
      NAV_HISTORY.push({ k: cur, a: arg });
      if (NAV_HISTORY.length > MAX_NAV_HISTORY) NAV_HISTORY.shift();
    }
  }
  cur = k; arg = a; const on = NAVOF[k] || k;
  // Navigation latérale avec icônes
  if (typeof renderNav === 'function') renderNav(on);   // menu vertical à sous-menus flottants (ext-shell.js)
  else {
    // Toujours filtrer via canView (respecte SUPERADMIN_VIEWS / GLOBAL_ONLY_VIEWS)
    const items = Object.keys(V).filter(x => canView(x));
    $('#nav').innerHTML = '<h1><span class="logo" data-brand="mark">' + brandMarkInner() + '</span><span data-brand="name">' + esc(brandName()) + '</span></h1>' +
      items.map(x => `<a class="${x == on ? 'on' : ''}" onclick="go('${x}')"><span class="ico">${NAV_ICONS[x] || '•'}</span><span class="nav-label">${V[x][0]}</span></a>`).join('');
  }
  // Bottom nav mobile
  const bn = $('#bottom-nav');
  if (bn) {
    bn.innerHTML = (ME?.is_global ? ['admin', 'clients', 'pfin'] : BOTTOM_KEYS).filter(x => canView(x)).map(x =>
      `<a class="${x == on ? 'on' : ''}" onclick="go('${x}')"><span class="ico">${NAV_ICONS[x] || '•'}</span>${V[x][0].split(' ')[0]}</a>`
    ).join('');
  }
  $('#ttl').textContent = (V[k] || [TITLES[k] || 'Rapport de quart'])[0];
  $('#pg').innerHTML = skeleton();
  try {
    // Sous-vues (clot, rapq, empf…) absentes de V mais présentes dans VM + NAVOF/TITLES.
    // Autorisées si le parent (ex. quart) est visible — corrige la redirection abusive vers le Dashboard.
    const isSubView = !V[k] && typeof VM[k] === 'function' && (NAVOF[k] || TITLES[k]);
    const parentKey = NAVOF[k];
    const allowed = isSubView
      ? (parentKey ? canView(parentKey) : true)
      : (canView(k) && typeof VM[k] === 'function');
    if (!allowed || typeof VM[k] !== 'function') {
      const safeView = defaultView();
      if (safeView !== k) return await go(safeView);
      return;
    }
    const html = await VM[k]();
    if (navEpoch !== NAV_EPOCH) return;
    $('#pg').innerHTML = html;
    $('#pg').classList.add('fade-in');
  } catch (e) {
    if (navEpoch !== NAV_EPOCH || e?.stale || e?.code === 'STALE_STATION_RESPONSE') return;
    if (accessError(e)) { const safeView = defaultView(); if (safeView !== k) return await go(safeView); return; }
    $('#pg').innerHTML = `<p style="color:var(--r)">${esc(errMsg(e))}</p>`;
    toast(errMsg(e), 'error');
  }
  if (window.hydrateImages) hydrateImages();
  updateBackBtn();
  scrollTo(0, 0);
}
function stationOptions() {
  const sel = $('#stsel');
  if (!sel) return;
  const stations = Array.isArray(ME?.stations) ? ME.stations : [];
  sel.style.display = !ME?.is_global && stations.length > 1 ? '' : 'none';
  sel.innerHTML = stations.map(s => `<option value="${esc(s.id)}" ${String(s.id) === String(SID) ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  sel.disabled = !!ME?.is_global || stations.length < 2;
}
async function chSt(v) {
  // La sélection côté navigateur n'accorde aucun droit : seuls les identifiants déjà présents dans /me sont recevables.
  const next = (Array.isArray(ME?.stations) ? ME.stations : []).find(s => String(s.id) === String(v));
  if (ME?.is_global || !next) {
    stationOptions();
    toast('Cette station ne fait pas partie de vos accès.', 'error');
    return;
  }
  if (String(next.id) === String(SID)) return;
  SID = String(next.id);
  STATION_EPOCH++;
  NAV_HISTORY.length = 0;
  CUR = String(next.currency || 'FCFA').trim();
  keep();
  stationOptions();
  // Retirer immédiatement l'ancien contenu métier pendant le rechargement.
  const pg = $('#pg');
  if (pg) pg.innerHTML = skeleton();
  try {
    if (window.applyAppearance) await applyAppearance();
    if (window.loadPersonalTheme) await loadPersonalTheme();
    if (window.loadPersonalMotion) await loadPersonalMotion();
    await go(cur || defaultView());
  } catch (e) {
    // Si la station a encore changé entre-temps, l'erreur appartient à une transition périmée.
    if (e?.stale || e?.code === 'STALE_STATION_RESPONSE') return;
    toast('Impossible de charger cette station : ' + errMsg(e), 'error');
  }
}
async function boot() {
  // Nettoyer l'écran C2 éventuel avant d'initialiser une nouvelle session.
  document.getElementById('expired-subscription-screen')?.remove();
  document.getElementById('bottom-nav')?.removeAttribute('hidden');
  // Toujours recharger le profil depuis le serveur — jamais réutiliser un ME en mémoire
  // d'une session précédente (corrige la confusion de rôles entre comptes successifs).
  ME = await G('/me');
  if (!ME.is_global && typeof window.showExpiredSubscriptionScreen === 'function') {
    const blockedByExpiredLicense = await window.showExpiredSubscriptionScreen();
    if (blockedByExpiredLicense) return;
  }
  if (!ME.is_global && !ME.stations.length) throw new Error('Aucune station accessible');
  if (!ME.is_global) {
    // Ne jamais conserver un SID d'un autre compte : si le SID stocké n'appartient pas
    // à ce profil, on bascule sur la première station autorisée.
    if (!SID || !ME.stations.find(s => s.id == SID)) SID = ME.stations[0].id;
    CUR = ME.stations.find(s => s.id == SID).currency.trim();
  } else {
    // SuperAdmin = compte plateforme : aucune station, SID strictement null
    SID = null;
    CUR = 'FCFA';
  }
  keep();
  $('#login').innerHTML = '';
  $('#app').style.display = 'flex';
  $('#app').classList.add('ready');
  // Vider la navigation précédente avant reconstruction (évite menus du compte antérieur)
  try {
    const nav = document.getElementById('nav');
    if (nav) nav.innerHTML = '';
    const bn = document.getElementById('bn');
    if (bn) bn.innerHTML = '';
  } catch (e) {}
  stationOptions();
  // Libellés propres au Superadmin (les autres rôles gardent les libellés d'origine)
  if (ME.is_global) { if (V.admin) V.admin = ['Tableau de bord plateforme', V.admin[1]]; if (V.clients) V.clients = ['Comptes clients & licences', V.clients[1]]; }
  // L'apparence dépend d'une station : le Superadmin n'en a pas (/appearance lui est refusé). Un échec secondaire ne doit jamais bloquer l'interface.
  const soft = async fn => { try { await fn(); } catch (e) { console.warn('[boot]', e && e.message); } };
  if (!ME.is_global && window.applyAppearance) await soft(applyAppearance);
  else if (ME.is_global && window.paint) await soft(async () => paint(AP.theme));
  if (window.loadPersonalTheme) await soft(loadPersonalTheme);
  if (window.loadPersonalMotion) await soft(loadPersonalMotion);
  if (window.initShell) await soft(async () => initShell());   // barre supérieure : profil réel, date/heure, alertes
  // Recherche globale
  setupGlobalSearch();
  // Raccourcis clavier
  setupKeyboardShortcuts();
  if (ME.is_global && typeof VM.admin === 'function') go('admin');
  else if (ME.successful_login_count <= 3 && typeof VM.onboard === 'function' && !localStorage.getItem('smp-onboard-done-' + ME.id)) go('onboard');
  else if (!ME.is_global && typeof VM.direction === 'function' && (can('report.view') || can('finance.view') || can('user.manage'))) go(typeof canView === 'function' && canView('dash') && typeof VM.dash === 'function' ? 'dash' : 'direction');
  else go(defaultView());
}
function showLogin() {
  $('#app').style.display = 'none';
  $('#app').classList.remove('ready');
  $('#login').innerHTML = `<div class="login-shell">
    <aside class="login-brand">
      <div class="login-brand-inner">
        <div class="login-mark" data-brand="mark">${brandMarkInner()}</div>
        <h1 data-brand="name">${esc(brandName())}</h1>
        <p class="login-tagline" data-brand="tagline" ${BRAND.tagline ? '' : 'hidden'}>${esc(BRAND.tagline || '')}</p>
      </div>
      <small class="login-copy">© ${new Date().getFullYear()}</small>
    </aside>
    <section class="login-form-wrap">
      <div class="card login-card">
        <h2>Connexion</h2>
        <p style="margin:0 0 14px;color:var(--m);font-size:13px">Connectez-vous pour continuer</p>
        <label>Identifiant<input id="lu" autocomplete="username"></label>
        <label style="margin-top:10px">Mot de passe<input id="lp" type="password" autocomplete="current-password" onkeydown="if(event.key=='Enter')doLogin()"></label>
        <button style="width:100%;margin-top:16px" onclick="doLogin()">Se connecter</button>
        <button type="button" class="b2" data-pwa-install hidden onclick="pwaInstall()" style="width:100%;margin-top:10px">Installer l’application</button>
        <p style="font-size:11px;color:var(--m);margin:10px 0 0;text-align:center">PWA — fonctionne hors navigateur une fois installée (données toujours en ligne)</p>
      </div>
    </section>
  </div>`;
  loadBrand();   // l'identité à jour (nom, slogan, logo) remplace les valeurs par défaut dès sa réception
  // Afficher le bouton install si l'événement a déjà été capturé
  try { if (window.pwaInstall) document.querySelectorAll('[data-pwa-install]').forEach(() => {}); } catch (e) {}
}
async function doLogin() {
  try {
    // Toujours repartir d'un état mémoire propre avant d'accepter un nouveau compte
    // (évite la conservation du profil / des menus / du rôle de l'utilisateur précédent).
    resetInMemoryState();
    clearSession();
    const j = await api('POST', '/auth/login', { login: $('#lu').value.trim(), password: $('#lp').value });
    TK = j.token;
    keep();
    await boot();
  } catch (e) {
    toast(errMsg(e), 'error');
    if (/clé d.accès/i.test(e.message || '')) showLogin();   // laissez-passer expiré : retour à l'accueil pour ressaisir la clé
  }
}
async function logout() {
  try { await Po('/auth/logout'); } catch (e) {}
  // Révoque côté serveur déjà fait ; on efface tout côté client pour garantir
  // qu'un compte suivant dans le même navigateur ne hérite d'aucun état.
  resetInMemoryState();
  clearSession();
  document.body.classList.remove('focus-mode');
  // Vider le contenu de l'application pour éviter tout flash de données de l'ancien compte
  try {
    const pg = document.getElementById('pg');
    if (pg) pg.innerHTML = '';
    const nav = document.getElementById('nav');
    if (nav) nav.innerHTML = '';
    const bn = document.getElementById('bn');
    if (bn) bn.innerHTML = '';
  } catch (e) {}
  showLogin();
}

/* ---------- Recherche globale (palette Ctrl/⌘+K) ---------- */
let _gsResults = [];
let _gsIndex = -1;
let _gsTimer = null;

function setupGlobalSearch() {
  const input = $('#gs');
  const box = $('#search-results');
  if (!input || !box) return;
  input.setAttribute('placeholder', 'Rechercher… (Ctrl+K ou /)');
  input.addEventListener('input', () => {
    clearTimeout(_gsTimer);
    const q = input.value.trim();
    if (q.length < 2) {
      box.classList.remove('show');
      box.innerHTML = '';
      _gsResults = [];
      _gsIndex = -1;
      return;
    }
    _gsTimer = setTimeout(() => runSearch(q), 200);
  });
  input.addEventListener('keydown', e => {
    const box = $('#search-results');
    if (!box || !box.classList.contains('show')) {
      if (e.key === 'Escape') { input.blur(); }
      return;
    }
    const items = box.querySelectorAll('a[data-i]');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _gsIndex = Math.min(_gsIndex + 1, items.length - 1);
      gsHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _gsIndex = Math.max(_gsIndex - 1, 0);
      gsHighlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_gsIndex >= 0 && items[_gsIndex]) items[_gsIndex].click();
      else if (items[0]) items[0].click();
    } else if (e.key === 'Escape') {
      box.classList.remove('show');
      input.blur();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#global-search') && !e.target.closest('#gs-palette')) {
      box.classList.remove('show');
    }
  });
}

function gsHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('gs-active', i === _gsIndex));
  if (_gsIndex >= 0 && items[_gsIndex]) items[_gsIndex].scrollIntoView({ block: 'nearest' });
}

function openGlobalSearch() {
  const input = $('#gs');
  if (!input) return;
  input.focus();
  input.select();
  if (input.value.trim().length >= 2) runSearch(input.value.trim());
}

function gsNavigate(r) {
  const box = $('#search-results');
  if (box) box.classList.remove('show');
  const gs = $('#gs');
  if (gs) gs.value = '';
  try {
    if (r.action === 'showEmp' && typeof window.showEmp === 'function') {
      window.showEmp(r.arg || r.id);
      return;
    }
    if (r.action === 'billShow' && typeof window.billShow === 'function') {
      window.billShow(r.arg || r.id);
      return;
    }
    if (r.action === 'showShiftFull' && typeof window.showShiftFull === 'function') {
      window.showShiftFull(r.arg || r.id);
      return;
    }
    if (typeof r.action === 'function') {
      r.action();
      return;
    }
    if (r.go) {
      if (r.arg != null && r.arg !== '') go(r.go, r.arg);
      else go(r.go);
    }
  } catch (e) {
    toast(typeof errMsg === 'function' ? errMsg(e) : (e.message || String(e)), 'error');
  }
}

async function runSearch(q) {
  const box = $('#search-results');
  if (!box) return;
  q = String(q || '').trim();
  if (q.length < 2) {
    box.classList.remove('show');
    return;
  }
  box.innerHTML = '<div class="gs-empty">Recherche…</div>';
  box.classList.add('show');
  _gsResults = [];
  _gsIndex = -1;

  // 1) Menus locaux (instantané)
  const menuHits = [];
  try {
    Object.keys(V || {}).filter(k => typeof canView === 'function' ? canView(k) : true).forEach(k => {
      const title = (V[k] && V[k][0]) || k;
      if (title.toLowerCase().includes(q.toLowerCase())) {
        menuHits.push({ type: 'Menu', label: title, sub: '', go: k });
      }
    });
  } catch (_) {}

  // 2) API serveur
  let apiHits = [];
  try {
    const data = await G('/search?q=' + encodeURIComponent(q));
    apiHits = (data && data.results) || [];
  } catch (e) {
    // Repli client si API indisponible
    try {
      if (!ME?.is_global) {
        if (can('sale.create') || can('report.view') || can('stock.adjust')) {
          const prods = await G('/products').catch(() => []);
          prods.filter(p => ((p.name || '') + (p.barcode || '') + (p.sku || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 6)
            .forEach(p => apiHits.push({ type: 'Produit', label: p.name, sub: 'stock ' + (typeof fl === 'function' ? fl(p.stock) : p.stock), go: 'prodf', arg: p.id }));
        }
        if (can('customer.view') || can('sale.create')) {
          const clients = await G('/customers').catch(() => []);
          clients.filter(c => ((c.name || '') + (c.phone || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 5)
            .forEach(c => apiHits.push({ type: 'Client', label: c.name, sub: c.phone || '', go: 'clidet', arg: c.id }));
        }
      }
    } catch (_) {}
  }

  _gsResults = [...menuHits, ...apiHits].slice(0, 20);
  if (!_gsResults.length) {
    box.innerHTML = '<div class="gs-empty">Aucun résultat pour « ' + esc(q) + ' »</div>';
    return;
  }
  box.innerHTML = _gsResults.map((r, i) =>
    `<a href="#" data-i="${i}" class="gs-item" role="option">` +
    `<span class="sr-type">${esc(r.type || '')}</span>` +
    `<span class="gs-label">${esc(r.label || '')}</span>` +
    (r.sub ? `<span class="gs-sub">${esc(r.sub)}</span>` : '') +
    `</a>`
  ).join('');
  box.querySelectorAll('a[data-i]').forEach((el, i) => {
    el.addEventListener('click', ev => {
      ev.preventDefault();
      gsNavigate(_gsResults[i]);
    });
    el.addEventListener('mouseenter', () => {
      _gsIndex = i;
      gsHighlight(box.querySelectorAll('a[data-i]'));
    });
  });
  _gsIndex = 0;
  gsHighlight(box.querySelectorAll('a[data-i]'));
}

/* ---------- Raccourcis clavier ---------- */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Palette globale : Ctrl+K / ⌘+K (même depuis un champ)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      openGlobalSearch();
      return;
    }
    // Ignorer si on tape dans un champ (sauf / déjà géré plus haut pour gs)
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const gs = $('#gs');
      if (gs) { gs.focus(); gs.select(); }
      return;
    }
    if (e.key === 'n' && can('sale.create')) { e.preventDefault(); if (typeof addS === 'function') addS(); }
    if (e.key === 'q') { e.preventDefault(); go('quart'); }
    if (e.key === 'd') { e.preventDefault(); go('dash'); }
    if (e.key === 'f' && e.shiftKey) { e.preventDefault(); toggleFocusMode(); }
  });
}

// Démarrage après chargement de TOUS les scripts d'extension (ext-*.js) : sinon, avec une réponse /me rapide, le premier affichage
// pouvait se faire avant l'enregistrement de leurs vues et de la navigation (course au chargement).
const start = () => { loadBrand(); TK ? boot().catch(showLogin) : showLogin(); };
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
