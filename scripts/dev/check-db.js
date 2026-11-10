require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  try {
    console.log('\n===== UTILISATEUR ADMIN =====');

    const result = await pool.query(`
      SELECT
        id,
        login,
        is_global,
        role_id
      FROM users
      WHERE LOWER(login) = 'admin'
    `);

    if (result.rows.length === 0) {
      console.log('Aucun utilisateur "admin" trouvé.');
    } else {
      console.table(result.rows);
    }

  } catch (err) {
    console.error('\nERREUR DETAILLEE :');
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

main();
