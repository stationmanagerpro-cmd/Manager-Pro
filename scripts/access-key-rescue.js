// Recours serveur pour la clé d'accès (à lancer sur le PC qui héberge l'application, avec le .env du serveur).
//   node scripts/access-key-rescue.js status              état de la politique, des clés et du code de secours
//   node scripts/access-key-rescue.js open                désactive l'exigence de clé (l'écran de connexion s'ouvre ; le mot de passe reste obligatoire)
//   node scripts/access-key-rescue.js new-key [heures]    crée une clé à 4 chiffres déjà ACTIVE (sans limite, ou valable N heures) et l'affiche
//   node scripts/access-key-rescue.js new-recovery        crée un nouveau code de secours Superadmin et l'affiche (une seule fois)
// Tout est journalisé dans access_key_events (kind « rescue_cli »). Ne contourne jamais le mot de passe.
require('dotenv').config();
const { Pool } = require('pg');
const L = require('../src/access_keys_logic');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL absent du fichier .env'); process.exit(1); }
if (!process.env.ACCESS_KEY_SECRET && !process.env.JWT_SECRET) { console.error('JWT_SECRET (ou ACCESS_KEY_SECRET) absent du .env : les clés ne seraient pas compatibles avec le serveur.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
const log = (detail) => pool.query('INSERT INTO access_key_events(kind, detail) VALUES ($1, $2)', ['rescue_cli', detail]).catch(() => {});
const setting = (key, value) => pool.query(
  `INSERT INTO app_settings(key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [key, JSON.stringify(value)]);
const live = `status = 'disponible' AND (expires_at IS NULL OR expires_at > now())`;

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'status') {
      const pol = (await pool.query(`SELECT value FROM app_settings WHERE key = 'access_key_policy'`)).rows[0]?.value;
      const k = (await pool.query(`SELECT COUNT(*) FILTER (WHERE ${live})::int AS vivantes, COUNT(*)::int AS total FROM access_keys`)).rows[0];
      const d = (await pool.query(`SELECT COUNT(DISTINCT u.device_hash)::int AS n FROM access_key_uses u JOIN access_keys x ON x.id = u.key_id WHERE x.status <> 'revoquee'`)).rows[0];
      const r = (await pool.query(`SELECT value FROM app_settings WHERE key = 'access_key_recovery'`)).rows[0]?.value;
      console.log('Politique enregistrée :', pol ? JSON.stringify(pol) : '(aucune : exigée seulement si une clé active existe)');
      console.log('Clés actives :', k.vivantes, '/', k.total, '— appareils de confiance :', d.n);
      console.log('Code de secours :', r && r.hash ? 'défini (' + r.hint + ')' : (r && r.used_at ? 'utilisé le ' + r.used_at : 'non défini'));
      console.log('ACCESS_KEY_DISABLE :', process.env.ACCESS_KEY_DISABLE === '1' ? 'OUI (contrôle désactivé par le .env)' : 'non');
    } else if (cmd === 'open') {
      await setting('access_key_policy', { required: false, pass_minutes: 60 });
      await log('exigence de clé désactivée en ligne de commande');
      console.log('Exigence de clé DÉSACTIVÉE. Connectez-vous (mot de passe requis), puis réactivez-la dans « Clé d’accès » après avoir activé une clé.');
    } else if (cmd === 'new-key') {
      const hours = arg ? Number(arg) : null;
      if (arg && (!Number.isInteger(hours) || hours < 1 || hours > 8760)) throw new Error('Durée invalide (1 à 8760 heures).');
      let done = false;
      for (let i = 0; i < 40 && !done; i++) {
        const key = L.generateKey();
        try {
          await pool.query(
            `INSERT INTO access_keys (key_hash, key_enc, key_hint, status, confirmed_at, expires_at, note)
             VALUES ($1, $2, $3, 'disponible', now(), CASE WHEN $4::int IS NULL THEN NULL ELSE now() + ($4::int * interval '1 hour') END, 'Clé de secours (ligne de commande)')`,
            [L.hashKey(key), L.encryptKey(key), L.hintOf(key), hours]);
          await log('clé de secours créée' + (hours ? ' (' + hours + ' h)' : ''));
          console.log('Clé de secours ACTIVE :', key, hours ? '(valable ' + hours + ' h)' : '(sans limite de durée)');
          console.log('Saisissez-la sur l’écran de connexion : cet appareil deviendra « de confiance » et ne la redemandera plus.');
          done = true;
        } catch (e) { if (e.code !== '23505') throw e; }
      }
      if (!done) throw new Error('Aucune clé libre trouvée : révoquez des clés inutilisées.');
    } else if (cmd === 'new-recovery') {
      const code = L.generateRecoveryCode();
      await setting('access_key_recovery', { hash: L.hashRecovery(code), hint: L.hintRecovery(code), created_at: new Date().toISOString(), created_by_name: 'ligne de commande' });
      await log('nouveau code de secours créé');
      console.log('Code de secours Superadmin (à noter MAINTENANT, il ne sera plus affiché) :', code);
    } else {
      console.log('Usage : node scripts/access-key-rescue.js status | open | new-key [heures] | new-recovery');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('Échec : ' + e.message + (e.code === '42P01' ? ' (base non à jour : npm run migrate)' : ''));
    process.exitCode = 1;
  } finally { await pool.end().catch(() => {}); }
})();
