// Signature personnalisée du compte client : manuscrite et/ou image importée.
// Autorisation préalable du Super Admin (contrat : features.signature_mode = none | handwritten | image | both).
// Une fois activée par le client, elle signe les prochains documents PDF qui comportent un bloc de signature.
const express = require('express');
const { z } = require('zod');
const { pool, HttpError, wrap, need, audit } = require('./core');
const files = require('./files');
const { loadContractForUser } = require('./contracts');

const MODES = ['none', 'handwritten', 'image', 'both'];
const allowedFromFeatures = f => {
  const m = f && f.signature_mode;
  return MODES.includes(m) ? m : 'none';
};
const permits = (allowed, kind) => allowed === 'both' || allowed === kind;
const sniff = b => (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ? 'png'
  : (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) ? 'jpg' : null;   // PDFKit ne lit que PNG et JPEG
const toDataUrl = (buf, ext) => `data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${buf.toString('base64')}`;

async function contractFor(req) {
  if (req.user.is_global || !req.user.client_id) throw new HttpError(403, 'Réservé aux comptes clients : la signature se configure dans le compte du client.');
  const c = req.contract || await loadContractForUser(req.user.id, false);
  return { suspended: !!c.suspended, allowed: c.suspended ? 'none' : allowedFromFeatures(c.features) };
}
async function row(clientId) {
  const { rows: [s] } = await pool.query('SELECT * FROM client_signatures WHERE client_id=$1', [clientId]);
  return s || null;
}
async function view(clientId, allowed) {
  const s = await row(clientId);
  const out = { allowed, active: false, active_mode: null, signer_name: s?.signer_name || '', handwritten: null, image: null };
  for (const [k, col] of [['handwritten', 'handwritten_path'], ['image', 'image_path']]) {
    if (s?.[col]) { const b = await files.read(s[col]); const e = b && sniff(b); if (e) out[k] = toDataUrl(b, e); }
  }
  // Une signature n'est « active » que si son mode est encore autorisé par le contrat
  out.active = !!(s?.active && s.active_mode && permits(allowed, s.active_mode) && out[s.active_mode]);
  out.active_mode = out.active ? s.active_mode : (s?.active_mode || null);
  return out;
}

/** Utilisée par le moteur de documents : signature à imprimer, ou null. */
async function loadActive(clientId, features, suspended) {
  if (!clientId || suspended) return null;
  const allowed = allowedFromFeatures(features);
  const s = await row(clientId);
  if (!s?.active || !s.active_mode || !permits(allowed, s.active_mode)) return null;
  const buf = await files.read(s.active_mode === 'image' ? s.image_path : s.handwritten_path);
  if (!buf || !sniff(buf)) return null;
  return { buf, name: s.signer_name || '' };
}

const r = express.Router();
const PERM = need('settings.edit', 'appearance.manage');

r.get('/signature', PERM, wrap(async (req, res) => {
  const { allowed } = await contractFor(req);
  res.json(await view(req.user.client_id, allowed));
}));

const putSchema = z.object({
  kind: z.enum(['handwritten', 'image']),
  data_url: z.string().max(3_200_000),
  signer_name: z.string().trim().max(80).optional()
});
r.put('/signature', PERM, wrap(async (req, res) => {
  const { allowed } = await contractFor(req);
  const p = putSchema.safeParse(req.body);
  if (!p.success) throw new HttpError(400, 'Signature invalide', p.error.issues.map(i => i.path.join('.') + ' : ' + i.message));
  const { kind, data_url, signer_name } = p.data;
  if (!permits(allowed, kind)) throw new HttpError(403, kind === 'image'
    ? "L'import d'une image de signature n'est pas autorisé par votre contrat."
    : "La signature manuscrite n'est pas autorisée par votre contrat.");
  const m = /^data:image\/(png|jpeg);base64,/.exec(data_url);
  if (!m) throw new HttpError(415, 'Format accepté pour la signature : PNG ou JPEG');
  const col = kind === 'image' ? 'image_path' : 'handwritten_path';
  const path = await files.save('signatures/' + req.user.client_id, data_url);
  const old = await row(req.user.client_id);
  await pool.query(
    `INSERT INTO client_signatures(client_id, ${col}, signer_name, updated_by, updated_at) VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (client_id) DO UPDATE SET ${col}=EXCLUDED.${col}, signer_name=COALESCE(NULLIF($3,''), client_signatures.signer_name), updated_by=$4, updated_at=now()`,
    [req.user.client_id, path, signer_name ?? null, req.user.id]);
  if (old?.[col]) await files.remove(old[col]).catch(() => {});
  await audit(pool, req, 'paramètres', `Signature ${kind === 'image' ? 'image' : 'manuscrite'} enregistrée`, 'client_signatures');
  res.json(await view(req.user.client_id, allowed));
}));

r.delete('/signature/:kind', PERM, wrap(async (req, res) => {
  const { allowed } = await contractFor(req);
  const kind = req.params.kind;
  if (!['handwritten', 'image'].includes(kind)) throw new HttpError(404, 'Type de signature inconnu');
  const col = kind === 'image' ? 'image_path' : 'handwritten_path';
  const old = await row(req.user.client_id);
  if (old?.[col]) {
    await pool.query(`UPDATE client_signatures SET ${col}=NULL, active=CASE WHEN active_mode=$2 THEN false ELSE active END, updated_by=$3, updated_at=now() WHERE client_id=$1`, [req.user.client_id, kind, req.user.id]);
    await files.remove(old[col]).catch(() => {});
    await audit(pool, req, 'paramètres', `Signature ${kind === 'image' ? 'image' : 'manuscrite'} supprimée`, 'client_signatures');
  }
  res.json(await view(req.user.client_id, allowed));
}));

const actSchema = z.object({ active: z.boolean(), mode: z.enum(['handwritten', 'image']).optional() });
r.post('/signature/activation', PERM, wrap(async (req, res) => {
  const { allowed } = await contractFor(req);
  const p = actSchema.safeParse(req.body);
  if (!p.success) throw new HttpError(400, 'Demande invalide');
  const s = await row(req.user.client_id);
  if (p.data.active) {
    const mode = p.data.mode || s?.active_mode;
    if (!mode) throw new HttpError(400, 'Choisissez la signature à activer (manuscrite ou image).');
    if (!permits(allowed, mode)) throw new HttpError(403, "Ce type de signature n'est pas autorisé par votre contrat.");
    if (!s?.[mode === 'image' ? 'image_path' : 'handwritten_path']) throw new HttpError(409, "Enregistrez d'abord cette signature avant de l'activer.");
    await pool.query('UPDATE client_signatures SET active=true, active_mode=$2, updated_by=$3, updated_at=now() WHERE client_id=$1', [req.user.client_id, mode, req.user.id]);
    await audit(pool, req, 'paramètres', 'Signature des documents activée (' + mode + ')', 'client_signatures');
  } else if (s) {
    await pool.query('UPDATE client_signatures SET active=false, updated_by=$2, updated_at=now() WHERE client_id=$1', [req.user.client_id, req.user.id]);
    await audit(pool, req, 'paramètres', 'Signature des documents désactivée', 'client_signatures');
  }
  res.json(await view(req.user.client_id, allowed));
}));

module.exports = { r, loadActive, allowedFromFeatures, MODES };
