// Diagnostic LECTURE SEULE : compare les migrations du dossier /migrations avec schema_migrations
// et vérifie quelques tables/colonnes clés. Ne modifie rien.
// Usage (à la racine du projet) : node check-schema.js
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Pool } = require('pg');
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const files = fs.readdirSync(path.join(__dirname, 'migrations')).filter(f => f.endsWith('.sql')).sort();
    let done = new Set();
    try { done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(r => r.name)); }
    catch { console.log('schema_migrations absente ou illisible.'); }
    console.log('Migrations enregistrées :', done.size, '/', files.length);
    const missing = files.filter(f => !done.has(f));
    console.log(missing.length ? 'NON enregistrées :\n  ' + missing.join('\n  ') : 'Toutes les migrations sont enregistrées.');
    const tables = ['notification_rules', 'conversations', 'purchases', 'suppliers', 'clients'];
    for (const t of tables) {
      const { rows: [x] } = await pool.query('SELECT to_regclass($1) AS t', ['public.' + t]);
      console.log('table', t, x.t ? 'OK' : 'ABSENTE');
    }
    const cols = [['notification_rules', 'delivery_channels'], ['conversations', 'is_support'], ['purchases', 'ordered_at']];
    for (const [t, c] of cols) {
      const { rowCount } = await pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2", [t, c]);
      console.log('colonne', t + '.' + c, rowCount ? 'OK' : 'ABSENTE');
    }
  } finally { await pool.end(); }
})().catch(e => { console.error(e.message); process.exit(1); });
