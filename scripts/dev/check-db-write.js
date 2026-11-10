// Diagnostic « Erreur interne » : teste en lecture/écriture (tout est annulé par ROLLBACK, aucune donnée modifiée).
// Usage : node check-db-write.js
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function step(c, name, sql, params) {
  await c.query('SAVEPOINT s');
  try { await c.query(sql, params); console.log('  OK      ' + name); }
  catch (e) { console.log('  ERREUR  ' + name + '  → [' + (e.code || '?') + '] ' + e.message); }
  await c.query('ROLLBACK TO SAVEPOINT s');
}

(async () => {
  const c = await pool.connect();
  try {
    const info = await c.query("SELECT current_setting('transaction_read_only') AS ro, current_setting('default_transaction_read_only') AS dro, pg_is_in_recovery() AS rec, current_user AS u, current_database() AS db");
    console.log('\nConnexion :', info.rows[0]);
    const { rows: [u] } = await c.query("SELECT id FROM users WHERE LOWER(login)='modibo' OR is_global IS NOT TRUE ORDER BY (LOWER(login)='modibo') DESC, id LIMIT 1");
    console.log('Utilisateur de test : id =', u && u.id);
    await c.query('BEGIN');
    console.log('\nÉcritures (annulées ensuite) :');
    await step(c, 'user_preferences (thème)', "INSERT INTO user_preferences(user_id,key,value,updated_at,updated_by) VALUES ($1,'zz_test','{}'::jsonb,now(),$1) ON CONFLICT(user_id,key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=$1", [u.id]);
    await step(c, 'audit_logs', "INSERT INTO audit_logs(station_id,user_id,module,action,table_name,record_id,old_value,new_value,ip_address) VALUES (NULL,$1,'test','test',NULL,NULL,NULL,NULL,'::1')", [u.id]);
    await step(c, 'conversations', 'INSERT INTO conversations(client_id,is_group,created_by) SELECT client_id,FALSE,$1 FROM conversations LIMIT 1', [u.id]);
    await step(c, 'séquence conversations', "SELECT nextval(pg_get_serial_sequence('conversations','id'))");
    await step(c, 'séquence user_preferences/audit_logs', "SELECT nextval(pg_get_serial_sequence('audit_logs','id'))");
    await c.query('ROLLBACK');
    const { rows: seq } = await c.query("SELECT (SELECT max(id) FROM conversations) AS max_conv, (SELECT last_value FROM conversations_id_seq) AS seq_conv, (SELECT max(id) FROM audit_logs) AS max_audit, (SELECT last_value FROM audit_logs_id_seq) AS seq_audit").catch(e => ({ rows: [{ erreur: e.message }] }));
    console.log('\nSéquences (la séquence doit être ≥ au max) :', seq[0]);
  } catch (e) { console.error('\nERREUR :', e.stack); }
  finally { c.release(); await pool.end(); }
})();
