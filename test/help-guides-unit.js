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
  audit: async (c, req, module, action, table, recId, oldV, newV) => { audits.push([module, action, table, recId, newV]); if (recId !== null) throw Object.assign(new Error('record_id BIGINT reçoit du texte'), { code: '22P02' }); },
};
function Router() {
  const stack = [];
  const add = m => (p, ...hs) => { stack.push({ path: p, method: m, handlers: hs }); };
  return { stack, get: add('get'), put: add('put'), post: add('post'), use() {} };
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
    pool.query = async () => ({ rows: [] });
    let err = null;
    try { await call(find('put', '/help-guides/:key'), { params: { key: 'inconnu' }, body: { procedure: 'x' }, user: { id: 1, is_global: true } }); } catch (e) { err = e; }
    assert(err && err.status === 404);
  });
  await check('Super Admin : enregistrement, procédure rognée, audit écrit', async () => {
    audits.length = 0;
    pool.query = async (sql, params) => ({ rows: [{ module_key: params[0], label: params[1], procedure: params[2], video_url: params[3], custom: false, updated_at: 'x' }] });
    const out = await call(find('put', '/help-guides/:key'), { params: { key: 'quart' }, body: { label: ' Quarts ', procedure: '  Ouvrir le quart  ', video_url: 'https://example.com/v' }, user: { id: 1, is_global: true } });
    assert.strictEqual(out.json.label, 'Quarts'); assert.strictEqual(out.json.procedure, 'Ouvrir le quart'); assert.strictEqual(out.json.video_url, 'https://example.com/v');
    assert.strictEqual(audits.length, 1); assert.strictEqual(audits[0][0], 'aide');
  });
  await check('création d’un module : refusée au client, acceptée au Super Admin avec clé serveur', async () => {
    audits.length = 0; let err = null;
    try { await call(find('post', '/help-guides'), { body: { label: 'Sécurité' }, user: { id: 3, is_global: false } }); } catch (e) { err = e; }
    assert(err && err.status === 403); assert.strictEqual(audits.length, 0);
    pool.query = async (sql, params) => ({ rows: [{ module_key: params[0], label: params[1], procedure: '', video_url: '', custom: true, updated_at: 'x' }] });
    const out = await call(find('post', '/help-guides'), { body: { label: 'Sécurité' }, user: { id: 1, is_global: true } });
    assert(/^c_[a-f0-9]{12}$/.test(out.json.module_key)); assert.strictEqual(out.json.custom, true); assert.strictEqual(out.status, 201);
    assert.strictEqual(audits.length, 1);
  });
  await check('module personnalisé : nom obligatoire, renommage autorisé', async () => {
    const key = 'c_0123456789ab';
    pool.query = async (sql, params) => sql.includes('custom = true') ? { rows: [{ '?column?': 1 }] } : { rows: [{ module_key: params[0], label: params[1], procedure: params[2], video_url: params[3], custom: true, updated_at: 'x' }] };
    let err = null;
    try { await call(find('put', '/help-guides/:key'), { params: { key }, body: { label: '   ', procedure: '' }, user: { id: 1, is_global: true } }); } catch (e) { err = e; }
    assert(err && err.status === 400);
    const out = await call(find('put', '/help-guides/:key'), { params: { key }, body: { label: 'Hygiène', procedure: 'x' }, user: { id: 1, is_global: true } });
    assert.strictEqual(out.json.label, 'Hygiène');
  });
  await check('écriture : le contrôle Super Admin précède la validation du corps (403 et non 400 pour un client)', async () => {
    for (const [m, p] of [['post', '/help-guides'], ['put', '/help-guides/:key']]) {
      const l = mod.r.stack.find(x => x.path === p && x.method === m);
      assert(l && l.handlers.length >= 2, 'route ' + m + ' ' + p + ' sans garde');
      let err = null;
      try { await new Promise((resolve, reject) => l.handlers[0]({ user: { id: 3, is_global: false }, body: { label: 123 }, params: { key: 'quart' } }, {}, e => (e ? reject(e) : resolve()))); } catch (e) { err = e; }
      assert(err && err.status === 403, m + ' ' + p + ' : attendu 403');
      let ok = false;
      await new Promise(resolve => l.handlers[0]({ user: { id: 1, is_global: true } }, {}, e => { ok = !e; resolve(); }));
      assert(ok, m + ' ' + p + ' : le Super Admin doit passer');
    }
  });
  await check('lecture : la liste des modules intégrés vient du serveur', async () => {
    pool.query = async () => ({ rows: [] });
    const out = await call(find('get', '/help-guides'), { user: { id: 3, is_global: false } });
    assert.deepStrictEqual(out.json.help_keys, ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'caisse', 'emp', 'alert', 'audit', 'param']);
  });
  console.log(`\n${n}/8 contrôles réussis.`); process.exit(0);
})().catch(e => { console.error('✘', e); process.exit(1); });
