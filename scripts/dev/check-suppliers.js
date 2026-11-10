require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
connectionString: process.env.DATABASE_URL
});

async function main() {
try {
const result = await pool.query(
"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'suppliers' ORDER BY ordinal_position"
);

console.log('Colonnes de la table suppliers :');
console.table(result.rows);

} catch (err) {
console.error('Erreur :', err.message);
process.exitCode = 1;
} finally {
await pool.end();
}
}

main();
