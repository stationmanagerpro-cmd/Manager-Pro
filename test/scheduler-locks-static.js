'use strict';
// ANO-06 / ANO-07 (RG-08, RG-09) : verrous consultatifs autour des migrations et des planificateurs.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0, queue = Promise.resolve();
function check(label, fn) { queue = queue.then(async () => { await fn(); passed++; console.log('✓ ' + label); }); }

check('migrate.js : verrou consultatif pris avant toute lecture de schema_migrations, libéré à la fin', () => {
  const s = read('src/migrate.js');
  const iLock = s.indexOf("pg_advisory_lock($1)"), iTable = s.indexOf('CREATE TABLE IF NOT EXISTS schema_migrations'), iUnlock = s.indexOf('pg_advisory_unlock');
  assert.ok(iLock > 0 && iLock < iTable, 'le verrou doit précéder CREATE TABLE schema_migrations');
  assert.ok(iUnlock > iTable);
  assert.match(s, /MIGRATION_LOCK_ID = 74120317/);
  assert.match(s, /await c\.query\('BEGIN'\)/, 'une transaction par fichier conservée');
});
check('les identifiants de verrou sont uniques', () => {
  const { TASK_LOCKS } = require('../src/task_lock');
  const v = Object.values(TASK_LOCKS); assert.strictEqual(new Set(v).size, v.length);
  assert.match(read('src/alerts_scheduler.js'), /pg_try_advisory_lock\(74120318\)/); assert.strictEqual(TASK_LOCKS.ALERTS, 74120318);
  assert.match(read('src/scheduled_reports.js'), /pg_try_advisory_lock\(74120319\)/); assert.strictEqual(TASK_LOCKS.REPORTS, 74120319);
});
check('backup.js : la sauvegarde automatique passe par withTaskLock et contrôle le journal partagé', () => {
  const s = read('src/backup.js');
  assert.match(s, /withTaskLock\(TASK_LOCKS\.BACKUP/); assert.match(s, /FROM backup_logs WHERE kind = 'auto' AND status = 'ok'/);
});
check('notification_rules.js : la répartition des règles passe par withTaskLock', () => {
  const s = read('src/notification_rules.js');
  assert.match(s, /withTaskLock\(require\('\.\/task_lock'\)\.TASK_LOCKS\.NOTIFICATIONS, dispatchDueRules\)/);
});
// Comportement réel de withTaskLock avec un faux pool PostgreSQL
function fakeCore(lockAvailable) {
  const log = [];
  const client = { query: async (sql, p) => { log.push(sql.split('(')[0].trim()); return { rows: [{ locked: lockAvailable }] }; }, release: () => log.push('release') };
  const corePath = path.join(root, 'src', 'core.js');
  require.cache[corePath] = { id: corePath, filename: corePath, loaded: true, exports: { pool: { connect: async () => client } } };
  return log;
}
check('withTaskLock : verrou obtenu → tâche exécutée, verrou libéré, connexion rendue', async () => {
  const log = fakeCore(true); const { withTaskLock } = require('../src/task_lock'); let ran = 0;
  const out = await withTaskLock(1, async () => { ran++; return 'ok'; });
  assert.strictEqual(out, 'ok'); assert.strictEqual(ran, 1);
  assert.deepStrictEqual(log, ['SELECT pg_try_advisory_lock', 'SELECT pg_advisory_unlock', 'release']);
});
check('withTaskLock : verrou détenu par une autre instance → tâche NON exécutée', async () => {
  const log = fakeCore(false); const { withTaskLock } = require('../src/task_lock'); let ran = 0;
  const out = await withTaskLock(1, async () => { ran++; });
  assert.strictEqual(ran, 0); assert.deepStrictEqual(out, { skipped: 'another_instance_running' });
  assert.deepStrictEqual(log, ['SELECT pg_try_advisory_lock', 'release']);
});
check('withTaskLock : verrou libéré même si la tâche échoue', async () => {
  const log = fakeCore(true); const { withTaskLock } = require('../src/task_lock');
  await assert.rejects(withTaskLock(1, async () => { throw new Error('boom'); }), /boom/);
  assert.deepStrictEqual(log, ['SELECT pg_try_advisory_lock', 'SELECT pg_advisory_unlock', 'release']);
});
queue.then(() => console.log(`${passed}/${passed} contrôles réussis`)).catch(e => { console.error(e); process.exit(1); });
