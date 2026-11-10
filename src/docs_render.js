'use strict';
/**
 * Rendu PDF commun « identité de la station » pour les modules récents
 * (Comptabilité, Trésorerie, Vendeurs & commissions, …).
 * Le client envoie le contenu (sections) ; le serveur applique le même moteur que les rapports historiques
 * (src/docs.js) : logo et coordonnées de la station, couleurs de rapport du client, pied de page configuré,
 * signature imposée / personnalisée, cases de validation, numérotation des pages.
 */
const express = require('express');
const { z } = require('zod');
const { HttpError, wrap } = require('./core');
const docs = require('./docs');

const r = express.Router();

const cell = z.union([z.string().max(2000), z.number(), z.null()]).transform(v => v ?? '');
const section = z.discriminatedUnion('type', [
  z.object({ type: z.literal('kpis'), title: z.string().max(200).optional(), items: z.array(z.object({ label: z.string().max(120), value: z.union([z.string().max(120), z.number()]), note: z.string().max(160).optional() })).max(40) }),
  z.object({ type: z.literal('kv'), title: z.string().max(200).optional(), rows: z.array(z.tuple([z.string().max(200), cell])).max(300) }),
  z.object({ type: z.literal('text'), title: z.string().max(200).optional(), text: z.string().max(8000) }),
  z.object({ type: z.literal('options'), title: z.string().max(200).optional(), items: z.array(z.object({ label: z.string().max(80), selected: z.boolean() })).max(60) }),
  // Image (capture de carte) : PNG/JPEG en data-URL, 1,5 Mo max (la limite JSON par défaut du serveur est de 2 Mo).
  z.object({ type: z.literal('image'), title: z.string().max(200).optional(), data: z.string().max(1500000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/), caption: z.string().max(300).optional() }),
  z.object({
    type: z.literal('table'), title: z.string().max(200).optional(),
    head: z.array(z.string().max(120)).min(1).max(14), rows: z.array(z.array(cell).max(14)).max(5000),
    totals: z.array(cell).max(14).optional(), notes: z.array(z.string().max(300)).max(10).optional()
  })
]);
const payload = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().max(200).optional(),
  ref: z.string().max(60).optional(),
  period: z.string().max(120).optional(),
  landscape: z.boolean().optional(),
  filename: z.string().max(80).optional(),
  sections: z.array(section).min(1).max(300),
  signatures: z.array(z.object({ label: z.string().max(60), name: z.string().max(80).optional() })).max(5).optional()
});

const ALLOWED = ['report.view', 'finance.view', 'accounting.view', 'accounting.manage', 'money.manage', 'cash.manage',
  'commission.manage', 'commission.own', 'hr.view', 'hr.manage', 'hr.payroll', 'settings.edit', 'audit.view', 'purchase.manage', 'purchase.pay'];

r.post('/docs/render', wrap(async (req, res) => {
  const perms = req.user && req.user.perms;
  if (!req.sid) throw new HttpError(400, 'Aucune station sélectionnée');
  if (!req.user.is_global && !(perms && ALLOWED.some(p => perms.has(p)))) throw new HttpError(403, 'Droit insuffisant pour générer ce rapport');
  const p = payload.safeParse(req.body);
  if (!p.success) {
    const det = p.error.issues.slice(0, 5).map(i => i.path.join('.') + ' : ' + i.message);
    console.warn('[docs/render] Rapport invalide —', det.join(' | '));   // visible dans les journaux du serveur
    throw new HttpError(400, 'Rapport invalide', det);
  }
  const d = p.data;
  const b = await docs.branding(req.sid);
  const sections = d.sections.map(s => {
    // Les lignes doivent avoir autant de colonnes que l'en-tête
    if (s.type !== 'table') return s;
    const n = s.head.length, fix = row => Array.from({ length: n }, (_, i) => row[i] ?? '');
    return { ...s, rows: s.rows.map(fix), totals: s.totals ? fix(s.totals) : undefined };
  });
  const buf = await docs.buildPdf({
    b, title: d.title.toUpperCase(), subtitle: d.subtitle, ref: d.ref, period: d.period, landscape: d.landscape, sections,
    signatures: (d.signatures && d.signatures.length ? d.signatures : [{ label: 'Établi par' }, { label: 'Responsable' }])
  });
  docs.send(res, 'pdf', buf, d.filename || d.title);
}));

// Export Excel générique : mêmes tableaux que le PDF (une feuille par tableau), mêmes droits et même charte.
r.post('/docs/render-xlsx', wrap(async (req, res) => {
  const perms = req.user && req.user.perms;
  if (!req.sid) throw new HttpError(400, 'Aucune station sélectionnée');
  if (!req.user.is_global && !(perms && ALLOWED.some(p => perms.has(p)))) throw new HttpError(403, 'Droit insuffisant pour générer ce rapport');
  const p = payload.safeParse(req.body);
  if (!p.success) throw new HttpError(400, 'Rapport invalide', p.error.issues.slice(0, 5).map(i => i.path.join('.') + ' : ' + i.message));
  const d = p.data;
  const tables = d.sections.filter(s => s.type === 'table');
  if (!tables.length) throw new HttpError(400, 'Aucun tableau à exporter');
  const b = await docs.branding(req.sid);
  const used = new Set();
  const sheets = tables.map((s, i) => {
    let name = String(s.title || 'Feuille ' + (i + 1)).replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || 'Feuille';
    let k = name, n = 2; while (used.has(k.toLowerCase())) k = name.slice(0, 26) + ' ' + n++;
    used.add(k.toLowerCase());
    const w = s.head.length, fix = row => Array.from({ length: w }, (_, j) => row[j] ?? '');
    return { name: k, head: s.head, rows: [...s.rows.map(fix), ...(s.totals ? [fix(s.totals)] : [])], notes: s.notes };
  });
  const buf = await docs.buildXlsx({ b, title: d.title, subtitle: [d.subtitle, d.period].filter(Boolean).join(' - '), ref: d.ref, sheets });
  docs.send(res, 'xlsx', buf, d.filename || d.title);
}));

module.exports = r;
