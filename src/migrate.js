// Applique les migrations SQL (dossier migrations/) dans l'ordre, une seule fois chacune : npm run migrate
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
const dir = path.join(__dirname, '..', 'migrations');
// ANO-06 / RG-09 : verrou consultatif PostgreSQL (niveau session) autour de toute la procédure. Deux instances lancées en même temps
// (démarrage simultané du conteneur) ne peuvent pas appliquer la même migration : la seconde attend la fin de la première,
// relit ensuite schema_migrations et constate que tout est déjà appliqué.
const MIGRATION_LOCK_ID = 74120317;
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL }), c = await pool.connect();
  let locked = false;
  try {
    await c.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]); locked = true;
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const { rows: [ex] } = await c.query("SELECT to_regclass('public.stations') AS t");
    // Fail closed : la seule présence de stations ne prouve pas que la migration
    // initiale (ni les migrations suivantes) a été appliquée intégralement.
    // Ne jamais inventer l'historique sur une base existante.
    if (!done.size && ex.t) {
      throw new Error(
        'Historique de migrations vide alors que la table stations existe. ' +
        'ARRÊT DE SÉCURITÉ : aucune migration exécutée. Faites une sauvegarde indépendante, ' +
        'auditez le schéma existant et réconciliez schema_migrations avant de relancer.'
      );
    }
    const pending = files.filter(f => !done.has(f));
    // Ne pas se limiter à la table stations : une base peut contenir des données
    // dans d'autres tables même si stations est absente ou vide. Échec fermé si
    // l'inventaire/contrôle d'existence des lignes ne peut pas être effectué.
    const { rows: publicTables } = await c.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    let hasData = false;
    for (const { table_name } of publicTables) {
      const identifier = '"' + table_name.replace(/"/g, '""') + '"';
      const { rows: [presence] } = await c.query(`SELECT EXISTS (SELECT 1 FROM public.${identifier} LIMIT 1) AS has_rows`);
      if (presence.has_rows) { hasData = true; break; }
    }
    if (pending.length && hasData) {
      // A1 : une base avec des données ne peut pas contourner la sauvegarde préalable.
      // L'option historique --no-backup est refusée pour éviter une migration risquée.
      if (process.argv.includes('--no-backup')) {
        throw new Error(
          'ARRÊT DE SÉCURITÉ : --no-backup est interdit lorsque la base contient des stations. ' +
          'Créez et vérifiez une sauvegarde indépendante avant toute migration.'
        );
      }
      try {
        const r = await require('./backup').dump();
        console.log('Sauvegarde avant migration : ' + r.name + ' (' + r.size + ' octets vérifiés)');
      } catch (e) {
        throw new Error('Sauvegarde préalable impossible (' + e.message + '). Aucune migration n’a été lancée.');
      }
    }
    for (const f of files) {
      if (done.has(f)) continue;
      await c.query('BEGIN');
      try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]); await c.query('COMMIT'); console.log('✔ ' + f); }
      catch (e) { await c.query('ROLLBACK'); throw new Error(f + ' : ' + e.message); }
    }
    console.log('Base à jour.');
  } finally {
    if (locked) await c.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    c.release(); await pool.end();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
