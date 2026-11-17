'use strict';
/**
 * « Besoin d'aide » : procédure et lien vidéo par module.
 * Lecture : tout compte connecté. Écriture : Super Admin uniquement (is_global), jamais un compte client.
 */
const express = require('express');
const { z } = require('zod');
const { pool, wrap, body, audit, HttpError } = require('./core');

// Modules d'aide reconnus : doit rester aligné avec HELP_MODULES de public/ext-help.js.
const HELP_KEYS = ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'caisse', 'emp', 'alert', 'audit', 'param'];

const r = express.Router();

// Schéma créé à la demande (idempotent, identique à migrations/120_help_guides.sql) :
// la migration n'est pas toujours appliquée en production, et sans la table rien ne s'affiche.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`CREATE TABLE IF NOT EXISTS help_guides (
      module_key  TEXT PRIMARY KEY,
      procedure   TEXT NOT NULL DEFAULT '',
      video_url   TEXT NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_by  BIGINT
    )`).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

r.get('/help-guides', wrap(async (req, res) => {
  await ensureSchema();
  const { rows } = await pool.query('SELECT module_key, procedure, video_url, updated_at FROM help_guides');
  res.json({ guides: rows, is_superadmin: !!req.user.is_global });
}));

r.put('/help-guides/:key', body(z.object({
  procedure: z.string().max(20000),
  video_url: z.string().max(500).refine(v => v === '' || /^https:\/\/\S+$/.test(v), 'Lien vidéo : adresse https attendue').optional(),
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au Super Admin : la rédaction des procédures et des liens vidéo est gérée par la plateforme.');
  await ensureSchema();
  const key = String(req.params.key || '');
  if (!HELP_KEYS.includes(key)) throw new HttpError(404, 'Module d’aide inconnu');
  const procedure = req.body.procedure.trim();
  const videoUrl = (req.body.video_url || '').trim();
  const { rows: [g] } = await pool.query(
    `INSERT INTO help_guides (module_key, procedure, video_url, updated_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (module_key) DO UPDATE SET procedure = EXCLUDED.procedure, video_url = EXCLUDED.video_url, updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING module_key, procedure, video_url, updated_at`,
    [key, procedure, videoUrl, req.user.id]);
  await audit(pool, req, 'aide', 'modifier', 'help_guides', key, null, { video_url: videoUrl, procedure_length: procedure.length });
  res.json(g);
}));

module.exports = { r, HELP_KEYS };
