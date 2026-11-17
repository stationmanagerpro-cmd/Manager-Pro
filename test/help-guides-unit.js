'use strict';
// Besoin d'aide (serveur) : lecture pour tous, écriture réservée au Super Admin, module inconnu refusé, audit de la modification.
const assert = require('assert');
const Module = require('module');
const path = require('path');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const audits = [];
const pool = { query: async () => ({ rows: [] }) };
const core = {
  pool, HttpError, wrap: fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next),
  body: () => (req, res, next) => next(),
  audit: async (c, req, module, action, table, recId, oldV, newV) => { audits.push([module, action, table, recId, newV]); },
};
function Router() {
  const stack = [];
  const add = m => (p, ...hs) => { stack.push({ path: p, method: m, handlers: hs }); };
  return { stack, get: add('get'), put: add('put'), use() {} };
}
const zChain = new Proxy(function () {}, { get: () => zChain, apply: () => zChain });
const stubs = { './core': core, express: { Router }, zod: { z: zChain } };
const realLoad = Module._load;
Module._load = function (request, parent) {
  if (parent && /src[\\/]help_guides\.js$/.test(parent.filename) && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};
const mod = require(path.join(__dirname, '..', 'src', 'help_guides.js'));
const find = (method, p) => { const l = mod.r.stack.find(x => x.path === p && x.method === method); assert(l, 'route absente ' + p); return l.handlers[l.handlers.length - 1]; };

let n = 0;
async function check(label, fn) { await fn(); n++; console.log('✔ ' + label); }
const call = async (handler, req) => { const out = { status: 200, json: null }; const res = { json(j) { out.json = j; }, status(c) { out.status = c; return this; } }; await new Promise((resolve, reject) => { handler(req, res, e => (e ? reject(e) : resolve())).then?.(resolve, reject) ?? resolve(); }); return out; };

(async () => {
  await check('lecture : accessible à un compte client, sans droit superadmin', async () => {
    pool.query = async () => ({ rows: [{ module_key: 'quart', procedure: 'Ouvrir le quart', video_url: 'https://example.com/v', updated_at: 'x' }] });
    const out = await call(find('get', '/help-guides'), { user: { id: 3, is_global: false } });
    assert.strictEqual(out.json.guides[0].module_key, 'quart'); assert.strictEqual(out.json.is_superadmin, false);
  });
  await check('écriture refusée à un compte client (403), rien d’enregistré', async () => {
    audits.length = 0; let err = null;
    try { await call(find('put', '/help-guides/:key'), { params: { key: 'quart' }, body: { procedure: 'x', video_url: '' }, user: { id: 3, is_global: false } }); } catch (e) { err = e; }
    assert(err && err.status === 403); assert.strictEqual(audits.length, 0);
  });
  await check('module inconnu refusé (404) même pour le Super Admin', async () => {
    let err = null;
    try { await call(find('put', '/help-guides/:key'), { params: { key: 'inconnu' }, body: { procedure: 'x' }, user: { id: 1, is_global: true } }); } catch (e) { err = e; }
    assert(err && err.status === 404);
  });
  await check('Super Admin : enregistrement, procédure rognée, audit écrit', async () => {
    audits.length = 0;
    pool.query = async (sql, params) => ({ rows: [{ module_key: params[0], procedure: params[1], video_url: params[2], updated_at: 'x' }] });
    const out = await call(find('put', '/help-guides/:key'), { params: { key: 'quart' }, body: { procedure: '  Ouvrir le quart  ', video_url: 'https://example.com/v' }, user: { id: 1, is_global: true } });
    assert.strictEqual(out.json.procedure, 'Ouvrir le quart'); assert.strictEqual(out.json.video_url, 'https://example.com/v');
    assert.strictEqual(audits.length, 1); assert.strictEqual(audits[0][0], 'aide');
  });
  console.log(`\n${n}/4 contrôles réussis.`); process.exit(0);
})().catch(e => { console.error('✘', e); process.exit(1); });
