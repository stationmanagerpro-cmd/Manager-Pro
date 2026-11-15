'use strict';
// Rapport d'utilisation : le rendu PDF s'exécute sans erreur avec un faux pdfkit (chaînable), la réservation mensuelle est atomique.
const assert = require('assert'); const Module = require('module'); const fs = require('fs');
const origLoad = Module._load;
Module._load = function (req, ...a) {
  if (req === 'pdfkit') {
    return function () {
      const h = {}; const st = { page: { width: 595, height: 842 }, y: 40 };
      const px = new Proxy(st, { get(t, k) { if (k in t) return t[k]; if (k === 'on') return (e, f) => { h[e] = f; return px; };
        if (k === 'end') return () => { h.data && h.data(Buffer.from('%PDF-fake')); h.end && h.end(); }; return () => px; }, set(t, k, v) { t[k] = v; return true; } });
      return px;
    };
  }
  if (req === 'express') return { Router: () => ({ get() {}, put() {}, post() {} }) };
  if (req === 'zod') { const z = new Proxy(function () {}, { get: () => z, apply: () => z }); return { z }; }
  if (req === './core') return { pool: { query: async () => ({ rows: [] }) }, HttpError: Error, wrap: f => f, body: () => null };
  if (req === './safe') return { swallow: (k, v) => () => v };
  return origLoad.call(this, req, ...a);
};
let ur;
try { process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x@localhost/x'; ur = require('../src/usage_report'); } catch (e) { console.error(e); process.exit(1); }

const src = fs.readFileSync(__dirname + '/../src/usage_report.js', 'utf8');
assert.match(src, /COALESCE\(value->>'last_sent', ''\) <> \$1/, 'réservation atomique');
assert.match(fs.readFileSync(__dirname + '/../src/alerts_scheduler.js', 'utf8'), /monthlyTick/);
(async () => {
  const d = { days: 30, clients: [{ client_name: 'A', seconds: 3700, logins: 3, active_users: 1, users: 2, seconds_change_pct: 10, inactive: false, last_activity: new Date() }], users: [{ display_name: 'Aly', client_name: 'A', seconds: 3700, logins: 3, active_days: 2 }], views: [{ view: 'ventes', minutes: 4 }] };
  const buf = await ur.renderPdf(d, 'novembre 2026'); assert.ok(Buffer.isBuffer(buf));
  console.log('usage-report : OK');
})().catch(e => { console.error(e); process.exit(1); });
