/* home-core.js — moteur de la page d'accueil publique (partagé serveur + navigateur).
   Une page = une liste de sections ; chaque section = un arbre d'éléments (box, text, button, image, icon, mockup).
   Chaque élément porte un style de bureau (s), des surcharges tablette (st ≤1000 px) et mobile (sm ≤600 px).
   Aucune injection possible : seules des valeurs validées (couleurs, nombres, listes fermées) deviennent du CSS,
   et tout texte est échappé. Le modèle par défaut reproduit à l'identique le fichier station-manager-pro-accueil.html. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HomeCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- constantes */
  const TOKENS = { primary: '#087cff', accent: '#16c8ff', navy: '#04152f', navy2: '#06234a', ink: '#0b2144', muted: '#526581', paper: '#f3f7fc', white: '#ffffff' };
  const TOKEN_LABEL = { primary: 'Principale', accent: 'Accent', navy: 'Marine', navy2: 'Marine 2', ink: 'Texte', muted: 'Texte discret', paper: 'Fond de page', white: 'Blanc' };
  const FONTS = {
    sans: 'Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Arial,sans-serif',
    serif: 'Georgia,"Times New Roman",Times,serif',
    mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
    rounded: '"Trebuchet MS","Segoe UI",Verdana,sans-serif',
    condensed: '"Arial Narrow","Roboto Condensed",Arial,sans-serif'
  };
  const FONT_LABEL = { sans: 'Moderne (Inter / système)', serif: 'Classique (Georgia)', mono: 'Technique (monospace)', rounded: 'Arrondie', condensed: 'Condensée' };
  const BUILTIN_IMAGES = { dflt_hero: '/home-default-hero.webp' };
  const BP = { tablet: 1000, mobile: 600 };
  const NODE_TYPES = ['section', 'box', 'text', 'button', 'image', 'icon', 'mockup'];
  const CONTAINERS = ['section', 'box'];
  const LIMITS = { nodes: 900, depth: 9, sections: 60, children: 120, images: 300 };

  const COLOR_RE = /^(#[0-9a-f]{6}([0-9a-f]{2})?|transparent|@(primary|accent|navy|navy2|ink|muted|paper|white))$/i;
  const SIZE_RE = /^(auto|fit-content|-?\d{1,4}(\.\d{1,2})?(px|%|vw|vh|rem|em)?)$/;
  const POS_RE = /^((left|center|right|top|bottom|\d{1,3}%)( |$)){1,2}$/;
  const TPL_RE = /^[0-9a-z.%,() \-]{1,80}$/i;
  const ID_RE = /^[a-z0-9_]{1,24}$/;
  const HREF_RE = /^(|action:login|#[a-z0-9_-]{1,40}|https?:\/\/[^\s"'<>\\]{1,280}|mailto:[^\s"'<>\\]{3,220}|tel:[+0-9 ().-]{3,30})$/i;

  const NUM = (min, max, step) => ({ t: 'num', min, max, step: step || 1 });
  const ENUM = (en) => ({ t: 'enum', en });
  const COL = { t: 'color' }, BOOL = { t: 'bool' }, SIZE = { t: 'size' };
  /* Spécification unique de tous les réglages de style (sert à valider, à produire le CSS et à bâtir le panneau). */
  const STYLE = {
    color: COL, fs: NUM(8, 200), fw: ENUM(['300', '400', '500', '600', '700', '800', '900']), lh: NUM(0.8, 3, 0.05), ls: NUM(-8, 30, 0.1),
    ta: ENUM(['left', 'center', 'right', 'justify']), tt: ENUM(['none', 'uppercase', 'capitalize', 'lowercase']), ff: ENUM(Object.keys(FONTS)),
    fst: ENUM(['normal', 'italic']), td: ENUM(['none', 'underline']), ac: COL, hc: COL, nw: BOOL,
    bgT: ENUM(['none', 'color', 'gradient']), bg: COL, gr: { t: 'stops' }, ang: NUM(0, 360),
    bgImg: { t: 'img' }, bgSz: ENUM(['cover', 'contain', 'auto']), bgPs: { t: 'pos' }, bgIo: NUM(0, 1, 0.01), ovg: { t: 'stops' }, ova: NUM(0, 360),
    d: ENUM(['block', 'row', 'column', 'grid']), cols: NUM(1, 12), tpl: { t: 'tpl' }, ai: ENUM(['start', 'center', 'end', 'stretch']), jc: ENUM(['start', 'center', 'end', 'between', 'around']), wrap: BOOL, gap: NUM(0, 240),
    pt: NUM(0, 400), pr: NUM(0, 400), pb: NUM(0, 400), pl: NUM(0, 400), mt: NUM(-200, 400), mr: NUM(-200, 400), mb: NUM(-200, 400), ml: NUM(-200, 400), ctr: BOOL,
    w: SIZE, mw: SIZE, h: SIZE, mh: SIZE,
    rad: NUM(0, 999), bw: NUM(0, 30), bt: NUM(0, 30), br: NUM(0, 30), bb: NUM(0, 30), bl: NUM(0, 30), bc: COL, bst: ENUM(['solid', 'dashed', 'dotted']),
    shx: NUM(-200, 200), shy: NUM(-200, 200), shb: NUM(0, 300), shs: NUM(-100, 200), shc: COL, op: NUM(0, 1, 0.01),
    rx: NUM(-180, 180), ry: NUM(-180, 180), rz: NUM(-180, 180), scl: NUM(0.1, 3, 0.01), hv: ENUM(['none', 'lift', 'grow']),
    pos: ENUM(['static', 'relative', 'absolute', 'sticky', 'fixed']), top: SIZE, right: SIZE, bottom: SIZE, left: SIZE, z: NUM(-10, 200), ovf: ENUM(['visible', 'hidden', 'auto']), ord: NUM(-10, 10),
    hid: BOOL
  };
  const TEXT_TAGS = ['h1', 'h2', 'h3', 'h4', 'p', 'span', 'div', 'small', 'strong', 'em'];
  const BOX_TAGS = ['div', 'section', 'header', 'footer', 'main', 'nav', 'article', 'aside'];
  const BTN_VARIANTS = ['primary', 'outline', 'white', 'plain'];
  const BURGER_MODES = ['', 'none', 'tablet', 'mobile'];   // menu ☰ : aucun · tablette et mobile (≤ 1000 px) · mobile seul (≤ 600 px)

  /* ---------------------------------------------------------------- utilitaires */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  function uid(taken) {
    for (let i = 0; i < 50; i++) { const id = 'n' + Math.random().toString(36).slice(2, 8); if (!taken || !taken.has(id)) { if (taken) taken.add(id); return id; } }
    return 'n' + Date.now().toString(36);
  }
  function walk(nodes, fn, parent) { (nodes || []).forEach((n, i) => { if (fn(n, parent, i) !== false && n.c) walk(n.c, fn, n); }); }
  function find(doc, id) { let r = null; walk(doc.nodes, (n, parent, i) => { if (n.id === id) { r = { node: n, parent, list: parent ? parent.c : doc.nodes, index: i }; return false; } }); return r; }
  function ids(doc) { const s = new Set(); walk(doc.nodes, n => { s.add(n.id); }); return s; }
  function reId(node, taken) { walk([node], n => { n.id = uid(taken); }); return node; }

  /* ---------------------------------------------------------------- validation */
  const bad = (m) => { const e = new Error(m); e.status = 400; throw e; };
  function cleanColor(v, k) { if (typeof v !== 'string' || !COLOR_RE.test(v)) bad('Couleur invalide (' + k + ')'); return v.toLowerCase(); }
  function cleanStops(v, k) {
    if (!Array.isArray(v) || v.length < 2 || v.length > 6) bad('Dégradé invalide (' + k + ') : 2 à 6 couleurs');
    return v.map(s => ({ c: cleanColor(s && s.c, k), p: Math.max(0, Math.min(100, Math.round(Number(s && s.p) || 0))) }));
  }
  function cleanStyle(src, where) {
    const out = {};
    if (src == null) return out;
    if (typeof src !== 'object' || Array.isArray(src)) bad('Style invalide (' + where + ')');
    for (const k of Object.keys(src)) {
      const spec = STYLE[k], v = src[k];
      if (!spec || v === undefined || v === null || v === '') continue;     // clé inconnue ou vide : ignorée
      switch (spec.t) {
        case 'color': out[k] = cleanColor(v, k); break;
        case 'num': { const x = Number(v); if (!isFinite(x)) bad('Nombre invalide (' + k + ')'); out[k] = Math.max(spec.min, Math.min(spec.max, Math.round(x * 100) / 100)); break; }
        case 'enum': if (!spec.en.includes(String(v))) bad('Valeur invalide (' + k + ')'); out[k] = String(v); break;
        case 'bool': out[k] = !!v; break;
        case 'size': { const s = typeof v === 'number' ? String(v) : String(v).trim(); if (!SIZE_RE.test(s)) bad('Dimension invalide (' + k + ')'); out[k] = s; break; }
        case 'img': if (typeof v !== 'string' || !ID_RE.test(v)) bad('Image invalide (' + k + ')'); out[k] = v; break;
        case 'pos': if (typeof v !== 'string' || !POS_RE.test(v)) bad('Position invalide (' + k + ')'); out[k] = v; break;
        case 'tpl': if (typeof v !== 'string' || !TPL_RE.test(v) || /url|expression|var\(/i.test(v)) bad('Colonnes invalides (' + k + ')'); out[k] = v.trim(); break;
        case 'stops': out[k] = cleanStops(v, k); break;
      }
    }
    return out;
  }
  const str = (v, max) => String(v == null ? '' : v).slice(0, max);
  function cleanHref(v) { const s = String(v == null ? '' : v).trim(); if (!HREF_RE.test(s)) bad('Lien non autorisé : utilisez http(s)://, mailto:, tel:, #ancre ou « Connexion »'); return s; }
  function cleanImgId(v) { const s = String(v == null ? '' : v); if (s && !ID_RE.test(s)) bad('Identifiant d’image invalide'); return s; }
  function cleanMockup(p) {
    p = p || {};
    const arr = (a, max, fn) => (Array.isArray(a) ? a.slice(0, max).map(fn) : []);
    return {
      brand: str(p.brand, 60), right: str(p.right, 60), sideTitle: str(p.sideTitle, 40), hello: str(p.hello, 80), sub: str(p.sub, 120), c1: str(p.c1, 60), c2: str(p.c2, 60), ring: str(p.ring, 8),
      side: arr(p.side, 14, x => str(x, 30)), active: Math.max(0, Math.min(13, parseInt(p.active, 10) || 0)),
      metrics: arr(p.metrics, 4, m => ({ l: str(m && m.l, 40), v: str(m && m.v, 20), e: str(m && m.e, 40) })),
      bars: arr(p.bars, 14, x => Math.max(2, Math.min(100, Math.round(Number(x) || 0))))
    };
  }
  function cleanProps(t, p) {
    p = p || {};
    const o = {};
    if (p.an !== undefined && p.an !== '') { if (!/^[a-z0-9_-]{1,40}$/.test(String(p.an))) bad('Ancre invalide (lettres minuscules, chiffres, - et _)'); o.an = String(p.an); }
    if (p.nm) o.nm = str(p.nm, 40);
    if (p.href) o.href = cleanHref(p.href);
    if (t === 'section' || t === 'box') { const tag = p.tag || (t === 'section' ? 'section' : 'div'); if (!BOX_TAGS.includes(tag)) bad('Balise invalide'); o.tag = tag; }
    if (t === 'box' && p.burger !== undefined && p.burger !== null) { if (!BURGER_MODES.includes(String(p.burger))) bad('Menu burger invalide'); if (p.burger === 'tablet' || p.burger === 'mobile') o.burger = p.burger; }
    if (t === 'text') { o.tx = str(p.tx, 3000); const tag = p.tag || 'p'; if (!TEXT_TAGS.includes(tag)) bad('Balise invalide'); o.tag = tag; }
    if (t === 'button') { o.lb = str(p.lb, 80); const v = p.vr || 'primary'; if (!BTN_VARIANTS.includes(v)) bad('Style de bouton invalide'); o.vr = v; }
    if (t === 'image') { o.src = cleanImgId(p.src); o.alt = str(p.alt, 160); o.fit = ['cover', 'contain', 'fill'].includes(p.fit) ? p.fit : 'cover'; }
    if (t === 'icon') { o.gl = str(p.gl, 12); o.src = cleanImgId(p.src); }
    if (t === 'mockup') o.m = cleanMockup(p.m);
    return o;
  }
  /* Anciennes pages : le menu (tablette) et « Se connecter » (mobile) étaient masqués sans alternative.
     On ne corrige que la signature exacte de l'ancien modèle ; un en-tête déjà retouché n'est pas modifié. */
  function upgradeLegacyHeader(doc) {
    let changed = false;
    const hdr = (doc.nodes || []).find(n => n && n.t === 'section' && n.p && n.p.tag === 'header');
    const bar = hdr && Array.isArray(hdr.c) && hdr.c[0];
    if (!bar || !Array.isArray(bar.c)) return doc;
    const menu = bar.c.find(n => n && n.p && n.p.nm === 'Menu' && n.st && n.st.hid === true);
    const login = (function f(list) { for (const n of list || []) { if (n && n.t === 'button' && n.p && n.p.href === 'action:login') return n; const r = f(n && n.c); if (r) return r; } return null; })(bar.c);
    const btns = bar.c.find(n => n && n.p && n.p.nm === 'Boutons');
    if (!menu || !login || !login.sm || login.sm.hid !== true) return doc;
    const d = clone(doc), D = d.nodes.find(n => n.id === hdr.id), B = D.c[0];
    const M = B.c.find(n => n.id === menu.id), L = (function f(list) { for (const n of list) { if (n.id === login.id) return n; const r = n.c && f(n.c); if (r) return r; } return null; })(B.c);
    const X = btns && B.c.find(n => n.id === btns.id);
    delete M.st.hid; Object.assign(M.st, { ord: 2, w: '100%', ovf: 'auto', gap: 22, jc: 'start' }); M.sm = Object.assign({ gap: 18 }, M.sm || {});
    (M.c || []).forEach(t => { t.s = Object.assign({ nw: true }, t.s || {}); t.st = Object.assign({ pt: 6, pb: 6 }, t.st || {}); });
    delete L.sm.hid; L.sm = Object.assign({ w: '48%', pt: 10, pb: 10, pl: 10, pr: 10, fs: 11 }, L.sm);
    if (X) {
      X.st = Object.assign({ ord: 1 }, X.st || {}); X.sm = Object.assign({ w: '100%', jc: 'between', gap: 8 }, X.sm || {});
      (X.c || []).forEach(b => { if (b.t === 'button') { b.sm = Object.assign({ w: '48%', pt: 10, pb: 10, pl: 10, pr: 10 }, b.sm || {}); } });
    }
    if (B.s && B.s.h === '78px') { delete B.s.h; B.s.mh = '78px'; }
    B.s = Object.assign({ wrap: true }, B.s || {});
    B.st = Object.assign({ mh: '0', pt: 10, pb: 10, gap: 10 }, B.st || {});
    B.sm = Object.assign({}, B.sm || {}); if (B.sm.h === '68px') delete B.sm.h;
    (X ? X.c || [] : []).forEach(b => { if (b.t === 'button') { b.s = Object.assign({ nw: true }, b.s || {}); b.sm = Object.assign({ nw: false }, b.sm || {}); } });
    const hero = d.nodes.find(n => n && n.p && n.p.an === 'accueil'), HC = hero && hero.c && hero.c[0];
    if (HC) { if (HC.st && HC.st.pt === 125) HC.st.pt = 150; if (HC.sm && HC.sm.pt === 110) HC.sm.pt = 175; }
    changed = true;
    return changed ? d : doc;
  }
  /* Pages enregistrées avec l'en-tête de la version précédente (barre qui passe à la ligne, menu défilant) : si l'en-tête est encore
     STRICTEMENT identique au modèle de l'époque (comparaison de structure, identifiants ignorés), il est remplacé par le modèle actuel
     (fixe en haut + menu burger) et les marges du héro sont ajustées. Un en-tête déjà retouché n'est jamais modifié ;
     on peut l'activer à la main (Position → Fixe ; boîte Menu → Menu burger). */
  const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((a, key) => { a[key] = x[key]; return a; }, {}) : x));
  function structOf(n) {
    const o = { t: n.t, p: cleanProps(n.t, n.p), s: cleanStyle(n.s), st: cleanStyle(n.st), sm: cleanStyle(n.sm) };
    if (Array.isArray(n.c)) o.c = n.c.map(structOf);
    return o;
  }
  let SIG_V71 = null;
  function upgradeHeaderSticky(doc, force) {
    try {
      const idx = (doc.nodes || []).findIndex(n => n && n.t === 'section' && n.p && n.p.tag === 'header');
      if (idx < 0) return doc;
      if (!SIG_V71) { let i = 0; SIG_V71 = stable(structOf(builders(() => 'v' + (++i)).headerV71())); }
      const old = doc.nodes[idx];
      if (!force && stable(structOf(old)) !== SIG_V71) return doc;     // force : l'en-tête vient d'être reconstruit depuis l'ancien modèle non retouché
      const d = clone(doc), taken = ids(d);
      const fresh = builders(() => uid(taken)).header(); fresh.id = old.id;
      d.nodes[idx] = fresh;
      const hero = d.nodes.find(n => n && n.p && n.p.an === 'accueil'), HC = hero && hero.c && hero.c[0];
      if (HC) { if (HC.st && HC.st.pt === 150) HC.st.pt = 110; if (HC.sm && HC.sm.pt === 175) HC.sm.pt = 100; }
      return d;
    } catch (_) { return doc; }
  }
  function sanitize(doc) {
    if (!doc || typeof doc !== 'object' || doc.v !== 2) bad('Document de page d’accueil invalide (version 2 attendue)');
    const legacyFixed = upgradeLegacyHeader(doc);
    doc = upgradeHeaderSticky(legacyFixed, legacyFixed !== doc);
    const seen = new Set(); let count = 0;
    const cleanNode = (n, depth, top) => {
      if (!n || typeof n !== 'object') bad('Élément invalide');
      if (++count > LIMITS.nodes) bad('Page trop volumineuse (900 éléments maximum)');
      if (depth > LIMITS.depth) bad('Imbrication trop profonde');
      if (typeof n.id !== 'string' || !ID_RE.test(n.id)) bad('Identifiant d’élément invalide');
      if (seen.has(n.id)) bad('Identifiant d’élément en double : ' + n.id);
      seen.add(n.id);
      if (!NODE_TYPES.includes(n.t)) bad('Type d’élément invalide');
      if (top && n.t !== 'section') bad('Seules des sections sont autorisées à la racine');
      const out = { id: n.id, t: n.t, p: cleanProps(n.t, n.p), s: cleanStyle(n.s, n.id), st: cleanStyle(n.st, n.id), sm: cleanStyle(n.sm, n.id) };
      if (CONTAINERS.includes(n.t)) {
        const c = Array.isArray(n.c) ? n.c : [];
        if (c.length > (top ? LIMITS.children : LIMITS.children)) bad('Trop d’éléments dans un même bloc');
        out.c = c.map(x => cleanNode(x, depth + 1, false));
      }
      return out;
    };
    const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
    if (nodes.length > LIMITS.sections) bad('60 sections maximum');
    const th = doc.theme || {}, theme = {};
    Object.keys(TOKENS).forEach(k => { theme[k] = th[k] !== undefined ? cleanColor(th[k], 'thème ' + k) : TOKENS[k]; if (theme[k][0] === '@' || theme[k].length !== 7) bad('Couleur de thème invalide (' + k + ')'); });
    theme.font = FONTS[th.font] ? th.font : 'sans';
    const meta = doc.meta || {};
    return { v: 2, meta: { title: str(meta.title, 120), description: str(meta.description, 300) }, theme, nodes: nodes.map(n => cleanNode(n, 1, true)) };
  }

  /* ---------------------------------------------------------------- CSS */
  const cv = c => (c && c[0] === '@' ? 'var(--' + c.slice(1) + ')' : c);
  const px = v => (typeof v === 'number' ? v + 'px' : (/^-?[\d.]+$/.test(String(v)) ? v + 'px' : v));
  const gradCss = (stops, ang) => 'linear-gradient(' + (ang == null ? 180 : ang) + 'deg,' + stops.map(s => cv(s.c) + ' ' + s.p + '%').join(',') + ')';
  const FLEXJ = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around' };
  const AIMAP = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' };
  const DEFAULT_DISPLAY = { section: 'block', box: 'block', text: 'block', button: 'inline-flex', image: 'block', icon: 'grid', mockup: 'block' };
  function displayOf(n, e) {
    if (n.t === 'section' || n.t === 'box') return e.d === 'row' || e.d === 'column' ? 'flex' : e.d === 'grid' ? 'grid' : 'block';
    return DEFAULT_DISPLAY[n.t];
  }
  const has = (L, ...ks) => ks.some(k => Object.prototype.hasOwnProperty.call(L, k));

  /* Déclarations CSS d'une couche (L = clés réellement définies à ce niveau, e = style effectif cumulé). */
  function decls(n, e, L) {
    const o = [];
    const add = (p, v) => o.push(p + ':' + v);
    if (has(L, 'hid')) { if (e.hid) { o.push('display:none!important'); return o; } o.push('display:' + displayOf(n, e) + '!important'); }
    if (has(L, 'color')) add('color', cv(e.color));
    if (has(L, 'fs')) add('font-size', e.fs + 'px');
    if (has(L, 'fw')) add('font-weight', e.fw);
    if (has(L, 'lh')) add('line-height', e.lh);
    if (has(L, 'ls')) add('letter-spacing', e.ls + 'px');
    if (has(L, 'ta')) add('text-align', e.ta);
    if (has(L, 'tt')) add('text-transform', e.tt);
    if (has(L, 'ff')) add('font-family', FONTS[e.ff] || FONTS.sans);
    if (has(L, 'fst')) add('font-style', e.fst);
    if (has(L, 'td')) add('text-decoration', e.td);
    if (has(L, 'nw')) add('white-space', e.nw ? 'nowrap' : 'normal');
    if (has(L, 'bgT', 'bg', 'gr', 'ang')) {
      if (e.bgT === 'gradient' && e.gr) add('background', gradCss(e.gr, e.ang));
      else if (e.bgT === 'color' && e.bg) add('background', cv(e.bg));
      else if (e.bgT === 'none') add('background', 'none');
      else if (e.bg) add('background', cv(e.bg));
    }
    if (has(L, 'd', 'cols', 'tpl', 'ai', 'jc', 'wrap', 'gap', 'hid')) {
      if (!has(L, 'hid')) o.push('display:' + displayOf(n, e));
      if (e.d === 'column') add('flex-direction', 'column'); else if (e.d === 'row') add('flex-direction', 'row');
      if (e.d === 'grid') add('grid-template-columns', e.tpl || ('repeat(' + (e.cols || 1) + ',minmax(0,1fr))'));
      if (e.ai) add('align-items', AIMAP[e.ai]);
      if (e.jc) add('justify-content', FLEXJ[e.jc]);
      if (e.d === 'row' || e.d === 'column') add('flex-wrap', e.wrap ? 'wrap' : 'nowrap');
      if (e.gap != null) add('gap', e.gap + 'px');
    }
    ['pt:padding-top', 'pr:padding-right', 'pb:padding-bottom', 'pl:padding-left', 'mt:margin-top', 'mr:margin-right', 'mb:margin-bottom', 'ml:margin-left'].forEach(x => { const [k, p] = x.split(':'); if (has(L, k)) add(p, e[k] + 'px'); });
    if (has(L, 'ctr') && e.ctr) { add('margin-left', 'auto'); add('margin-right', 'auto'); }
    ['w:width', 'mw:max-width', 'h:height', 'mh:min-height'].forEach(x => { const [k, p] = x.split(':'); if (has(L, k)) add(p, px(e[k])); });
    if (has(L, 'rad')) add('border-radius', e.rad + 'px');
    if (has(L, 'bw', 'bt', 'br', 'bb', 'bl', 'bc', 'bst')) {
      const g = e.bw || 0, side = k => (e[k] != null ? e[k] : g);
      add('border-style', e.bst || 'solid'); add('border-color', e.bc ? cv(e.bc) : 'currentColor');
      add('border-width', side('bt') + 'px ' + side('br') + 'px ' + side('bb') + 'px ' + side('bl') + 'px');
    }
    if (has(L, 'shx', 'shy', 'shb', 'shs', 'shc')) {
      if (!e.shx && !e.shy && !e.shb && !e.shs) add('box-shadow', 'none');
      else add('box-shadow', (e.shx || 0) + 'px ' + (e.shy || 0) + 'px ' + (e.shb || 0) + 'px ' + (e.shs || 0) + 'px ' + cv(e.shc || '#0b214426'));
    }
    if (has(L, 'op')) add('opacity', e.op);
    if (has(L, 'rx', 'ry', 'rz', 'scl')) {
      const t = [];
      if (e.rx || e.ry) t.push('perspective(1100px)');
      if (e.ry) t.push('rotateY(' + e.ry + 'deg)'); if (e.rx) t.push('rotateX(' + e.rx + 'deg)'); if (e.rz) t.push('rotate(' + e.rz + 'deg)');
      if (e.scl != null && e.scl !== 1) t.push('scale(' + e.scl + ')');
      add('transform', t.length ? t.join(' ') : 'none');
    }
    if (has(L, 'pos')) add('position', e.pos);
    ['top', 'right', 'bottom', 'left'].forEach(k => { if (has(L, k)) add(k, px(e[k])); });
    if (has(L, 'z')) add('z-index', e.z);
    if (has(L, 'ord')) add('order', e.ord);
    if (has(L, 'ovf')) add('overflow', e.ovf);
    return o;
  }
  const PSEUDO_KEYS = ['bgImg', 'bgSz', 'bgPs', 'bgIo', 'ovg', 'ova'];
  function pseudo(cls, e, L, imgUrl) {
    const out = [];
    if (has(L, 'bgImg', 'bgSz', 'bgPs', 'bgIo')) {
      const u = e.bgImg ? imgUrl(e.bgImg) : '';
      out.push(cls + '::before{content:"";position:absolute;inset:0;z-index:-2;pointer-events:none;' + (u ? 'background-image:url("' + String(u).replace(/["\\()\s]/g, encodeURIComponent) + '");' : 'background-image:none;') +
        'background-size:' + (e.bgSz || 'cover') + ';background-position:' + (e.bgPs || 'center') + ';background-repeat:no-repeat;opacity:' + (e.bgIo == null ? 1 : e.bgIo) + '}');
    }
    if (has(L, 'ovg', 'ova')) out.push(cls + '::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;background:' + (e.ovg ? gradCss(e.ovg, e.ova) : 'none') + '}');
    return out;
  }

  const BURGER_PANEL = 'display:none;position:absolute;left:0;right:0;top:100%;z-index:60;flex-direction:column;align-items:stretch;justify-content:flex-start;flex-wrap:nowrap;gap:2px;padding:8px 18px 18px;background:var(--navy);border-bottom:1px solid #ffffff24;box-shadow:0 22px 40px #0007;max-height:calc(100vh - 78px);overflow:auto;text-align:left';
  const BASE_CSS = [
    '.hpx{position:relative;box-sizing:border-box;width:100%;min-height:100%;margin:0;background:var(--paper);color:var(--ink);font-family:var(--hp-font);line-height:1.5;letter-spacing:normal;text-align:left;-webkit-text-size-adjust:100%;overflow-x:clip}',
    '.hpx *,.hpx *::before,.hpx *::after{box-sizing:border-box}',
    /* L'application impose « h1,h2,h3,h4{color:var(--t)} » (design-v2.css) : sans ceci, les titres sans couleur propre ne héritaient pas de leur section
       et devenaient sombres sur fond marine (illisibles) sur la vraie page, alors que l'éditeur (sans CSS de l'application) les montrait corrects. */
    '.hpx h1,.hpx h2,.hpx h3,.hpx h4{color:inherit;letter-spacing:inherit}',
    '.hpx a{color:inherit;text-decoration:none}.hpx img{border:0}',
    '.hpx .hn-text{display:block;margin:0}.hpx span.hn-text{display:inline}.hpx .hp-ac{color:inherit}',
    '.hpx .hn-image{display:block;max-width:100%;height:auto}.hpx .hn-ph{display:grid;place-items:center;min-height:120px;background:#dfe8f4;color:#5b7191;font-size:13px;border:2px dashed #9db3cf;border-radius:12px;width:100%}',
    '.hpx .hn-icon{display:grid;place-items:center;overflow:hidden;flex:none}.hpx .hn-icon img{width:100%;height:100%;object-fit:contain}',
    '.hpx .hn-iso{isolation:isolate;position:relative}',
    '.hpx .hn-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:12px 19px;border-radius:999px;font-size:13px;font-weight:750;line-height:1.5;border:1px solid transparent;transition:transform .2s,box-shadow .2s,background .2s;cursor:pointer;text-align:center}',
    '.hpx .hn-button:hover{transform:translateY(-2px)}',
    '.hpx .hb-primary{background:linear-gradient(110deg,#0785ff,#00a9ef);color:#fff;box-shadow:0 10px 28px #008cff3b}',
    '.hpx .hb-outline{border-color:#1baaff;color:#fff;background:#06172b99}',
    '.hpx .hb-white{background:#fff;color:#0754a2}.hpx .hb-plain{background:transparent;color:inherit}',
    '.hpx .hv-lift{transition:transform .2s,box-shadow .2s}.hpx .hv-lift:hover{transform:translateY(-5px)}',
    /* ancres : le titre ciblé ne se cache pas sous un en-tête fixe */
    '.hpx [id^="hp-"]{scroll-margin-top:88px}',
    /* menu burger : 100 % CSS (case à cocher cachée + étiquette ☰/✕ + panneau). Au-dessus du seuil, le panneau est transparent (display:contents)
       et ses éléments restent dans la disposition normale de la boîte. Le panneau se place sous la section positionnée la plus proche (l'en-tête). */
    '.hpx .hb-chk{position:absolute;width:1px;height:1px;margin:0;opacity:0;pointer-events:none}',
    '.hpx .hb-lbl{display:none;flex:none;box-sizing:border-box;width:44px;height:44px;align-items:center;justify-content:center;border:1px solid currentColor;border-radius:12px;font-size:22px;line-height:1;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent}',
    '.hpx .hb-lbl::before{content:"\\2630"}.hpx .hb-chk:checked+.hb-lbl::before,.hpx .hb-host.hb-open>.hb-lbl::before{content:"\\2715"}',
    '.hpx .hb-chk:focus-visible+.hb-lbl{outline:2px solid #31c5ff;outline-offset:2px}',
    '.hpx .hb-panel{display:contents}',
    '@media(max-width:1000px){.hpx .hb-bp-t>.hb-lbl{display:inline-flex}.hpx .hb-bp-t>.hb-panel{' + BURGER_PANEL + '}.hpx .hb-bp-t>.hb-chk:checked~.hb-panel,.hpx .hb-bp-t.hb-open>.hb-panel{display:flex}}',
    '@media(max-width:600px){.hpx .hb-bp-m>.hb-lbl{display:inline-flex}.hpx .hb-bp-m>.hb-panel{' + BURGER_PANEL + '}.hpx .hb-bp-m>.hb-chk:checked~.hb-panel,.hpx .hb-bp-m.hb-open>.hb-panel{display:flex}}',
    '.hpx .hv-grow{transition:transform .2s}.hpx .hv-grow:hover{transform:scale(1.04)}',
    /* maquette de tableau de bord (copie fidèle du fichier fourni) */
    '.hpx .hn-mockup{width:100%;max-width:600px;background:#f8fbff;border:5px solid #172b42;border-radius:20px;box-shadow:0 28px 80px #0008;overflow:hidden;color:#10284a}',
    '.hpx .mk-top{height:39px;display:flex;align-items:center;gap:7px;padding:0 14px;background:#eaf1fa;border-bottom:1px solid #d9e3f0;font-size:10px;font-weight:800;color:#16345b}',
    '.hpx .mk-dot{width:7px;height:7px;border-radius:50%;background:#18a4ff;display:inline-block}.hpx .mk-r{margin-left:auto;color:#526581;white-space:pre}',
    '.hpx .mk-body{display:grid;grid-template-columns:115px 1fr;min-height:300px}',
    '.hpx .mk-side{background:#062345;color:#cde2f7;padding:16px 10px;font-size:10px}.hpx .mk-side strong{display:block;color:#fff;margin:0 0 14px}.hpx .mk-side div{padding:8px 9px;border-radius:7px;margin:4px 0}.hpx .mk-side .mk-act{background:var(--primary);color:#fff}',
    '.hpx .mk-content{padding:16px;color:#10284a;min-width:0}.hpx .mk-content h3{font-size:16px;margin:0 0 4px}.hpx .mk-content p{font-size:10px;color:#6d7f98;margin:0 0 13px}',
    '.hpx .mk-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.hpx .mk-metric{background:#fff;border:1px solid #e0e8f2;border-radius:10px;padding:10px;box-shadow:0 4px 12px #1e3e6610}.hpx .mk-metric small{display:block;color:#72829a;font-size:9px}.hpx .mk-metric b{display:block;font-size:15px;margin-top:4px}.hpx .mk-metric em{font-style:normal;font-size:9px;color:#0aa67b}',
    '.hpx .mk-charts{display:grid;grid-template-columns:1.3fr .7fr;gap:9px;margin-top:10px}.hpx .mk-chart{background:#fff;border:1px solid #e0e8f2;border-radius:10px;padding:12px;min-height:115px}.hpx .mk-chart b{font-size:10px}',
    '.hpx .mk-bars{height:65px;display:flex;align-items:end;gap:7px;margin-top:8px;border-bottom:1px solid #dbe5f1}.hpx .mk-bars i{display:block;flex:1;border-radius:4px 4px 0 0;background:linear-gradient(#1ab6ff,var(--primary))}',
    '.hpx .mk-ring{width:65px;height:65px;margin:8px auto;border-radius:50%;background:conic-gradient(var(--primary) 0 48%,#ffad34 48% 72%,#13c8a1 72%);display:grid;place-items:center}.hpx .mk-ring::after{content:attr(data-l);width:39px;height:39px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:9px;font-weight:800}',
    '@media(max-width:600px){.hpx .mk-body{grid-template-columns:75px 1fr;min-height:210px}.hpx .mk-side{font-size:8px;padding:10px 5px}.hpx .mk-side div{padding:6px 4px}.hpx .mk-content{padding:10px}.hpx .mk-content h3{font-size:12px}.hpx .mk-metrics{gap:4px}.hpx .mk-metric{padding:6px}.hpx .mk-metric b{font-size:10px}.hpx .mk-charts{grid-template-columns:1fr}.hpx .mk-chart{min-height:90px}.hpx .mk-chart:nth-child(2){display:none}}',
    '@media(prefers-reduced-motion:reduce){.hpx *,.hpx *::before,.hpx *::after{transition:none!important}}'
  ].join('\n');

  /* ---------------------------------------------------------------- rendu */
  function renderMockup(n, cls, attrs) {
    const m = n.p.m || {}, E = esc;
    return '<div class="' + cls + '"' + attrs + '><div class="mk-top"><span class="mk-dot"></span> ' + E(m.brand) + ' <span class="mk-r">' + E(m.right) + '</span></div>' +
      '<div class="mk-body"><aside class="mk-side"><strong>' + E(m.sideTitle) + '</strong>' + (m.side || []).map((x, i) => '<div' + (i === m.active ? ' class="mk-act"' : '') + '>' + E(x) + '</div>').join('') + '</aside>' +
      '<div class="mk-content"><h3>' + E(m.hello) + '</h3><p>' + E(m.sub) + '</p>' +
      '<div class="mk-metrics">' + (m.metrics || []).map(x => '<div class="mk-metric"><small>' + E(x.l) + '</small><b>' + E(x.v) + '</b><em>' + E(x.e) + '</em></div>').join('') + '</div>' +
      '<div class="mk-charts"><div class="mk-chart"><b>' + E(m.c1) + '</b><div class="mk-bars">' + (m.bars || []).map(h => '<i style="height:' + (+h || 0) + '%"></i>').join('') + '</div></div>' +
      '<div class="mk-chart"><b>' + E(m.c2) + '</b><div class="mk-ring" data-l="' + E(m.ring) + '"></div></div></div></div></div></div>';
  }
  function richText(tx, year) {
    return esc(String(tx || '').replace(/\{annee\}/g, year)).replace(/\{\{([^{}]*)\}\}/g, '<span class="hp-ac">$1</span>').replace(/\n/g, '<br>');
  }
  function hrefAttrs(href, edit) {
    if (!href) return '';
    if (href === 'action:login') return ' href="#" data-act="login"';
    if (href[0] === '#') return ' href="' + esc('#hp-' + href.slice(1)) + '" data-anchor="' + esc(href.slice(1)) + '"';
    return ' href="' + esc(href) + '"' + (/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '');
  }

  /* render(doc, { imgUrl(id)->url, edit }) -> { html, css } */
  function render(doc, opts) {
    opts = opts || {};
    const imgUrl = opts.imgUrl || (id => BUILTIN_IMAGES[id] || '/api/public/home/image/' + id);
    const edit = !!opts.edit, year = String(new Date().getFullYear());
    const th = Object.assign({}, TOKENS, (doc && doc.theme) || {});
    const rules = [], tab = [], mob = [];
    const nodeHtml = n => {
      const p = n.p || {}, s = n.s || {}, st = n.st || {}, sm = n.sm || {};
      const e1 = Object.assign({}, s, st), e2 = Object.assign({}, e1, sm);
      const sel = '.hpx .n-' + n.id;
      const anyImg = [s, st, sm].some(L => has(L, 'bgImg', 'ovg'));
      const cls = ['hn', 'hn-' + n.t, 'n-' + n.id];
      if (anyImg) cls.push('hn-iso');
      const burger = n.t === 'box' && !p.href && (p.burger === 'tablet' || p.burger === 'mobile') ? p.burger : '';
      if (burger) cls.push('hb-host', burger === 'tablet' ? 'hb-bp-t' : 'hb-bp-m');
      if (n.t === 'button') cls.push('hb-' + (p.vr || 'primary'));
      const hv = e2.hv || e1.hv || s.hv; if (hv && hv !== 'none') cls.push('hv-' + hv);
      const id = p.an ? ' id="hp-' + esc(p.an) + '"' : '';
      const ed = edit ? ' data-nid="' + n.id + '" data-t="' + n.t + '"' : '';
      const attrs = id + ed;
      const d0 = decls(n, s, s), d1 = decls(n, e1, st), d2 = decls(n, e2, sm);
      if (d0.length) rules.push(sel + '{' + d0.join(';') + '}');
      if (d1.length) tab.push(sel + '{' + d1.join(';') + '}');
      if (d2.length) mob.push(sel + '{' + d2.join(';') + '}');
      pseudo(sel, s, s, imgUrl).forEach(r => rules.push(r));
      pseudo(sel, e1, st, imgUrl).forEach(r => tab.push(r));
      pseudo(sel, e2, sm, imgUrl).forEach(r => mob.push(r));
      if (s.ac) rules.push(sel + ' .hp-ac{color:' + cv(s.ac) + '}');
      if (st.ac) tab.push(sel + ' .hp-ac{color:' + cv(st.ac) + '}');
      if (sm.ac) mob.push(sel + ' .hp-ac{color:' + cv(sm.ac) + '}');
      if (s.hc) rules.push(sel + ':hover{color:' + cv(s.hc) + '}');
      const klass = ' class="' + cls.join(' ') + '"';
      switch (n.t) {
        case 'section': case 'box': {
          const inner = (n.c || []).map(nodeHtml).join('');
          const tag = p.href ? 'a' : (p.tag || (n.t === 'section' ? 'section' : 'div'));
          if (burger) return '<' + tag + klass + attrs + '><input type="checkbox" class="hb-chk" id="hbk-' + n.id + '" aria-label="Ouvrir ou fermer le menu"><label class="hb-lbl" for="hbk-' + n.id + '" aria-hidden="true"></label><div class="hb-panel">' + inner + '</div></' + tag + '>';
          return '<' + tag + klass + attrs + (p.href ? hrefAttrs(p.href) : '') + '>' + inner + '</' + tag + '>';
        }
        case 'text': {
          const tag = p.href ? 'a' : (p.tag || 'p');
          return '<' + tag + klass + attrs + (p.href ? hrefAttrs(p.href) : '') + '>' + richText(p.tx, year) + '</' + tag + '>';
        }
        case 'button': {
          const tag = p.href ? 'a' : 'button';
          return '<' + tag + klass + attrs + (p.href ? hrefAttrs(p.href) : ' type="button"') + '>' + richText(p.lb, year) + '</' + tag + '>';
        }
        case 'image': {
          const u = p.src ? imgUrl(p.src) : '';
          if (!u) return edit ? '<div class="' + cls.join(' ') + ' hn-ph"' + attrs + '>🖼 Choisir une image</div>' : '';
          const im = '<img' + klass + attrs + ' src="' + esc(u) + '" alt="' + esc(p.alt) + '" loading="lazy" style="object-fit:' + (p.fit || 'cover') + '">';
          return p.href ? '<a' + hrefAttrs(p.href) + '>' + im + '</a>' : im;
        }
        case 'icon': {
          const iu = p.src ? imgUrl(p.src) : '';
          const body = iu ? '<img src="' + esc(iu) + '" alt="">' : esc(p.gl);
          return '<div' + klass + attrs + '>' + body + '</div>';
        }
        case 'mockup': return renderMockup(n, cls.join(' '), attrs);
      }
      return '';
    };
    const html = '<div class="hpx"' + (edit ? ' data-nid="__page"' : '') + '>' + ((doc && doc.nodes) || []).map(nodeHtml).join('') + '</div>';
    const vars = '.hpx{' + Object.keys(TOKENS).map(k => '--' + k + ':' + th[k]).join(';') + ';--hp-font:' + (FONTS[th.font] || FONTS.sans) + '}';
    const css = BASE_CSS + '\n' + vars + '\n' + rules.join('\n') +
      '\n@media(max-width:' + BP.tablet + 'px){\n' + tab.join('\n') + '\n}\n@media(max-width:' + BP.mobile + 'px){\n' + mob.join('\n') + '\n}';
    return { html, css };
  }


  /* ---------------------------------------------------------------- lisibilité (contraste WCAG) */
  /* Pour chaque texte, bouton ou lettre d'icône, compare la couleur affichée à la couleur du fond réellement derrière lui, appareil par appareil.
     Fond = fonds propres (couleur / dégradé : pire couleur) + calques, puis fonds des parents jusqu'à un fond opaque, sinon fond de page.
     Les fonds translucides sont composés sur ce qu'il y a derrière. Non évalués : éléments masqués, pictogrammes décoratifs (emoji, symboles) et
     éléments « absolus / fixes » sans fond propre (le fond dépend de ce qui passe dessous). L'image de fond n'est pas mesurée : résultat « estimation ». */
  const hexRgba = h => {
    h = String(h || '').replace('#', '');
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0, h.length >= 8 ? (parseInt(h.slice(6, 8), 16) || 0) / 255 : 1];
  };
  const toRgba = c => (Array.isArray(c) ? c : hexRgba(c));
  const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const rgbHex = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
  const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lumOf = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const overBg = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1]; };
  function contrastRatio(a, b) { const x = lumOf(toRgba(a)), y = lumOf(toRgba(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  /* Couleur la plus proche de `fg` (même teinte, éclaircie ou assombrie) qui atteint `target` sur TOUS les fonds. */
  function suggestColor(fg, bgs, target) {
    target = target || 4.5;
    const f = toRgba(fg), list = (bgs || []).map(toRgba);
    if (!list.length) return null;
    const worst = c => Math.min.apply(null, list.map(b => contrastRatio(c, b)));
    const mix = (to, t) => [f[0] + (to[0] - f[0]) * t, f[1] + (to[1] - f[1]) * t, f[2] + (to[2] - f[2]) * t, 1];
    let best = null;
    [[255, 255, 255], [0, 0, 0]].forEach(to => {
      for (let i = 0; i <= 100; i++) { const t = i / 100, c = mix(to, t); if (worst(c) >= target) { if (!best || t < best.t) best = { t, c }; return; } }
    });
    if (best) return rgbHex(best.c);
    const w = worst([255, 255, 255, 1]), k = worst([0, 0, 0, 1]);
    return w >= k ? '#ffffff' : '#000000';
  }
  const HAS_TEXT = /[0-9A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;
  const TAG_FS = { h1: 2, h2: 1.5, h3: 1.17, h4: 1, small: 0.83 };
  const BOLD_TAG = { h1: 1, h2: 1, h3: 1, h4: 1, strong: 1 };
  const VARIANT = {
    primary: { fg: '#ffffff', layer: { colors: [[7, 133, 255, 1], [0, 169, 239, 1]], opaque: true, toks: [] } },
    outline: { fg: '#ffffff', layer: { colors: [[6, 23, 43, 0.6]], opaque: false, toks: [] } },
    white: { fg: '#0754a2', layer: { colors: [[255, 255, 255, 1]], opaque: true, toks: [] } },
    plain: { fg: null, layer: null }
  };
  function auditContrast(doc, dev) {
    dev = dev || 'desktop';
    const theme = Object.assign({}, TOKENS, (doc && doc.theme) || {});
    const resolve = c => {
      if (!c) return null; if (c === 'transparent') return [0, 0, 0, 0];
      return hexRgba(c[0] === '@' ? (theme[c.slice(1)] || TOKENS[c.slice(1)] || '#000000') : c);
    };
    const tokOf = c => (c && c[0] === '@' ? c.slice(1) : null);
    const eff = n => { const s = n.s || {}; return dev === 'desktop' ? s : dev === 'tablet' ? Object.assign({}, s, n.st) : Object.assign({}, s, n.st, n.sm); };
    const stopsLayer = stops => ({ colors: stops.map(x => resolve(x.c)), opaque: stops.every(x => resolve(x.c)[3] >= 0.999), toks: stops.map(x => tokOf(x.c)).filter(Boolean) });
    /* couches d'un élément, du dessous vers le dessus : fond, image (non mesurée), calque */
    function ownLayers(e) {
      const L = []; let explicit = false;
      if (e.bgT === 'gradient' && e.gr) { L.push(stopsLayer(e.gr)); explicit = true; }
      else if (e.bgT === 'color' && e.bg) { L.push(stopsLayer([{ c: e.bg }])); explicit = true; }
      else if (e.bgT === 'none') explicit = true;
      else if (e.bg) { L.push(stopsLayer([{ c: e.bg }])); explicit = true; }
      return { L, explicit };
    }
    const candidates = (chain) => {
      const top = []; const toks = []; let est = false, done = false, boundary = false;
      for (let i = chain.length - 1; i >= 0 && !done; i--) {
        const c = chain[i];
        for (let j = c.layers.length - 1; j >= 0; j--) {
          const L = c.layers[j];
          if (L.img) { est = true; continue; }
          top.push(L); (L.toks || []).forEach(t => { if (toks.indexOf(t) < 0) toks.push(t); });
          if (L.opaque) { done = true; break; }
        }
        if (!done && c.abs) { boundary = true; break; }
      }
      let cands = null;
      if (!done) {
        if (boundary) { if (!top.length || !top[top.length - 1].colors.every(c => c[3] >= 0.85)) return null; }
        else { cands = [hexRgba(theme.paper)]; if (toks.indexOf('paper') < 0) toks.push('paper'); }
      }
      for (let k = top.length - 1; k >= 0; k--) {
        const next = [], seen = {};
        const push = c => { const key = c.map(v => Math.round(v)).join(','); if (!seen[key]) { seen[key] = 1; next.push(c); } };
        top[k].colors.forEach(c => { if (!cands) push([c[0], c[1], c[2], 1]); else cands.forEach(b => push(overBg(c, b))); });
        cands = next.length > 48 ? next.sort((a, b) => lumOf(a) - lumOf(b)).filter((x, i) => i < 24 || i >= next.length - 24) : next;
      }
      return { cands, toks, est };
    };
    const issues = [];
    function evalColor(n, kind, part, fgRaw, fs, fw, chain) {
      const bd = candidates(chain); if (!bd || !bd.cands || !bd.cands.length) return;
      const fg = resolve(fgRaw); if (!fg) return;
      let worst = Infinity, wbg = null;
      bd.cands.forEach(b => { const r = contrastRatio(overBg(fg, b), b); if (r < worst) { worst = r; wbg = b; } });
      const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
      const need = large ? 3 : 4.5;
      if (worst >= need) return;
      issues.push({ id: n.id, kind, part, dev, level: worst < 3 ? 'bad' : 'low', ratio: Math.round(worst * 100) / 100, need, large, est: bd.est,
        fgHex: rgbHex(fg), bgHex: rgbHex(wbg), fgTok: tokOf(fgRaw), bgToks: bd.toks.slice(), suggest: suggestColor(fg, bd.cands, 4.5) });
    }
    function rec(n, ctx) {
      if (!n) return;
      const e = eff(n); if (e.hid) return;
      const p = n.p || {}, abs = e.pos === 'absolute' || e.pos === 'fixed';
      const { L, explicit } = ownLayers(e);
      const layers = L.slice();
      const vr = n.t === 'button' ? (VARIANT[p.vr || 'primary'] || VARIANT.primary) : null;
      if (vr && !explicit && vr.layer) layers.push(vr.layer);
      if (e.bgImg) layers.push({ img: true });
      if (e.ovg) layers.push(stopsLayer(e.ovg));
      const chain = ctx.chain.concat([{ layers, abs }]);
      const color = e.color != null ? e.color : (vr && vr.fg ? vr.fg : ctx.color);
      const ac = e.ac != null ? e.ac : ctx.ac;
      const bold = BOLD_TAG[p.tag] ? 700 : null;
      let fs = e.fs != null ? e.fs : (n.t === 'button' ? 13 : ctx.fs * (n.t === 'text' ? (TAG_FS[p.tag] || 1) : 1));
      const fw = e.fw != null ? +e.fw : (n.t === 'button' ? 750 : (bold || ctx.fw));
      if (n.t === 'text') {
        const tx = String(p.tx || '');
        if (HAS_TEXT.test(tx.replace(/\{\{|\}\}|\{annee\}/g, ''))) evalColor(n, 'text', 'text', color, fs, fw, chain);
        const spans = (tx.match(/\{\{([^{}]*)\}\}/g) || []).map(x => x.slice(2, -2)).join('');
        if (ac && ac !== color && HAS_TEXT.test(spans)) evalColor(n, 'text', 'accent', ac, fs, fw, chain);
      } else if (n.t === 'button') {
        if (HAS_TEXT.test(String(p.lb || '').replace(/\{\{|\}\}|\{annee\}/g, ''))) evalColor(n, 'button', 'text', color, fs, fw, chain);
      } else if (n.t === 'icon') {
        if (!p.src && HAS_TEXT.test(String(p.gl || ''))) evalColor(n, 'icon', 'text', color, fs, fw, chain);
      }
      if (n.c && n.c.length) {
        let childChain = chain;
        const bp = n.t === 'box' && !p.href ? p.burger : '';
        if ((bp === 'tablet' && dev !== 'desktop') || (bp === 'mobile' && dev === 'mobile')) childChain = chain.concat([{ layers: [{ colors: [hexRgba(theme.navy)], opaque: true, toks: ['navy'] }], abs: false }]);   // panneau déroulant du menu burger
        n.c.forEach(c => rec(c, { chain: childChain, color, ac, fs, fw }));
      }
    }
    ((doc && doc.nodes) || []).forEach(n => rec(n, { chain: [], color: '@ink', ac: null, fs: 16, fw: 400 }));
    return { dev, issues, estimate: issues.some(i => i.est) };
  }

  /* ---------------------------------------------------------------- modèle par défaut (= fichier HTML fourni) */
  function builders(idfn) {
    const N = (t, o) => {
      const n = Object.assign({ id: idfn(), t, p: {}, s: {}, st: {}, sm: {} }, o || {}, t === 'section' || t === 'box' ? { c: (o && o.c) || [] } : {});
      if (n.nm) { n.p = Object.assign({}, n.p, { nm: n.nm }); }
      delete n.nm; return n;
    };
    const box = (s, c, o) => N('box', Object.assign({ s, c }, o));
    const text = (tx, tag, s, o) => N('text', Object.assign({ p: Object.assign({ tx, tag }, (o && o.p) || {}), s }, o && { st: o.st || {}, sm: o.sm || {}, nm: o.nm }));
    const btn = (lb, vr, href, s, o) => N('button', Object.assign({ p: { lb, vr, href: href || '' }, s: s || {} }, o));
    const icon = (gl, s, o) => N('icon', Object.assign({ p: { gl, src: '' }, s }, o));
    const wrap = (s, c, o) => box(Object.assign({ w: '100%', mw: '1280px', ctr: true, pl: 20, pr: 20 }, s), c, Object.assign({ sm: { pl: 14, pr: 14 } }, o));
    const grad = (a, b, ang) => ({ bgT: 'gradient', gr: [{ c: a, p: 0 }, { c: b, p: 100 }], ang: ang == null ? 135 : ang });
    const eyebrow = (tx, color) => text(tx, 'div', { color: color || '@primary', tt: 'uppercase', ls: 2, fs: 11, fw: '800' });

    const brand = (href, hideSloganOnMobile) => box({ d: 'row', ai: 'center', gap: 12, fw: '800', ls: -0.4, fs: 19, lh: 1.1 }, [
      icon('SM', Object.assign({ w: '44px', h: '44px', rad: 13, fs: 20, fw: '900', color: '#04152f', shy: 8, shb: 24, shc: '#087cff55' }, grad('#19d7ff', '#087cff')), { sm: { w: '38px', h: '38px' }, nm: 'Logo' }),
      box({}, [
        text('Station Manager {{PRO}}', 'div', { ac: '#139cff', fw: '800' }, { nm: 'Nom' }),
        text('Votre entreprise, notre priorité', 'small', { fs: 11, fw: '500', color: '#b9c9df', ls: 0, mt: 5 }, hideSloganOnMobile ? { nm: 'Slogan', sm: { hid: true } } : { nm: 'Slogan' })
      ])
    ], { p: { href }, sm: { fs: 15 }, nm: 'Marque' });

    /* En-tête (modèle actuel) : fixe en haut au défilement ; sur tablette et mobile le menu devient un bouton ☰ (panneau déroulant, sans JavaScript).
         tablette (≤ 1000 px) : logo · « Se connecter » · « Essayer gratuitement » · ☰ ;
         mobile (≤ 600 px)    : logo · « Se connecter » · ☰ (« Essayer gratuitement » passe dans le panneau, le slogan est masqué). */
    const MENU_LINKS = [['Accueil', '#accueil'], ['Fonctionnalités', '#fonctionnalites'], ['Nos solutions', '#solutions'], ['Tarifs', '#tarifs'], ['À propos', '#apropos'], ['Contact', '#contact']];
    const header = () => N('section', {
      p: { tag: 'header', nm: 'En-tête' }, s: { pos: 'fixed', top: '0', left: '0', right: '0', z: 40, color: '#ffffff', bgT: 'color', bg: '@navy', bb: 1, bc: '#ffffff24', shy: 6, shb: 26, shc: '#00000047' },
      c: [wrap({ d: 'row', ai: 'center', jc: 'between', gap: 24, wrap: true, mh: '78px' }, [
        brand('#accueil', true),
        box({ d: 'row', ai: 'center', gap: 26, fs: 13, fw: '600', color: '#dbe8fb' }, [
          ...MENU_LINKS.map(([l, h]) => text(l, 'span', { hc: '#31c5ff', nw: true }, { st: { pt: 13, pb: 13 }, p: { href: h } })),
          btn('Essayer gratuitement', 'primary', '#contact', { nw: true, hid: true }, { st: { hid: true }, sm: { hid: false, mt: 10 } })
        ], { p: { burger: 'tablet' }, st: { ord: 3, fs: 16 }, nm: 'Menu' }),
        box({ d: 'row', ai: 'center', gap: 10 }, [
          btn('♙ Se connecter', 'outline', 'action:login', { nw: true }, { sm: { nw: false, pt: 9, pb: 9, pl: 12, pr: 12, fs: 12 } }),
          btn('Essayer gratuitement', 'primary', '#contact', { nw: true }, { sm: { hid: true } })
        ], { st: { ord: 2 }, sm: { gap: 8 }, nm: 'Boutons' })
      ], { st: { d: 'grid', tpl: 'minmax(0,1fr) auto auto', jc: 'start', mh: '0', pt: 10, pb: 10, gap: 10 }, sm: { pl: 14, pr: 14, gap: 8 }, nm: 'Barre de navigation' })]
    });
    /* Ancien modèle (version précédente) : conservé uniquement pour reconnaître — par sa signature exacte — les pages enregistrées avec lui,
       afin de les passer automatiquement à l'en-tête fixe + burger (upgradeHeaderSticky). Ne pas modifier. */
    const headerV71 = () => N('section', {
      p: { tag: 'header', nm: 'En-tête' }, s: { pos: 'absolute', top: '0', left: '0', right: '0', z: 5, color: '#ffffff', bb: 1, bc: '#ffffff24' },
      c: [wrap({ d: 'row', ai: 'center', jc: 'between', gap: 24, wrap: true, mh: '78px' }, [
        brand('#accueil'),
        box({ d: 'row', ai: 'center', gap: 26, fs: 13, fw: '600', color: '#dbe8fb' },
          MENU_LINKS.map(([l, h]) => text(l, 'span', { hc: '#31c5ff', nw: true }, { st: { pt: 6, pb: 6 }, p: { href: h } })),
          { st: { ord: 2, w: '100%', ovf: 'auto', gap: 22, jc: 'start' }, sm: { gap: 18 }, nm: 'Menu' }),
        box({ d: 'row', ai: 'center', gap: 10 }, [
          btn('♙ Se connecter', 'outline', 'action:login', { nw: true }, { sm: { nw: false, w: '48%', pt: 10, pb: 10, pl: 10, pr: 10, fs: 11 } }),
          btn('Essayer gratuitement', 'primary', '#contact', { nw: true }, { sm: { nw: false, w: '48%', pt: 10, pb: 10, pl: 10, pr: 10, fs: 11 } })
        ], { st: { ord: 1 }, sm: { w: '100%', jc: 'between', gap: 8 }, nm: 'Boutons' })
      ], { st: { mh: '0', pt: 10, pb: 10, gap: 10 }, sm: { pl: 14, pr: 14, gap: 8 }, nm: 'Barre de navigation' })]
    });

    const floatCard = () => box(Object.assign({ pos: 'absolute', right: '-5px', bottom: '17px', w: '170px', pt: 16, pr: 16, pb: 16, pl: 16, rad: 16, bw: 1, bc: '#1a8dce77', color: '#ffffff', shy: 15, shb: 40, shc: '#00000055', z: 2 }, { bgT: 'color', bg: '#092b52ee' }), [
      text('UNE PLATEFORME POLYVALENTE', 'small', { fs: 10, color: '#b7d0e8' }),
      text('Une solution adaptée à votre secteur', 'strong', { fs: 15, mt: 7, mb: 7 }, { sm: { fs: 12 } }),
      ...['🛒 Commerce', '👔 Pressing', '📦 Gestion de stock', '＋ Autres activités'].map(t => box({ d: 'row', ai: 'center', gap: 8, pt: 7, pb: 7, bt: 1, bc: '#ffffff1c', fs: 11 }, [text(t, 'span', {})], { sm: { fs: 9 } }))
    ], { sm: { right: '-3px', bottom: '-5px', w: '130px', pt: 10, pr: 10, pb: 10, pl: 10 }, nm: 'Carte flottante' });

    const mockup = () => N('mockup', {
      s: { w: '100%', mw: '600px', rx: 2, ry: -5, bw: 5, bc: '#172b42', bgT: 'color', bg: '#f8fbff' }, sm: { rx: 0, ry: 0, bw: 3 }, nm: 'Maquette tableau de bord',
      p: { m: { brand: 'Station Manager PRO', right: 'Tableau de bord　　●　●　●', sideTitle: '◈ Manager PRO', side: ['▦ Tableau de bord', '♙ Clients', '♧ Employés', '▣ Fournisseurs', '◇ Produits', '▤ Ventes', '▧ Achats', '▤ Factures', '◷ Rapports', '⚙ Paramètres'], active: 0,
        hello: 'Bonjour, bienvenue !', sub: 'Voici un aperçu de votre activité.',
        metrics: [{ l: 'Ventes du jour', v: '1 245 000', e: '↗ Suivi des ventes' }, { l: 'Achats du jour', v: '684 000', e: '↗ Suivi des achats' }, { l: 'Clients actifs', v: '258', e: '↗ Gestion clients' }],
        c1: 'Évolution de l\'activité', bars: [35, 54, 42, 68, 58, 82, 95, 75], c2: 'Répartition', ring: '100%' } }
    });

    const hero = () => N('section', {
      p: { an: 'accueil', nm: 'Héro' },
      s: { pos: 'relative', ovf: 'hidden', mh: '650px', color: '#ffffff', bgT: 'gradient', ang: 90, gr: [{ c: '#03142c', p: 0 }, { c: '#041b38ed', p: 42 }, { c: '#051a33b8', p: 100 }], bgImg: 'dflt_hero', bgSz: 'cover', bgPs: 'center 24%', bgIo: 0.48,
        ovg: [{ c: '#03142cf7', p: 0 }, { c: '#041a36ed', p: 35 }, { c: '#041a3666', p: 68 }, { c: '#04162b66', p: 100 }], ova: 90 },
      c: [wrap({ d: 'grid', tpl: '.92fr 1.08fr', ai: 'center', gap: 30, pt: 125, pb: 62, mh: '650px' }, [
        box({}, [
          text('🚀 La solution tout-en-un pour une gestion intelligente', 'div', { w: 'fit-content', pt: 7, pb: 7, pl: 13, pr: 13, bw: 1, bc: '#168fff88', rad: 999, bgT: 'color', bg: '#071d38b8', fs: 11, fw: '700', color: '#dbeeff' }, { nm: 'Pastille' }),
          text('Station Manager {{PRO}}\nSimplifiez, organisez, développez votre entreprise\u00a0!', 'h1', { fs: 60, fw: '900', ls: -2.2, lh: 1.06, mt: 20, mb: 17, ac: '#159cff' }, { st: { fs: 46 }, sm: { fs: 40, ls: -1.5 }, nm: 'Titre principal' }),
          text('Une plateforme pensée pour gérer vos clients, vos stocks, vos ventes, vos achats, vos factures et bien plus encore. Adaptez votre espace de travail à votre activité et gardez une vision claire de vos opérations.', 'p', { fs: 16, lh: 1.75, color: '#d1dfef', mw: '560px', mb: 26 }, { sm: { fs: 14 }, nm: 'Texte d’introduction' }),
          box({ d: 'row', wrap: true, gap: 12 }, [btn('✦ Découvrir nos solutions\u00a0 →', 'primary', '#solutions'), btn('▷ Voir la présentation', 'outline', '#apropos')], { nm: 'Boutons' }),
          box({ d: 'row', wrap: true, gap: 20, mt: 27, color: '#b7cce4', fs: 11, ac: '#30d9c0' }, ['Gestion centralisée', 'Accès contrôlés', 'Interface adaptable'].map(t => text('{{✓}} ' + t, 'span', { ac: '#30d9c0' })), { nm: 'Garanties' })
        ], { nm: 'Texte du héro' }),
        box({ pos: 'relative', mh: '390px', d: 'row', ai: 'center', jc: 'center' }, [mockup(), floatCard()], { st: { mh: '340px' }, sm: { mh: '275px', ovf: 'visible' }, nm: 'Visuel' })
      ], { st: { tpl: '1fr', pt: 110 }, sm: { pt: 100, pb: 40, gap: 14 }, nm: 'Contenu du héro' })]
    });

    const featureCard = (gl, title, tx, a, b) => box({ pt: 23, pb: 23, pl: 20, pr: 20, rad: 16, bgT: 'color', bg: '#ffffff', bw: 1, bc: '#e3ebf5', shy: 8, shb: 25, shc: '#1c47700a', hv: 'lift' }, [
      icon(gl, Object.assign({ w: '43px', h: '43px', rad: 13, fs: 20, color: '#ffffff', mb: 17 }, grad(a, b)), { sm: { w: '37px', h: '37px' } }),
      text(title, 'h3', { fs: 15, fw: '700', mb: 8 }, { sm: { fs: 13 } }),
      text(tx, 'p', { fs: 12, lh: 1.65, color: '@muted' }, { sm: { fs: 11 } })
    ], { sm: { pt: 16, pb: 16, pl: 13, pr: 13 }, nm: 'Carte : ' + title });
    const features = () => N('section', {
      p: { an: 'fonctionnalites', nm: 'Fonctionnalités' }, s: { pt: 72, pb: 72 }, sm: { pt: 48, pb: 48 },
      c: [wrap({}, [
        box({ ta: 'center', mw: '760px', ctr: true, mb: 32 }, [
          eyebrow('Une plateforme polyvalente'),
          text('Les outils essentiels pour une gestion {{plus simple}}', 'h2', { fs: 38, fw: '700', ls: -1, lh: 1.15, mt: 10, mb: 12, ac: '#087cff' }, { st: { fs: 32 }, sm: { fs: 27 } }),
          text('Rassemblez les informations de votre entreprise et facilitez le suivi quotidien de vos opérations depuis un espace organisé.', 'p', { fs: 14, color: '@muted' })
        ], { nm: 'Titre de section' }),
        box({ d: 'grid', cols: 4, gap: 15 }, [
          featureCard('♙', 'Clients & employés', 'Organisez les profils, les informations et le suivi des personnes liées à votre activité.', '#078cff', '#24c4ff'),
          featureCard('⬡', 'Stocks & produits', 'Suivez les produits, les quantités et les mouvements de stock pour mieux vous organiser.', '#00a875', '#22d6a0'),
          featureCard('🛒', 'Ventes & achats', 'Centralisez les opérations commerciales, les achats et leur historique.', '#6740df', '#a16bff'),
          featureCard('▤', 'Facturation', 'Retrouvez vos documents de facturation et les informations utiles au suivi des paiements.', '#ff9b00', '#ffc34e'),
          featureCard('↗', 'Rapports & statistiques', 'Consultez des indicateurs et des vues synthétiques pour mieux piloter votre activité.', '#f23c5b', '#ff7a78'),
          featureCard('⬡', 'Sécurité & accès', 'Structurez les rôles et les autorisations selon les responsabilités des utilisateurs.', '#00a9a0', '#32ddca'),
          featureCard('☁', 'Sauvegarde & récupération', 'Organisez les sauvegardes et préparez la récupération des données en cas d\'incident.', '#5840c9', '#9b83ff'),
          featureCard('▣', 'Gestion documentaire', 'Centralisez les documents utiles pour faciliter le suivi et le travail quotidien.', '#1e65a9', '#42aaff')
        ], { st: { cols: 2 }, sm: { cols: 2, gap: 10 }, nm: 'Grille des fonctionnalités' })
      ])]
    });

    const sectorCard = (gl, title, tx, a, b) => box(Object.assign({ mh: '145px', bw: 1, bc: '#ffffff2b', rad: 15, pt: 17, pb: 17, pl: 17, pr: 17, ovf: 'hidden' }, grad(a, b, 140)), [
      text(gl, 'div', { fs: 23 }), text(title, 'h3', { fs: 14, fw: '700', mt: 9, mb: 4 }), text(tx, 'p', { fs: 11, color: '#e0ebf7' })
    ], { sm: { pt: 13, pb: 13, pl: 13, pr: 13, mh: '125px' }, nm: 'Secteur : ' + title });
    const sectors = () => N('section', {
      p: { an: 'solutions', nm: 'Secteurs' }, s: Object.assign({ color: '#ffffff', pt: 65, pb: 65 }, grad('#03162f', '#06285a', 120)), sm: { pt: 45, pb: 45 },
      c: [wrap({ d: 'grid', tpl: '.8fr 1.7fr', gap: 34, ai: 'center' }, [
        box({}, [
          eyebrow('Une solution sur mesure', '#40c5ff'),
          text('Une interface adaptée à votre secteur d\'activité', 'h2', { fs: 34, fw: '700', ls: -1, lh: 1.15, mt: 10, mb: 12 }, { sm: { fs: 29 } }),
          text('Chaque métier a ses propres besoins. Station Manager PRO est conçu pour s\'adapter à différents domaines et afficher les outils pertinents selon la configuration retenue.', 'p', { fs: 13, color: '#c0d2e8', mb: 16 }),
          btn('Découvrir les solutions\u00a0 →', 'outline', '#contact')
        ], { nm: 'Présentation' }),
        box({ d: 'grid', cols: 3, gap: 12 }, [
          sectorCard('🛒', 'Commerce', 'Suivi des ventes et des produits.', '#0a5591', '#073263'),
          sectorCard('👔', 'Pressing', 'Organisation des articles et services.', '#007d83', '#073b65'),
          sectorCard('📦', 'Gestion de stock', 'Suivi des quantités et mouvements.', '#7e2d6b', '#302568'),
          sectorCard('⛽', 'Station-service', 'Outils adaptés à l\'activité.', '#a84a13', '#562b31'),
          sectorCard('🍽️', 'Restauration', 'Organisation des ventes et services.', '#9a283e', '#4e1b45'),
          sectorCard('▦', 'Autres secteurs', 'Une configuration selon le métier.', '#176b51', '#103c4b')
        ], { sm: { cols: 2 }, nm: 'Cartes des secteurs' })
      ], { st: { tpl: '1fr' } })]
    });

    const stat = (gl, b, small, last) => box({ d: 'column', ai: 'center', jc: 'center', gap: 6, ta: 'center', br: last ? 0 : 1, bc: '#e1eaf5' }, [
      text(gl, 'div', { fs: 25, color: '@primary' }),
      box({}, [text(b, 'div', { fs: 18, fw: '700', color: '@primary' }), text(small, 'div', { fs: 10, color: '@muted' })])
    ], { sm: { br: 0 }, nm: 'Chiffre : ' + b });
    const about = () => N('section', {
      p: { an: 'apropos', nm: 'À propos' }, s: { pt: 28, pb: 28 },
      c: [wrap({ d: 'grid', cols: 4, gap: 10, ta: 'center' }, [
        stat('♧', 'Centralisé', 'Vos informations mieux organisées'), stat('⬡', 'Contrôlé', 'Des accès selon les rôles'), stat('◷', 'Plus clair', 'Un meilleur suivi des opérations'), stat('✦', 'Évolutif', 'Une approche multi-activité', true)
      ], { sm: { cols: 2, gap: 18 }, nm: 'Engagements' })]
    });

    const cta = () => N('section', {
      p: { an: 'contact', nm: 'Appel à l’action' }, s: { pt: 25, pb: 70 },
      c: [wrap({}, [box(Object.assign({ pt: 36, pr: 36, pb: 36, pl: 36, rad: 24, color: '#ffffff', d: 'row', ai: 'center', jc: 'between', gap: 25, shy: 20, shb: 45, shc: '#0868bd30' },
        { bgT: 'gradient', ang: 110, gr: [{ c: '#087cff', p: 0 }, { c: '#07428a', p: 75 }, { c: '#06224c', p: 100 }] }), [
        box({}, [
          eyebrow('Prêt à mieux gérer votre activité ?', '#9ce7ff'),
          text('Votre entreprise mérite une gestion à sa mesure.', 'h2', { fs: 38, fw: '700', ls: -1, lh: 1.15, mt: 10, mb: 8 }, { st: { fs: 32 }, sm: { fs: 27 } }),
          text('Découvrez Station Manager PRO et identifiez les outils adaptés à votre organisation.', 'p', { fs: 13, color: '#d5e8ff' })
        ]),
        btn('Nous contacter\u00a0 →', 'white', 'mailto:stationmanagerpro@gmail.com?subject=Découverte%20de%20Station%20Manager%20PRO', { nw: true })
      ], { sm: { pt: 25, pr: 25, pb: 25, pl: 25, d: 'column', ai: 'start' }, nm: 'Panneau' })])]
    });

    const footer = () => N('section', {
      p: { tag: 'footer', an: 'tarifs', nm: 'Pied de page' }, s: { bgT: 'color', bg: '#03132a', color: '#c5d7eb', pt: 32, pb: 32 },
      c: [wrap({ d: 'row', ai: 'center', jc: 'between', gap: 20, fs: 12 }, [
        brand('#accueil'),
        box({ d: 'row', wrap: true, gap: 18 }, [['Fonctionnalités', '#fonctionnalites'], ['Solutions', '#solutions'], ['Contact', '#contact'], ['E-mail', 'mailto:stationmanagerpro@gmail.com']].map(([l, h]) => text(l, 'span', { hc: '#26baff' }, { p: { href: h } })), { nm: 'Liens' }),
        text('© {annee} Station Manager PRO', 'span', {}, { nm: 'Copyright' })
      ], { st: { wrap: true }, sm: { d: 'column', ai: 'start' } })]
    });

    /* modèles supplémentaires proposés dans l'éditeur */
    const textBlock = () => N('section', { p: { nm: 'Texte centré' }, s: { pt: 64, pb: 64 }, sm: { pt: 40, pb: 40 }, c: [wrap({ ta: 'center', mw: '860px' }, [
      eyebrow('Surtitre'), text('Titre de la section', 'h2', { fs: 36, fw: '700', ls: -1, lh: 1.15, mt: 10, mb: 14 }, { sm: { fs: 27 } }),
      text('Écrivez ici votre texte de présentation. Vous pouvez modifier la taille, la couleur, l’alignement et tout le reste depuis le panneau de droite.', 'p', { fs: 16, lh: 1.7, color: '@muted' })])] });
    const textImage = () => N('section', { p: { nm: 'Texte + image' }, s: { pt: 64, pb: 64 }, sm: { pt: 40, pb: 40 }, c: [wrap({ d: 'grid', cols: 2, gap: 40, ai: 'center' }, [
      box({}, [eyebrow('Surtitre'), text('Titre de la section', 'h2', { fs: 34, fw: '700', ls: -1, lh: 1.15, mt: 10, mb: 12 }, { sm: { fs: 27 } }), text('Décrivez votre activité, vos atouts ou vos services en quelques lignes.', 'p', { fs: 15, lh: 1.7, color: '@muted', mb: 18 }), btn('En savoir plus', 'primary', '#contact')]),
      N('image', { p: { src: '', alt: '', fit: 'cover' }, s: { w: '100%', rad: 18, shy: 16, shb: 40, shc: '#0b214426' } })
    ], { st: { cols: 1 } })] });
    const gallery = () => N('section', { p: { nm: 'Galerie d’images' }, s: { pt: 64, pb: 64 }, sm: { pt: 40, pb: 40 }, c: [wrap({}, [
      box({ ta: 'center', mb: 28 }, [text('Notre galerie', 'h2', { fs: 34, fw: '700', ls: -1, mb: 8 }, { sm: { fs: 27 } })]),
      box({ d: 'grid', cols: 3, gap: 14 }, [0, 1, 2].map(() => N('image', { p: { src: '', alt: '', fit: 'cover' }, s: { w: '100%', h: '240px', rad: 14 } })), { st: { cols: 2 }, sm: { cols: 1 }, nm: 'Images' })])] });
    const contact = () => N('section', { p: { an: 'contact', nm: 'Contact' }, s: { pt: 64, pb: 64, bgT: 'color', bg: '#ffffff' }, c: [wrap({ ta: 'center', mw: '760px' }, [
      text('Contactez-nous', 'h2', { fs: 34, fw: '700', ls: -1, mb: 18 }, { sm: { fs: 27 } }),
      text('📞 +223 00 00 00 00', 'p', { fs: 16, mb: 8, color: '@ink' }, { p: { href: 'tel:+22300000000' } }), text('✉️ contact@exemple.com', 'p', { fs: 16, mb: 8, color: '@ink' }, { p: { href: 'mailto:contact@exemple.com' } }),
      text('📍 Votre adresse', 'p', { fs: 16, mb: 8, color: '@ink' }), text('🕒 Lundi – Samedi, 8h – 18h', 'p', { fs: 16, color: '@muted' })])] });
    const emptySection = () => N('section', { p: { nm: 'Section vide' }, s: { pt: 56, pb: 56 }, c: [wrap({}, [text('Nouvelle section', 'h2', { fs: 32, fw: '700', ta: 'center' })])] });

    return { N, box, text, btn, icon, wrap, grad, eyebrow, header, headerV71, hero, features, sectors, about, cta, footer, mockup, textBlock, textImage, gallery, contact, emptySection, featureCard };
  }

  function defaultDoc() {
    let i = 0;
    const b = builders(() => 'd' + (++i));
    return { v: 2, meta: { title: 'Station Manager PRO — Votre entreprise, notre priorité', description: 'Station Manager PRO — une plateforme de gestion adaptée à votre entreprise.' }, theme: Object.assign({ font: 'sans' }, TOKENS), nodes: [b.header(), b.hero(), b.features(), b.sectors(), b.about(), b.cta(), b.footer()] };
  }
  /* Modèles à insérer depuis l'éditeur : chaque appel produit des identifiants neufs. */
  const SECTION_TEMPLATES = [
    ['header', 'En-tête (menu + boutons)', '▭'], ['hero', 'Héro (titre + visuel)', '◧'], ['features', 'Fonctionnalités (cartes)', '▦'], ['sectors', 'Bandeau sombre (secteurs)', '▤'],
    ['about', 'À propos / chiffres (centré)', '◎'], ['textBlock', 'Texte centré', '☰'], ['textImage', 'Texte + image', '◫'], ['gallery', 'Galerie d’images', '▣'], ['cta', 'Appel à l’action', '▬'],
    ['contact', 'Contact', '✆'], ['footer', 'Pied de page', '▁'], ['emptySection', 'Section vide', '□']
  ].map(([k, label, ic]) => ({ key: k, label, icon: ic }));
  function makeSection(key, taken) { const b = builders(() => uid(taken)); return b[key] ? b[key]() : null; }
  const ELEMENT_TEMPLATES = [
    ['heading', 'Titre', 'H'], ['paragraph', 'Paragraphe', '¶'], ['button', 'Bouton', '▭'], ['image', 'Image', '🖼'], ['icon', 'Icône / emoji', '☺'], ['box', 'Boîte (conteneur)', '▢'],
    ['card', 'Carte', '▤'], ['grid', 'Grille 3 colonnes', '▦'], ['divider', 'Séparateur', '―'], ['spacer', 'Espace vide', '↕'], ['mockup', 'Maquette tableau de bord', '▥']
  ].map(([k, label, ic]) => ({ key: k, label, icon: ic }));
  function makeElement(key, taken) {
    const b = builders(() => uid(taken));
    switch (key) {
      case 'heading': return b.text('Nouveau titre', 'h2', { fs: 32, fw: '700', ls: -0.5, lh: 1.2 }, { sm: { fs: 26 } });
      case 'paragraph': return b.text('Votre texte ici. Cliquez deux fois pour le modifier directement.', 'p', { fs: 16, lh: 1.65, color: '@muted' });
      case 'button': return b.btn('Bouton', 'primary', '#contact');
      case 'image': return b.N('image', { p: { src: '', alt: '', fit: 'cover' }, s: { w: '100%', rad: 14 } });
      case 'icon': return b.icon('⭐', Object.assign({ w: '48px', h: '48px', rad: 14, fs: 22, color: '#ffffff' }, b.grad('#078cff', '#24c4ff')));
      case 'box': return b.box({ d: 'column', gap: 12, pt: 20, pr: 20, pb: 20, pl: 20 }, [], { nm: 'Boîte' });
      case 'card': return b.box({ pt: 22, pr: 22, pb: 22, pl: 22, rad: 16, bgT: 'color', bg: '#ffffff', bw: 1, bc: '#e3ebf5', shy: 8, shb: 25, shc: '#1c47700a', hv: 'lift' }, [
        b.icon('⭐', Object.assign({ w: '43px', h: '43px', rad: 13, fs: 20, color: '#ffffff', mb: 14 }, b.grad('#078cff', '#24c4ff'))), b.text('Titre de la carte', 'h3', { fs: 16, fw: '700', mb: 6 }), b.text('Courte description de la carte.', 'p', { fs: 13, lh: 1.6, color: '@muted' })], { nm: 'Carte' });
      case 'grid': return b.box({ d: 'grid', cols: 3, gap: 16 }, [0, 1, 2].map(() => makeElement('card', taken)), { st: { cols: 2 }, sm: { cols: 1 }, nm: 'Grille' });
      case 'divider': return b.box({ h: '1px', w: '100%', bgT: 'color', bg: '#e1eaf5' }, [], { nm: 'Séparateur' });
      case 'spacer': return b.box({ h: '40px' }, [], { nm: 'Espace' });
      case 'mockup': return b.mockup();
    }
    return null;
  }

  return { TOKENS, TOKEN_LABEL, FONTS, FONT_LABEL, BUILTIN_IMAGES, BP, NODE_TYPES, CONTAINERS, LIMITS, STYLE, TEXT_TAGS, BOX_TAGS, BTN_VARIANTS, BURGER_MODES, ID_RE, COLOR_RE, HREF_RE,
    esc, clone, uid, walk, find, ids, reId, sanitize, render, auditContrast, contrastRatio, suggestColor, defaultDoc, SECTION_TEMPLATES, ELEMENT_TEMPLATES, makeSection, makeElement, displayOf };
}));
