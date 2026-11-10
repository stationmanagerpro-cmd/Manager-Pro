// Opérations exceptionnelles de sauvegarde/restauration/réinitialisation.
// Les routes sont réservées au Super Admin et la réinitialisation est désactivée par défaut.
const express = require('express');
const { swallow } = require('./safe');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pool, HttpError, wrap, audit } = require('./core');
const backup = require('./backup');
const bcrypt = require('bcryptjs');
const r = express.Router();
const needPrincipal = (req, res, next) => req.user?.is_global ? next() : next(new HttpError(403, 'Réservé à l’Administrateur Principal'));
const RESET_CONFIRM = 'SUPPRIMER TOUTES LES DONNEES';
async function verifyPrincipalPassword(req, supplied) {
  const password = String(supplied || '');
  if (!password) throw new HttpError(400, 'Saisissez le mot de passe du Super Admin pour confirmer cette opération.');
  const { rows: [u] } = await pool.query('SELECT password_hash, is_global, active FROM users WHERE id=$1 AND deleted_at IS NULL', [req.user.id]);
  if (!u || !u.is_global || !u.active || !(await bcrypt.compare(password, u.password_hash))) {
    throw new HttpError(403, 'Mot de passe Super Admin incorrect. Opération refusée.');
  }
}
const MAX_RESTORE_BYTES = Math.max(1, Math.min(200, +(process.env.RESTORE_MAX_MB || 100))) * 1024 * 1024;
const MAX_RESTORE_UNCOMPRESSED_BYTES = Math.max(1, Math.min(4096, +(process.env.RESTORE_MAX_UNCOMPRESSED_MB || 2048))) * 1024 * 1024;

// Valide le gzip sans charger le dump décompressé complet en mémoire.
function validateGzipFile(file) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(file);
    const gunzip = zlib.createGunzip();
    let bytes = 0, settled = false;
    const fail = err => { if (settled) return; settled = true; input.destroy(); gunzip.destroy(); reject(err); };
    input.on('error', fail);
    gunzip.on('error', err => fail(new Error('Fichier gzip invalide : ' + err.message)));
    gunzip.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_RESTORE_UNCOMPRESSED_BYTES) fail(new Error(`Dump décompressé trop volumineux (limite ${Math.floor(MAX_RESTORE_UNCOMPRESSED_BYTES / 1024 / 1024)} Mo).`));
    });
    gunzip.on('end', () => {
      if (settled) return;
      settled = true;
      if (bytes < 100) reject(new Error('Dump décompressé trop petit'));
      else resolve(bytes);
    });
    input.pipe(gunzip);
  });
}

function runRestoreGzip(file) {
  return new Promise((resolve, reject) => {
    const psql = process.env.PSQL || 'psql';
    let connection;
    try { connection = backup.psqlConnectionOptions(); }
    catch (e) { reject(e); return; }
    const p = spawn(psql, [...connection.args, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q'], { env: connection.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    p.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    p.on('error', e => reject(new Error('psql introuvable ou impossible à lancer : ' + e.message)));
    p.on('close', code => code === 0 ? resolve() : reject(new Error('Restauration PostgreSQL échouée : ' + (stderr.trim() || `code ${code}`))));
    // Le dump est restauré dans une transaction unique. En cas d'erreur, PostgreSQL annule
    // le DROP/CREATE et les données restaurées ensemble.
    p.stdin.write('DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\nGRANT ALL ON SCHEMA public TO CURRENT_USER;\nGRANT ALL ON SCHEMA public TO PUBLIC;\n');
    const gunzip = fs.createReadStream(file).pipe(zlib.createGunzip());
    gunzip.on('error', e => { p.stdin.destroy(e); reject(new Error('Fichier gzip invalide : ' + e.message)); });
    gunzip.pipe(p.stdin);
  });
}

r.get('/admin/maintenance/backup-status', needPrincipal, wrap(async (_req, res) => {
  res.json({ backups: backup.list().slice(0, 20), logs: await backup.listLogs(20),
    email_configured: !!(process.env.SMTP_HOST || process.env.MAIL_MODE),
    email_attachment_enabled: process.env.BACKUP_EMAIL_ATTACH === '1',
    email_attachment_max_mb: Math.max(1, Math.min(20, +(process.env.BACKUP_EMAIL_ATTACH_MAX_MB || 10))),
    restore_enabled: process.env.RESTORE_ENABLED === '1' && process.env.RESTORE_TARGET_ISOLATED === '1',
    restore_blocked_reason: 'La restauration SQL complète exige RESTORE_ENABLED=1 et RESTORE_TARGET_ISOLATED=1. Elle remplace tout le schéma public : cible de reprise isolée uniquement.',
    global_reset_enabled: false, global_reset_blocked_reason: 'La réinitialisation globale est suspendue : l’ancienne implémentation effaçait les données opérationnelles des clients, contrairement au cahier des charges A5.', client_restore_enabled: process.env.CLIENT_RESTORE_ENABLED === '1', client_reset_enabled: process.env.CLIENT_RESET_ENABLED === '1', platform_restore_enabled: process.env.PLATFORM_RESTORE_ENABLED === '1',
    restore_max_mb: Math.floor(MAX_RESTORE_BYTES / 1024 / 1024) });
}));

// Upload binaire gzip: le navigateur envoie le fichier directement, sans le convertir en base64.
r.post('/admin/maintenance/restore', needPrincipal, express.raw({ type: ['application/gzip', 'application/x-gzip', 'application/octet-stream'], limit: MAX_RESTORE_BYTES }), wrap(async (req, res) => {
  if (process.env.RESTORE_ENABLED !== '1' || process.env.RESTORE_TARGET_ISOLATED !== '1') throw new HttpError(403, 'Restauration SQL complète bloquée. Elle exige RESTORE_ENABLED=1 et RESTORE_TARGET_ISOLATED=1, uniquement sur une base de reprise isolée. Cette opération remplace tout le schéma public et peut effacer les données de tous les clients.');
  await verifyPrincipalPassword(req, req.headers['x-superadmin-password']);
  if (!process.env.DATABASE_URL) throw new HttpError(503, 'DATABASE_URL manquant.');
  if (!Buffer.isBuffer(req.body) || req.body.length < 50) throw new HttpError(400, 'Fichier de sauvegarde absent ou trop petit.');
  const tmp = path.join(os.tmpdir(), `smp-restore-${Date.now()}-${process.pid}.sql.gz`);
  try {
    // Vérifier l'en-tête et valider le flux gzip avec une limite décompressée, sans buffer géant.
    if (req.body[0] !== 0x1f || req.body[1] !== 0x8b) throw new HttpError(400, 'Format invalide : sélectionnez une sauvegarde .sql.gz Manager PRO.');
    fs.writeFileSync(tmp, req.body, { mode: 0o600, flag: 'wx' });
    await validateGzipFile(tmp);
    // Toujours prendre une sauvegarde de l'état actuel avant de remplacer le schéma.
    const safety = await backup.runBackup('pre-restore');
    await runRestoreGzip(tmp);
    await pool.query("UPDATE user_sessions SET revoked_at=now() WHERE revoked_at IS NULL").catch(() => {});
    const { rows: [actor] } = await pool.query('SELECT id FROM users WHERE id=$1 AND is_global=true', [req.user.id]).catch(swallow('maintenance:96', { rows: [] }));
    await audit(pool, { ...req, user: { ...req.user, id: actor?.id || null } }, 'maintenance', `Restauration depuis sauvegarde (${req.body.length} octets); sauvegarde préalable ${safety.name}`);
    res.json({ ok: true, restored: true, safety_backup: safety.name, note: 'Restauration terminée. Toutes les sessions ont été révoquées : reconnectez-vous.' });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, e.message || 'Restauration impossible.');
  } finally { try { fs.rmSync(tmp, { force: true }); } catch (_) {} }
}));

r.post('/admin/maintenance/reset-global', needPrincipal, wrap(async (req, res) => {
  // Sécurité A5 : le reset global ne doit jamais toucher aux données opérationnelles des clients.
  // L'ancienne implémentation supprimait toutes les tables non listées dans une whitelist ; cela
  // incluait les ventes, stocks, employés et données financières des clients. Tant qu'un périmètre
  // explicite et audité de tables strictement plateforme n'est pas défini, on échoue fermé.
  await verifyPrincipalPassword(req, req.body?.superadmin_password);
  if (req.body?.confirmation !== RESET_CONFIRM) throw new HttpError(400, `Confirmation requise : saisir exactement « ${RESET_CONFIRM} »`);
  throw new HttpError(409, 'Réinitialisation globale suspendue par sécurité : elle ne doit jamais supprimer les données opérationnelles des clients (cahier des charges A5). Utilisez la fiche A4 pour réinitialiser un client. La réinitialisation des seules données plateforme sera réactivée après définition et test d’un périmètre explicite.');
}));

module.exports = r;
module.exports.validateGzipFile = validateGzipFile;
