'use strict';
// Banc de test du scan QR : exécute le VRAI code de src/qr_codes.js, qr_db.js, qr_logic.js, qr_pdf.js contre une VRAIE base PostgreSQL,
// sans serveur HTTP : le routeur Express et le noyau (core.js) sont remplacés par de petites doublures (analyse des routes, droits `need`,
// transactions, HttpError). Ce qui n'est PAS couvert : le HTTP réel, la validation zod (doublure permissive), le JWT et le middleware de station.
// Base : variable QR_TEST_DATABASE_URL (module `pg`) ou, à défaut, client `psql` (PGHOST/PGPORT/PGUSER/PGDATABASE). Garde-fou : base locale nommée test/ci.
const Module = require('module');
const { spawn } = require('child_process');
const path = require('path');

// ---------- Connexion : sessions psql persistantes (une session = une transaction possible) ----------
class PsqlSession {
  constructor(env) { this.p = spawn('psql', ['-qAtX', '-v', 'ON_ERROR_STOP=0'], { env: { ...process.env, ...env } }); this.buf = ''; this.err = ''; this.waiting = null; this.queue = Promise.resolve();
    this.p.stdout.on('data', d => { this.buf += d; this.flush(); }); this.p.stderr.on('data', d => { this.err += d; this.flush(); }); }
  flush() { const m = this.buf.match(/__END__(\d+)__\n/); if (m && this.waiting) { const out = this.buf.slice(0, m.index); this.buf = this.buf.slice(m.index + m[0].length); const w = this.waiting; this.waiting = null; w(out); } }
  raw(sql) {
    const run = () => new Promise(res => {
      this.err = ''; this.waiting = out => setTimeout(() => res({ out, err: this.err }), 5);
      this.p.stdin.write(sql.trim().replace(/;?\s*$/, ';') + '\n\\echo __END__0__\n');
    });
    return (this.queue = this.queue.then(run, run));
  }
  close() { try { this.p.stdin.end('\\q\n'); } catch (e) { /* déjà fermé */ } }
}
const lit = v => v == null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v instanceof Date ? `'${v.toISOString()}'` : Array.isArray(v) ? `ARRAY[${v.map(lit).join(',')}]` : `'${String(v).replace(/'/g, "''")}'`;
class PgError extends Error { constructor(m) { super(m); this.code = (m.match(/ERROR:\s+(.*)/) || [])[1]; } }
function client(session) {
  return {
    async query(sql, params = []) {
      let q = sql.replace(/\$(\d+)/g, (_, n) => lit(params[+n - 1]));
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET|SELECT\s+pg_advisory)/i.test(q)) { const { err } = await session.raw(q); if (/ERROR:/.test(err)) throw new PgError(err); return { rows: [], rowCount: 0 }; }
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(q) && !/RETURNING/i.test(q)) q += ' RETURNING 1 AS _n';
      const { out, err } = await session.raw(`WITH q AS (${q.replace(/;\s*$/, '')}) SELECT coalesce(json_agg(q), '[]'::json) FROM q`);
      if (/ERROR:/.test(err)) throw new PgError(err);
      const rows = JSON.parse(out.trim() || '[]'); return { rows, rowCount: rows.length };
    },
    release() { /* la session reste ouverte, réutilisée par le pool */ },
  };
}
function makePool(env) {
  const free = [], all = [];
  const open = () => { const s = new PsqlSession(env); all.push(s); return s; };
  const pool = {
    async connect() { const s = free.pop() || open(); const c = client(s); c.release = () => free.push(s); return c; },
    async query(sql, p) { const c = await pool.connect(); try { return await c.query(sql, p); } finally { c.release(); } },
    async end() { all.forEach(s => s.close()); },
  };
  return pool;
}

// ---------- Doublures du noyau ----------
class HttpError extends Error { constructor(status, message, details) { super(message); this.status = status; this.details = details; } }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const chain = () => new Proxy(function () {}, { get: (_, k) => k === 'safeParse' ? (v => ({ success: true, data: v })) : chain(), apply: () => chain() });
function install(pool) {
  const core = {
    pool, HttpError, wrap,
    async tx(fn) { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); } },
    body: () => (req, res, next) => next(),   // validation zod non exécutée dans ce banc
    need: (...codes) => (req, res, next) => codes.some(c => req.user.perms.has(c)) ? next() : next(new HttpError(403, 'Permission refusée : ' + codes.join(' ou '))),
  };
  const routes = [];
  const Router = () => { const r = {}; for (const m of ['get', 'post', 'patch', 'put', 'delete']) r[m] = (p, ...h) => routes.push({ method: m.toUpperCase(), path: p, handlers: h }); return r; };
  const orig = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'express') return { Router };
    if (request === 'zod') return { z: chain() };
    if (/(^|\/)core$/.test(request) && parent && /\/src\//.test(parent.filename || '')) return core;
    return orig.apply(this, arguments);
  };
  const src = f => path.join(__dirname, '..', '..', 'src', f);
  Object.keys(require.cache).filter(k => /\/src\/qr_/.test(k)).forEach(k => delete require.cache[k]);
  const mod = require(src('qr_codes.js'));
  Module._load = orig;
  const match = (route, method, url) => { if (route.method !== method) return null; const a = route.path.split('/'), b = url.split('/'); if (a.length !== b.length) return null; const params = {}; for (let i = 0; i < a.length; i++) { if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i]; else if (a[i] !== b[i]) return null; } return params; };
  /** Appelle une route comme le ferait Express : { status, body, headers, buffer }. */
  async function call(method, url, { user, sid, body = {}, query = {} } = {}) {
    const [p, qs] = url.split('?'); const q = { ...query }; if (qs) for (const kv of qs.split('&')) { const [k, v] = kv.split('='); q[k] = decodeURIComponent(v); }
    const route = routes.map(r => ({ r, params: match(r, method, p) })).find(x => x.params);
    if (!route) return { status: 404, body: { error: 'Route inconnue' } };
    const req = { method, params: route.params, query: q, body: JSON.parse(JSON.stringify(body)), user, sid, ip: '127.0.0.1' };
    const out = { status: 200, headers: {}, body: null, buffer: null };
    const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, setHeader(k, v) { out.headers[k] = v; }, send(b) { out.buffer = b; return this; } };
    try {
      for (const h of route.r.handlers) {
        let called = false, nextErr = null;
        await h(req, res, e => { called = true; nextErr = e; });   // wrap() renvoie une promesse ; un intergiciel rappelle next()
        if (nextErr) throw nextErr;
        if (!called) break;   // gestionnaire terminal : la réponse est envoyée
      }
    } catch (err) { out.status = err.status || 500; out.body = { error: err.message, details: err.details }; if (!err.status) out.crash = err; }
    return out;
  }
  return { call, mod, HttpError };
}

/** Connexion de test : refuse toute base qui n'est pas locale et nommée test/ci. */
async function connect() {
  const url = process.env.QR_TEST_DATABASE_URL;
  const env = {}; let dbname;
  if (url) { const u = new URL(url); dbname = decodeURIComponent(u.pathname.slice(1)); Object.assign(env, { PGHOST: u.hostname, PGPORT: u.port || '5432', PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: dbname }); }
  else { dbname = process.env.PGDATABASE; }
  const host = env.PGHOST || process.env.PGHOST || '';
  if (!dbname || !/(^|[_-])(test|ci)([_-]|$)/i.test(dbname) || !(host === '' || host === 'localhost' || host === '127.0.0.1' || host.startsWith('/'))) return null;
  return makePool(env);
}
module.exports = { connect, install, HttpError, lit };
