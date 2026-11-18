'use strict';
/**
 * « Besoin d'aide » : procédure, lien vidéo et nom par module, plus modules personnalisés.
 * Lecture : tout compte connecté. Écriture : Super Admin uniquement (is_global), jamais un compte client.
 */
const crypto = require('crypto');
const express = require('express');
const { z } = require('zod');
const { pool, wrap, body, audit, HttpError } = require('./core');

// Modules d'aide intégrés : doit rester aligné avec HELP_MODULES de public/ext-help.js.
const HELP_KEYS = ['dash', 'quart', 'ventes', 'prod', 'pompes', 'cli', 'four', 'caisse', 'emp', 'alert', 'audit', 'param'];
// Modules ajoutés par le Super Admin : clé générée par le serveur, jamais saisie par le client.
const CUSTOM_KEY_RE = /^c_[a-f0-9]{12}$/;
const LABEL_MAX = 80;

const r = express.Router();

// Schéma créé à la demande (idempotent, identique à migrations/120 et 121) :
// les migrations ne sont pas toujours appliquées en production, et sans la table rien ne s'affiche.
let schemaReady = null;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS help_guides (
        module_key  TEXT PRIMARY KEY,
        procedure   TEXT NOT NULL DEFAULT '',
        video_url   TEXT NOT NULL DEFAULT '',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by  BIGINT
      );
      ALTER TABLE help_guides ADD COLUMN IF NOT EXISTS label  TEXT NOT NULL DEFAULT '';
      ALTER TABLE help_guides ADD COLUMN IF NOT EXISTS custom BOOLEAN NOT NULL DEFAULT false;`).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

const isBuiltin = key => HELP_KEYS.includes(key);

async function isCustomModule(key) {
  if (!CUSTOM_KEY_RE.test(key)) return false;
  const { rows } = await pool.query('SELECT 1 FROM help_guides WHERE module_key = $1 AND custom = true', [key]);
  return rows.length > 0;
}

function cleanLabel(value, required) {
  const s = String(value ?? '').trim();
  if (required && !s) throw new HttpError(400, 'Nom du module obligatoire');
  if (s.length > LABEL_MAX) throw new HttpError(400, `Nom du module : ${LABEL_MAX} caractères maximum`);
  return s;
}

const httpsOrEmpty = z.string().max(500).refine(v => v === '' || /^https:\/\/\S+$/.test(v), 'Lien vidéo : adresse https attendue');

r.get('/help-guides', wrap(async (req, res) => {
  await ensureSchema();
  const { rows } = await pool.query('SELECT module_key, label, procedure, video_url, custom, updated_at FROM help_guides ORDER BY custom, module_key');
  res.json({ guides: rows, is_superadmin: !!req.user.is_global });
}));

// Création d'un module personnalisé (Super Admin).
r.post('/help-guides', body(z.object({
  label: z.string().max(LABEL_MAX),
  procedure: z.string().max(20000).optional(),
  video_url: httpsOrEmpty.optional(),
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au Super Admin : la rédaction des procédures et des liens vidéo est gérée par la plateforme.');
  await ensureSchema();
  const label = cleanLabel(req.body.label, true);
  const procedure = String(req.body.procedure || '').trim();
  const videoUrl = String(req.body.video_url || '').trim();
  const key = 'c_' + crypto.randomBytes(6).toString('hex');
  const { rows: [g] } = await pool.query(
    `INSERT INTO help_guides (module_key, label, procedure, video_url, custom, updated_by) VALUES ($1,$2,$3,$4,true,$5)
     RETURNING module_key, label, procedure, video_url, custom, updated_at`,
    [key, label, procedure, videoUrl, req.user.id]);
  await audit(pool, req, 'aide', 'creer', 'help_guides', key, null, { label, video_url: videoUrl });
  res.status(201).json(g);
}));

// Modification du nom, de la procédure et du lien vidéo (Super Admin). Nom vide = nom par défaut pour un module intégré.
r.put('/help-guides/:key', body(z.object({
  label: z.string().max(LABEL_MAX).optional(),
  procedure: z.string().max(20000),
  video_url: httpsOrEmpty.optional(),
})), wrap(async (req, res) => {
  if (!req.user.is_global) throw new HttpError(403, 'Réservé au Super Admin : la rédaction des procédures et des liens vidéo est gérée par la plateforme.');
  await ensureSchema();
  const key = String(req.params.key || '');
  const custom = await isCustomModule(key);
  if (!custom && !isBuiltin(key)) throw new HttpError(404, 'Module d’aide inconnu');
  const label = cleanLabel(req.body.label, custom);
  const procedure = req.body.procedure.trim();
  const videoUrl = (req.body.video_url || '').trim();
  const { rows: [g] } = await pool.query(
    `INSERT INTO help_guides (module_key, label, procedure, video_url, updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (module_key) DO UPDATE SET label = EXCLUDED.label, procedure = EXCLUDED.procedure, video_url = EXCLUDED.video_url, updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING module_key, label, procedure, video_url, custom, updated_at`,
    [key, label, procedure, videoUrl, req.user.id]);
  await audit(pool, req, 'aide', 'modifier', 'help_guides', key, null, { label, video_url: videoUrl, procedure_length: procedure.length });
  res.json(g);
}));

module.exports = { r, HELP_KEYS };
