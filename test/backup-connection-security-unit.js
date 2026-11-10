const assert = require('assert');
const backup = require('../src/backup');

const options = backup.pgDumpConnectionOptions('postgresql://station_user:p%40ss%3Aword@127.0.0.1:5432/station_manager_test?sslmode=prefer&connect_timeout=8&application_name=station-manager');
assert.ok(options.args.includes('--host=127.0.0.1'));
assert.ok(options.args.includes('--port=5432'));
assert.ok(options.args.includes('--username=station_user'));
assert.ok(options.args.includes('--dbname=station_manager_test'));
assert.ok(!options.args.join(' ').includes('p@ss:word'));
assert.strictEqual(options.env.PGPASSWORD, 'p@ss:word');
assert.strictEqual(options.env.PGSSLMODE, 'prefer');
assert.strictEqual(options.env.PGCONNECT_TIMEOUT, '8');
assert.strictEqual(options.env.PGAPPNAME, 'station-manager');
assert.throws(() => backup.pgDumpConnectionOptions('not-a-url'), /DATABASE_URL invalide/);
assert.throws(() => backup.pgDumpConnectionOptions('https://example.com/db'), /protocole PostgreSQL attendu/);
assert.throws(() => backup.pgDumpConnectionOptions('postgresql://user:pass@localhost'), /nom de base absent/);
console.log('Sécurité connexion pg_dump : 10 assertions réussies.');
