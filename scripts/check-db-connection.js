// Vérifie la connexion PostgreSQL définie dans .env : node scripts/check-db-connection.js
// N'écrit rien en base. N'affiche jamais le mot de passe.
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL absent du fichier .env'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });

(async () => {
  try {
    const { rows: [r] } = await pool.query('SELECT current_database() AS db, version() AS v');
    console.log('Connexion PostgreSQL réussie : base « ' + r.db + ' » (' + String(r.v).split(',')[0] + ')');
    const { rows: [t] } = await pool.query("SELECT to_regclass('public.schema_migrations') AS t");
    const files = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.endsWith('.sql'));
    if (!t.t) {
      console.log('Base vide : aucune migration appliquée (' + files.length + ' disponibles). Lancez npm run migrate.');
    } else {
      const { rows } = await pool.query('SELECT name FROM schema_migrations');
      const done = new Set(rows.map(x => x.name));
      const pending = files.filter(f => !done.has(f));
      console.log('Migrations appliquées : ' + done.size + ' — en attente : ' + pending.length + (pending.length ? ' (npm run migrate)' : ''));
    }
  } catch (e) {
    console.error('Connexion impossible : ' + e.message);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
