// Sauvegarde automatique de la base (pg_dump compressé), rotation, journal, e-mail.
// Priorité 13 : ne jamais simuler une réussite — status 'ok' uniquement après dump réel.
const { spawn } = require('child_process'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { swallow } = require('./safe');
const dir = () => path.resolve(process.env.BACKUP_DIR || './backups');
const NAME = /^smp-[\w.-]+\.sql\.gz$/;

/** Retourne les chemins candidats de pg_dump (version la plus récente en premier). */
function pgDumpCandidates() {
  const found = new Set();
  if (process.env.PG_DUMP) found.add(process.env.PG_DUMP);
  found.add('pg_dump');
  const roots = [
    '/usr/lib/postgresql',
    '/usr/pgsql',
    '/usr/local/pgsql',
    '/opt/homebrew/opt/libpq/bin',
    '/usr/local/opt/libpq/bin',
    '/usr/bin',
    '/usr/local/bin'
  ];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      // /usr/lib/postgresql/16/bin/pg_dump etc.
      let entries = [];
      try { entries = fs.readdirSync(root); } catch (_) { entries = []; }
      for (const name of entries) {
        const cand = path.join(root, name, 'bin', 'pg_dump');
        if (fs.existsSync(cand)) found.add(cand);
        const cand2 = path.join(root, name, 'pg_dump');
        if (fs.existsSync(cand2)) found.add(cand2);
      }
      const direct = path.join(root, 'pg_dump');
      if (fs.existsSync(direct)) found.add(direct);
    } catch (_) {}
  }
  // Trier : chemins avec numéro de version décroissant en premier
  return [...found].sort((a, b) => {
    const va = +(String(a).match(/(\d+)(?:\.\d+)?/) || [0, 0])[1];
    const vb = +(String(b).match(/(\d+)(?:\.\d+)?/) || [0, 0])[1];
    return vb - va;
  });
}

/** Décompose DATABASE_URL sans placer le secret dans la ligne de commande pg_dump. */
function pgDumpConnectionOptions(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL manquant — impossible de sauvegarder');
  let u;
  try { u = new URL(connectionString); }
  catch (_) { throw new Error('DATABASE_URL invalide : une URL PostgreSQL est attendue.'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) {
    throw new Error('DATABASE_URL invalide : protocole PostgreSQL attendu.');
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL invalide : nom de base absent.');
  const args = ['--no-owner', '--no-acl'];
  if (u.hostname) args.push('--host=' + u.hostname);
  if (u.port) args.push('--port=' + u.port);
  if (u.username) args.push('--username=' + decodeURIComponent(u.username));
  args.push('--dbname=' + database);
  const env = { ...process.env };
  // Le mot de passe est transmis dans l'environnement du processus enfant, jamais en argument.
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'connect_timeout', 'application_name']) {
    const value = u.searchParams.get(key);
    if (value !== null && value !== '') {
      const envKey = ({ sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME' })[key];
      env[envKey] = value;
    }
  }
  return { args, env };
}

/** Décompose DATABASE_URL pour psql sans exposer le mot de passe dans les arguments. */
function psqlConnectionOptions(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL manquant — impossible de restaurer');
  let u;
  try { u = new URL(connectionString); }
  catch (_) { throw new Error('DATABASE_URL invalide : une URL PostgreSQL est attendue.'); }
  if (!['postgres:', 'postgresql:'].includes(u.protocol)) throw new Error('DATABASE_URL invalide : protocole PostgreSQL attendu.');
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL invalide : nom de base absent.');
  const args = [];
  if (u.hostname) args.push('--host=' + u.hostname);
  if (u.port) args.push('--port=' + u.port);
  if (u.username) args.push('--username=' + decodeURIComponent(u.username));
  args.push('--dbname=' + database);
  const env = { ...process.env };
  if (u.password) env.PGPASSWORD = decodeURIComponent(u.password);
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'connect_timeout', 'application_name']) {
    const value = u.searchParams.get(key);
    if (value !== null && value !== '') {
      const envKey = ({ sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY', connect_timeout: 'PGCONNECT_TIMEOUT', application_name: 'PGAPPNAME' })[key];
      env[envKey] = value;
    }
  }
  return { args, env };
}

function runPgDump(bin, file) {
  return new Promise((resolve, reject) => {
    let connection;
    try { connection = pgDumpConnectionOptions(); } catch (e) { reject(e); return; }
    const p = spawn(bin, connection.args, { env: connection.env, windowsHide: true });
    const out = fs.createWriteStream(file);
    const gzip = zlib.createGzip();
    let err = '', settled = false, code = null, childClosed = false, outputFinished = false;
    const fail = e => { if (settled) return; settled = true; out.destroy(); reject(e); };
    const finishIfReady = () => {
      if (settled || !childClosed || !outputFinished) return;
      settled = true;
      if (code !== 0) reject(new Error((err || 'code ' + code).trim()));
      else resolve();
    };
    p.on('error', e => fail(new Error('Impossible de lancer ' + bin + ' : ' + e.message)));
    p.stderr.on('data', d => { err += d; });
    p.stdout.on('error', fail);
    gzip.on('error', fail);
    out.on('error', fail);
    p.stdout.pipe(gzip).pipe(out);
    p.on('close', c => { code = c; childClosed = true; finishIfReady(); });
    out.on('finish', () => { outputFinished = true; finishIfReady(); });
  });
}

function isVersionMismatch(msg) {
  return /server version|pg_dump version|version mismatch|aborting because of server version/i.test(msg || '');
}

/**
 * Vérifie réellement l'intégrité gzip et le contenu SQL du dump en flux,
 * sans charger toute la sauvegarde en mémoire.
 * Le dump est en SQL texte (pg_dump sans option de format personnalisée).
 */
function verifyDump(file) {
  return new Promise((resolve, reject) => {
    let compressedSize = 0;
    let uncompressedSize = 0;
    let prefix = Buffer.alloc(0);
    let settled = false;
    const input = fs.createReadStream(file);
    const gunzip = zlib.createGunzip();
    const fail = err => {
      if (settled) return;
      settled = true;
      reject(new Error('Vérification de sauvegarde échouée : ' + (err.message || String(err))));
    };
    input.on('data', chunk => { compressedSize += chunk.length; });
    gunzip.on('data', chunk => {
      uncompressedSize += chunk.length;
      if (prefix.length < 65536) {
        const needed = 65536 - prefix.length;
        prefix = Buffer.concat([prefix, chunk.subarray(0, needed)]);
      }
    });
    input.on('error', fail);
    gunzip.on('error', fail); // inclut CRC gzip invalide ou flux tronqué
    gunzip.on('end', () => {
      if (settled) return;
      if (compressedSize < 50) return fail(new Error('fichier compressé trop petit'));
      if (uncompressedSize < 100) return fail(new Error('contenu SQL décompressé trop petit'));
      if (!prefix.toString('utf8').includes('PostgreSQL database dump')) {
        return fail(new Error('signature de dump SQL PostgreSQL absente'));
      }
      settled = true;
      resolve({ compressedSize, uncompressedSize });
    });
    input.pipe(gunzip);
  });
}

function dump() {
  return new Promise(async (resolve, reject) => {
    try {
      if (!process.env.DATABASE_URL) {
        return reject(new Error('DATABASE_URL manquant — impossible de sauvegarder'));
      }
      fs.mkdirSync(dir(), { recursive: true });
      const name = `smp-${new Date().toISOString().replace(/[:.]/g, '-')}.sql.gz`;
      const file = path.join(dir(), name);
      const candidates = pgDumpCandidates();
      let lastErr = null;
      for (const bin of candidates) {
        try {
          await runPgDump(bin, file);
          // Ne déclarer une sauvegarde réussie qu'après validation du flux gzip et du SQL.
          try {
            const verified = await verifyDump(file);
            prune();
            return resolve({ name, size: verified.compressedSize, uncompressed_size: verified.uncompressedSize, pg_dump: bin });
          } catch (e) {
            fs.rmSync(file, { force: true });
            lastErr = e;
            continue;
          }
        } catch (e) {
          fs.rmSync(file, { force: true });
          lastErr = e;
          const msg = e.message || String(e);
          // Si mismatch de version, essayer le candidat suivant (souvent une version plus récente)
          if (isVersionMismatch(msg)) {
            console.warn('[backup] Version incompatible avec', bin, '—', msg.slice(0, 120));
            continue;
          }
          // Autre erreur fatale sur ce binaire : continuer quand même à explorer
          console.warn('[backup] Échec avec', bin, '—', msg.slice(0, 120));
        }
      }
      const hint = lastErr && isVersionMismatch(lastErr.message)
        ? ' Installez un client PostgreSQL de version ≥ serveur (ex. postgresql-client-18) ou définissez PG_DUMP=/chemin/vers/pg_dump compatible.'
        : ' Vérifiez DATABASE_URL, les droits et que pg_dump est installé (PG_DUMP).';
      reject(new Error('pg_dump a échoué : ' + ((lastErr && lastErr.message) || 'aucun binaire compatible') + '.' + hint));
    } catch (e) {
      reject(e);
    }
  });
}

function list() {
  if (!fs.existsSync(dir())) return [];
  return fs.readdirSync(dir())
    .filter(f => NAME.test(f))
    .map(f => {
      const s = fs.statSync(path.join(dir(), f));
      return { name: f, size: s.size, created_at: s.mtime };
    })
    .sort((a, b) => b.created_at - a.created_at);
}

function prune() {
  const limit = Date.now() - (+process.env.BACKUP_KEEP_DAYS || 14) * 864e5;
  for (const b of list()) {
    if (b.created_at.getTime() < limit) fs.rmSync(path.join(dir(), b.name), { force: true });
  }
}

/** Enregistre le résultat dans backup_logs (si la table existe). */
async function logResult({ kind, status, file_name, file_size, duration_ms, error_message, email_sent, email_error }) {
  try {
    const { pool } = require('./core');
    await pool.query(
      `INSERT INTO backup_logs(kind, status, file_name, file_size, duration_ms, error_message, email_sent, email_error, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
      [kind || 'manual', status, file_name || null, file_size || null, duration_ms || null,
       error_message || null, !!email_sent, email_error || null]
    );
  } catch (e) {
    console.warn('[backup] journal non enregistré :', e.message);
  }
}

/** Envoi e-mail si SMTP configuré (succès ou échec). */
async function resolveBackupRecipients() {
  const recipients = [];
  const primary = process.env.BACKUP_NOTIFY_EMAIL || process.env.MAIL_ADMIN || process.env.SMTP_USER;
  if (primary) recipients.push(primary);
  // Secondaires depuis env (BACKUP_NOTIFY_EMAIL_2) ou app_settings / settings
  if (process.env.BACKUP_NOTIFY_EMAIL_2) recipients.push(process.env.BACKUP_NOTIFY_EMAIL_2);
  if (process.env.BACKUP_NOTIFY_EMAIL_3) recipients.push(process.env.BACKUP_NOTIFY_EMAIL_3);
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'backup_emails'
       UNION ALL
       SELECT value FROM settings WHERE key = 'backup_emails' LIMIT 1`
    ).catch(require('./safe').swallow('backup:destinataires-email', { rows: [] }));
    await pool.end().catch(() => {});
    if (rows[0] && rows[0].value) {
      const v = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
      if (v.primary && !recipients.includes(v.primary)) recipients.push(v.primary);
      (v.secondary || []).slice(0, 2).forEach(e => { if (e && !recipients.includes(e)) recipients.push(e); });
    }
  } catch (_) {}
  return [...new Set(recipients.filter(Boolean))];
}

async function notifyEmail({ success, name, size, error, kind, file }) {
  if (!process.env.SMTP_HOST && !process.env.MAIL_MODE) return { sent: false };
  const recipients = await resolveBackupRecipients();
  if (!recipients.length) return { sent: false, error: 'BACKUP_NOTIFY_EMAIL non défini' };
  try {
    const { sendMail } = require('./mailer');
    const appName = (await require('./branding').load().catch(swallow('backup:284', null)))?.name || 'Station Manager';
    const subject = success
      ? `[${appName}] Sauvegarde ${kind || ''} OK : ${name}`
      : `[${appName}] ÉCHEC sauvegarde ${kind || ''}`;
    const text = success
      ? `Sauvegarde réussie.\nFichier : ${name}\nTaille : ${size} octets\nDate : ${new Date().toISOString()}`
      : `Sauvegarde échouée.\nErreur : ${error}\nDate : ${new Date().toISOString()}\n\nVérifiez pg_dump, DATABASE_URL et l'espace disque.`;
    // Envoi à toutes les adresses (primaire + jusqu'à 2 secondaires).
    // La pièce jointe est opt-in pour éviter les rejets SMTP et l'exposition involontaire
    // de bases volumineuses. BACKUP_EMAIL_ATTACH=1 active l'envoi du dump compressé.
    let attachments = [];
    let attachmentNote = '';
    if (success && process.env.BACKUP_EMAIL_ATTACH === '1' && file) {
      const maxMb = Math.max(1, Math.min(20, +(process.env.BACKUP_EMAIL_ATTACH_MAX_MB || 10)));
      const stat = fs.statSync(file);
      if (stat.size <= maxMb * 1024 * 1024) {
        // D3-B : la pièce jointe est chiffrée (AES-256-GCM) si BACKUP_ENCRYPTION_KEY est définie. Sans clé, le dump n'est PAS joint,
        // sauf choix explicite et assumé BACKUP_EMAIL_ATTACH_PLAINTEXT=1 (ancien comportement, déconseillé).
        const crypt = require('./backup_crypto');
        if (crypt.isConfigured()) {
          attachments = [{ filename: name + '.enc', content: crypt.encryptBuffer(fs.readFileSync(file)), contentType: 'application/octet-stream' }];
          attachmentNote = '\nPièce jointe chiffrée (AES-256-GCM) : déchiffrez-la avec scripts/decrypt-backup.js et la clé BACKUP_ENCRYPTION_KEY.';
        } else if (process.env.BACKUP_EMAIL_ATTACH_PLAINTEXT === '1') {
          attachments = [{ filename: name, path: file, contentType: 'application/gzip' }];
        } else {
          attachmentNote = '\nPièce jointe non envoyée : définissez BACKUP_ENCRYPTION_KEY (16 caractères minimum) pour joindre une sauvegarde chiffrée.';
        }
      } else {
        attachmentNote = `\nPièce jointe non envoyée : fichier supérieur à la limite configurée (${maxMb} Mo). Téléchargez la sauvegarde depuis l'interface sécurisée.`;
      }
    }
    const finalText = text + attachmentNote + (success && !attachments.length && process.env.BACKUP_EMAIL_ATTACH !== '1' ? `\nLa sauvegarde n'est pas jointe à cet email. Activez BACKUP_EMAIL_ATTACH=1 si votre fournisseur accepte les pièces jointes.` : '');
    for (const to of recipients) {
      await sendMail({ to, subject, text: finalText, attachments });
    }
    return { sent: true, recipients, attachment_sent: attachments.length > 0, attachment_note: attachmentNote || null };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

/**
 * Exécute une sauvegarde, journalise le résultat, envoie un e-mail si configuré.
 * Ne marque jamais status=ok sans dump réel réussi.
 */
async function runBackup(kind = 'manual') {
  const t0 = Date.now();
  try {
    const r = await dump();
    const duration_ms = Date.now() - t0;
    const mail = await notifyEmail({ success: true, name: r.name, size: r.size, kind, file: path.join(dir(), r.name) });
    await logResult({
      kind, status: 'ok', file_name: r.name, file_size: r.size, duration_ms,
      email_sent: mail.sent, email_error: mail.error || null
    });
    return { ...r, duration_ms, email_sent: mail.sent, email_attachment_sent: !!mail.attachment_sent, email_error: mail.error || null };
  } catch (e) {
    const duration_ms = Date.now() - t0;
    const mail = await notifyEmail({ success: false, error: e.message, kind });
    await logResult({
      kind, status: 'failed', duration_ms, error_message: e.message,
      email_sent: mail.sent, email_error: mail.error || null
    });
    throw e;
  }
}

/** Historique des journaux (derniers N). */
async function listLogs(limit = 30) {
  try {
    const { pool } = require('./core');
    const { rows } = await pool.query(
      `SELECT id, kind, status, file_name, file_size, duration_ms, error_message,
              email_sent, email_error, started_at, finished_at
       FROM backup_logs ORDER BY started_at DESC LIMIT $1`,
      [Math.min(+limit || 30, 100)]
    );
    return rows;
  } catch (_) {
    return [];
  }
}

/** Diagnostic versions serveur / pg_dump pour l'UI admin. */
function diagnose() {
  const { spawnSync } = require('child_process');
  const bins = pgDumpCandidates();
  const versions = [];
  for (const bin of bins.slice(0, 8)) {
    try {
      const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 4000 });
      const out = ((r.stdout || '') + (r.stderr || '')).trim();
      if (out) versions.push({ bin, version: out });
    } catch (_) {}
  }
  return {
    pg_dump_env: process.env.PG_DUMP || null,
    candidates: bins,
    versions,
    backup_auto: process.env.BACKUP_AUTO === '1',
    backup_hour: +(process.env.BACKUP_HOUR || 2),
    backup_dir: dir(),
    note: 'pg_dump doit être en version ≥ version majeure du serveur PostgreSQL.'
  };
}

// Une sauvegarde par jour, après BACKUP_HOUR (2 h par défaut). Activée avec BACKUP_AUTO=1.
function startScheduler() {
  if (process.env.BACKUP_AUTO !== '1') {
    console.log('[backup] Planificateur désactivé (BACKUP_AUTO≠1)');
    return null;
  }
  const tick = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const hour = new Date().getHours();
    if (hour < (+process.env.BACKUP_HOUR || 2)) return;
    if (list().some(b => b.created_at.toISOString().slice(0, 10) === today)) return;
    try {
      // RG-08 : une seule sauvegarde par jour quel que soit le nombre d'instances (verrou + contrôle du journal partagé en base).
      const { withTaskLock, TASK_LOCKS } = require('./task_lock');
      const r = await withTaskLock(TASK_LOCKS.BACKUP, async () => {
        const { pool } = require('./core');
        const { rows } = await pool.query(
          `SELECT 1 FROM backup_logs WHERE kind = 'auto' AND status = 'ok'
              AND (started_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date LIMIT 1`);
        if (rows.length) return { skipped: 'already_done_today' };
        return runBackup('auto');
      });
      if (r && r.skipped) return;
      console.log('Sauvegarde automatique : ' + r.name + ' (' + r.size + ' octets, ' + r.duration_ms + ' ms)');
    } catch (e) {
      console.error('Sauvegarde automatique échouée : ' + e.message);
    }
  };
  setTimeout(tick, 15000);
  return setInterval(tick, 30 * 60 * 1000);
}

module.exports = { dump, list, dir, NAME, startScheduler, runBackup, listLogs, logResult, diagnose, pgDumpCandidates, pgDumpConnectionOptions, psqlConnectionOptions, verifyDump };

if (require.main === module) {
  require('dotenv').config();
  runBackup('manual')
    .then(r => console.log('Sauvegarde créée : ' + r.name + ' (' + r.size + ' octets)'))
    .catch(e => { console.error(e.message); process.exit(1); });
}
