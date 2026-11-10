'use strict';
/* Audit automatique des contrastes de l'application (navigateur réel).
   Principe : on charge TOUTES les feuilles de style de index.html dans Chromium, on instancie chaque combinaison de classes de
   bouton réellement utilisée dans le code (public/*.js, index.html) — avec et sans « on » — en mode jour et nuit, avec plusieurs
   couleurs de marque (--p / --on-p calculés comme dans ext-design.js), puis on mesure le contraste réellement affiché
   (couleur de texte calculée contre le fond effectif, dégradés compris).
   Échec : rapport WCAG < 3 (texte quasi illisible). Les rapports entre 3 et 4,5 sont listés en information (non bloquants).
   Ce test signale notamment les fenêtres « abîmées » par la règle globale
   button:not(.b2):not(.bd):not(.bg){ color: var(--on-p) !important } (texte clair sur fond clair).
   Prérequis : Playwright + Chromium (présents dans l'environnement de CI ; sinon le test est ignoré avec un avertissement).
   Utilisation : node test/contrast-audit.js [--verbose] */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', 'public');
const VERBOSE = process.argv.includes('--verbose');
let chromium;
try { ({ chromium } = require('playwright')); } catch (_) { console.log('⚠ Playwright indisponible : audit des contrastes ignoré (npm i -D playwright pour l’activer).'); process.exit(0); }

/* ---- 1. Combinaisons de classes de boutons réellement utilisées ---- */
function collectButtonClassSets() {
  const sets = new Set();
  for (const f of fs.readdirSync(ROOT).filter(x => /\.(js|html)$/.test(x))) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const re = /<button\b([^>]*)>/g; let m;
    while ((m = re.exec(src))) {
      const c = /class=(?:"([^"]*)"|'([^']*)'|\\"([^\\"]*)\\")/.exec(m[1]);
      const toks = (c ? (c[1] || c[2] || c[3] || '') : '').split(/\s+/).filter(t => /^[A-Za-z][\w-]*$/.test(t));
      sets.add(Array.from(new Set(toks)).sort().join(' '));
    }
    const re2 = /className\s*=\s*['"]([^'"$]+)['"]/g;      // éléments créés en JS : seuls ceux qui ressemblent à des boutons
    while ((m = re2.exec(src))) { const t = m[1].trim(); if (/(^|\s)(b1|b2|bd|bg|btn|button)(\s|$)/.test(t)) sets.add(Array.from(new Set(t.split(/\s+/))).sort().join(' ')); }
  }
  const out = new Set();
  for (const s of Array.from(sets).filter(x => !x.split(' ').some(t => TEXTLESS.includes(t)))) { out.add(s); if (!/\bon\b/.test(s)) out.add((s + ' on').trim()); }
  return Array.from(out);
}

/* ---- 2. Page de test + mesure (exécutée dans le navigateur) ---- */
const cssLinks = () => (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<link[^>]+rel="stylesheet"[^>]*>/g) || []).map(x => /href="([^"]+)"/.exec(x)[1]).concat(['home-editor.css']);   // + feuille chargée à la demande par l'éditeur d'accueil
/* Contextes réels : le CSS de l'application cible souvent « .parent bouton.classe ». Une classe listée ici n'est mesurée que dans ces
   contextes (chaque contexte = chaîne d'ancêtres « .classe » ou « #id »), les autres dans la page et dans une carte. */
const CONTEXTS = {
  'dv2-link': [['.dv2', '.dv2-card']], 'dv2-card-head': [['.dv2', '.dv2-card']],
  tag: [['.wa-app', '.msg-attachments']],
  'message-unread-toast-open': [['.message-unread-toast']], 'message-unread-toast-close': [['.message-unread-toast']],
  'pub-mobile-x': [['.pub-mobile', '.show']],
  'hbe-': [['#hbe']]                                   // préfixe : tout bouton « hbe-* » vit dans l'éditeur d'accueil (#hbe)
};
const TEXTLESS = ['nav-pub-btn', 'pub-mobile-btn'];   // boutons réduits à une image : rien à lire
const contextsFor = set => {
  const toks = set.split(' ');
  for (const t of toks) { if (CONTEXTS[t]) return CONTEXTS[t]; }
  for (const t of toks) for (const k of Object.keys(CONTEXTS)) if (k.endsWith('-') && t.startsWith(k)) return CONTEXTS[k];
  return null;
};
const BRANDS = ['#2563eb', '#facc15', '#16a34a', '#e11d48', '#0d7a6b', '#f97316', '#111827', '#a3e635'];

function measure() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = css => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (t, u) => { const a = t[3]; return [t[0] * a + u[0] * (1 - a), t[1] * a + u[1] * (1 - a), t[2] * a + u[2] * (1 - a), 1]; };
  const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = c => 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const stopsOf = bi => { const m = bi.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8}\b)/gi); return m ? m.map(rgba) : []; };
  function bgSamples(el) {
    const chain = []; for (let x = el; x; x = x.parentElement) chain.unshift(x);
    let samples = [[255, 255, 255, 1]];
    for (const x of chain) {
      const cs = getComputedStyle(x); const layers = [];
      const bc = rgba(cs.backgroundColor); if (bc[3] > 0) layers.push([bc]);
      if (/gradient/.test(cs.backgroundImage)) { const st = stopsOf(cs.backgroundImage); if (st.length) layers.push(st); }
      for (const L of layers) { const next = []; samples.forEach(u => L.forEach(t => next.push(over(t, u)))); samples = next.slice(0, 64); }
    }
    return samples;
  }
  const out = [];
  document.querySelectorAll('[data-audit]').forEach(el => {
    if (el.disabled) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const text = (el.textContent || '').trim(); if (!text) return;
    const cs = getComputedStyle(el), fg0 = rgba(cs.color), fs = parseFloat(cs.fontSize), fw = +cs.fontWeight;
    const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
    let worst = Infinity, wbg = null;
    bgSamples(el).forEach(b => { const ratioV = ratio(over(fg0, b), b); if (ratioV < worst) { worst = ratioV; wbg = b; } });
    out.push({ key: el.dataset.audit, ratio: worst, large, fg: cs.color, bg: 'rgb(' + wbg.slice(0, 3).map(Math.round).join(',') + ')' });
  });
  return out;
}

function serve() {
  return new Promise(ok => {
    const srv = http.createServer((q, r) => {
      const u = decodeURIComponent(q.url.split('?')[0]);
      if (u === '/blank') { r.setHeader('content-type', 'text/html'); return r.end('<!doctype html><html lang="fr"><head><meta charset="utf-8">' + cssLinks().map(h => '<link rel="stylesheet" href="' + h + '">').join('') + '</head><body></body></html>'); }
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); }
      r.setHeader('content-type', f.endsWith('.css') ? 'text/css' : 'application/octet-stream'); r.end(fs.readFileSync(f));
    }).listen(0, () => ok(srv));
  });
}

(async () => {
  const sets = collectButtonClassSets();
  const items = [];
  sets.forEach(st => { const cx = contextsFor(st); (cx ? cx.map(c => [c.join(' '), c]) : [['page', 'page'], ['carte', 'carte']]).forEach(([n, c]) => items.push(['button', st, n, c])); });
  ['page', 'carte'].forEach(n => items.push(['label', '', n, n]));   // règle globale label{color:var(--m)}
  const srv = await serve(), b = await chromium.launch(), pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
  await pg.goto('http://127.0.0.1:' + srv.address().port + '/blank');
  await pg.addScriptTag({ content: 'window.__measure = ' + measure.toString() });
  const onColor = h => { const lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; const L = x => { const [r, g, bl] = [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)).map(lin); return .2126 * r + .7152 * g + .0722 * bl; }; const ra = (a, c) => (Math.max(L(a), L(c)) + .05) / (Math.min(L(a), L(c)) + .05); return ra(h, '#ffffff') >= ra(h, '#0f172a') ? '#ffffff' : '#0f172a'; };
  const fails = new Map(), infos = new Map(); let checked = 0;
  for (const theme of ['light', 'dark']) {
    for (const brand of BRANDS) {
      await pg.evaluate(([theme, brand, on]) => {
        const d = document.documentElement; d.dataset.theme = theme;
        d.style.setProperty('--p', brand); d.style.setProperty('--on-p', on);
        document.body.innerHTML = '';
      }, [theme, brand, onColor(brand)]);
      await pg.evaluate(items => {
        const mk = chain => { let host = document.body; chain.forEach(d => { const e = document.createElement('div'); if (d[0] === '#') e.id = d.slice(1); else e.className = d.slice(1); host.appendChild(e); host = e; }); return host; };
        const hosts = {};
        const hostOf = (name, chain) => (hosts[name] || (hosts[name] = chain === 'page' ? document.body : chain === 'carte' ? mk(['.card']) : mk(chain)));
        items.forEach(([kind, s, name, chain]) => {
          const bt = document.createElement(kind); if (kind === 'button') bt.className = s; else bt.className = s || ''; bt.textContent = 'Libellé';
          bt.dataset.audit = kind + '.' + (s || '(sans classe)') + ' @' + name; hostOf(name, chain).appendChild(bt);
        });
      }, items);
      const res = await pg.evaluate(() => window.__measure());
      for (const x of res) {
        checked++;
        const tag = `${x.key} [${theme}, marque ${brand}]`;
        if (x.ratio < 3) { fails.set(tag, x); } else if (x.ratio < 4.5 && !x.large) { infos.set(tag, x); }
      }
    }
  }
  await b.close(); srv.close();
  const fmt = (k, x) => `  ✖ ${k} — contraste ${x.ratio.toFixed(2)}:1 (texte ${x.fg} sur ${x.bg})`;
  console.log(`${sets.length} combinaisons de boutons (+ libellés), ${items.length} placements × 2 thèmes × ${BRANDS.length} couleurs de marque — ${checked} mesures.`);
  if (infos.size) { console.log(`ℹ ${infos.size} mesure(s) entre 3:1 et 4,5:1 (information, non bloquant)` + (VERBOSE ? ' :' : ' (--verbose pour la liste)')); if (VERBOSE) infos.forEach((x, k) => console.log('  ~ ' + k + ' ' + x.ratio.toFixed(2))); }
  if (fails.size) { console.log(`✖ ${fails.size} combinaison(s) illisible(s) (< 3:1) :`); const keys = Array.from(fails.keys()); keys.slice(0, VERBOSE ? keys.length : 40).forEach(k => console.log(fmt(k, fails.get(k)))); if (!VERBOSE && keys.length > 40) console.log(`  … ${keys.length - 40} autres (--verbose)`); process.exit(1); }
  console.log('✓ Aucun bouton illisible (contraste ≥ 3:1) dans tous les thèmes et couleurs de marque testés.');
})().catch(e => { console.error(e); process.exit(1); });
