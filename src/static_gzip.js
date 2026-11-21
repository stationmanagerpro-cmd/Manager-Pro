// Compression gzip des fichiers statiques texte (JS, CSS, HTML, JSON, SVG, TXT).
// Décision du propriétaire (2026-11-21). Module Node natif (zlib) : aucune dépendance ajoutée.
//
// Comportement :
// - Ne traite que les GET/HEAD d'un fichier existant du dossier public, de type texte, hors sw.js
//   (sw.js garde ses en-têtes « no-cache » de express.static).
// - Sans gzip accepté par le navigateur : laisse passer (express.static sert le fichier brut).
// - Toujours « Vary: Accept-Encoding » sur ces fichiers, pour que les caches ne mélangent pas les versions.
// - ETag faible dérivé de la taille et de la date ; 304 si le navigateur a déjà la version courante.
// - Résultat gzip mis en cache mémoire, invalidé si la taille ou la date change.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const COMPRESSIBLE = /\.(js|css|html|json|svg|txt|webmanifest)$/i;
const cache = new Map();   // chemin -> { mtimeMs, size, gz }

// « / » désigne index.html, comme express.static.
const norm = p => (p === '/' ? '/index.html' : p);
// Chemin de l'URL, sans dépendre de req.path (fourni par Express seulement).
const pathOf = req => { try { return new URL(req.url, 'http://x').pathname; } catch (_) { return ''; } };

function resolveStatic(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (_) { return null; }
  const full = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded));
  if (full !== root && !full.startsWith(root + path.sep)) return null;   // pas de sortie du dossier public
  // Fichiers et dossiers cachés (.env, .htaccess…) : jamais servis, comme express.static (dotfiles ignorés).
  if (decoded.split('/').some(seg => seg.startsWith('.') && seg !== '')) return null;
  return full;
}

function fileInfo(full) {
  let st;
  try { st = fs.statSync(full); } catch (_) { return null; }
  if (!st.isFile()) return null;
  return st;
}

function gzipped(full, st) {
  const hit = cache.get(full);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.gz;
  const gz = zlib.gzipSync(fs.readFileSync(full), { level: 9 });
  cache.set(full, { mtimeMs: st.mtimeMs, size: st.size, gz });
  return gz;
}

// Étape 1 : marque les réponses texte comme dépendantes de Accept-Encoding (avant express.static).
function varyHeader(root) {
  return function (req, res, next) {
    const p = norm(pathOf(req));
    if ((req.method === 'GET' || req.method === 'HEAD') && COMPRESSIBLE.test(p) && !/sw\.js$/.test(p)) {
      res.setHeader('Vary', 'Accept-Encoding');
    }
    next();
  };
}

// Étape 2 : renvoie la version gzip quand le navigateur l'accepte.
function staticGzip(root) {
  const base = path.resolve(root);
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const p = norm(pathOf(req));
    if (!COMPRESSIBLE.test(p) || /sw\.js$/.test(p)) return next();
    if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
    if (req.headers.range) return next();

    const full = resolveStatic(base, p);
    if (!full) return next();
    const st = fileInfo(full);
    if (!st) return next();

    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=0');
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }

    const gz = gzipped(full, st);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeOf(full));
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Length', gz.length);
    res.setHeader('Last-Modified', st.mtime.toUTCString());
    if (req.method === 'HEAD') return res.end();
    res.end(gz);
  };
}

// Type MIME texte (charset UTF-8) pour les extensions gérées ici.
function contentTypeOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
  };
  return map[ext] || 'application/octet-stream';
}

module.exports = { varyHeader, staticGzip, COMPRESSIBLE };
