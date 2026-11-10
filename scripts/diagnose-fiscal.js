'use strict';
// Diagnostic read-only du module Fiscalité. Ne modifie jamais la base et ne révèle aucun secret.
require('dotenv').config();
const { Pool } = require('pg');

function configProblem() {
  const raw = process.env.DATABASE_URL;
  if (typeof raw !== 'string' || !raw.trim()) {
    return 'DATABASE_URL est absent ou vide dans .env. Le serveur utilise cette variable pour PostgreSQL.';
  }
  let parsed;
  try { parsed = new URL(raw); }
  catch { return 'DATABASE_URL ne peut pas être interprété comme une URL PostgreSQL valide.'; }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    return 'DATABASE_URL doit utiliser le protocole postgres:// ou postgresql://.';
  }
  if (!parsed.hostname || !parsed.pathname || parsed.pathname === '/') {
    return 'DATABASE_URL doit préciser l’hôte et le nom de la base.';
  }
  if (!parsed.username) return 'DATABASE_URL ne contient pas de nom d’utilisateur PostgreSQL.';
  if (!parsed.password) return 'Mot de passe PostgreSQL absent de DATABASE_URL. Cela correspond à l’erreur « client password must be a string » lorsque SCRAM est utilisé.';
  return null;
}

async function main() {
  const problem = configProblem();
  if (problem) {
    console.error('DIAGNOSTIC FISCALITÉ — CONFIGURATION');
    console.error('ÉCHEC : ' + problem);
    console.error('Vérifiez .env localement. Ne partagez jamais le mot de passe ni le fichier .env.');
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 1 });
  try {
    const { rows: [db] } = await pool.query('SELECT current_database() AS database, current_user AS db_user, version() AS version');
    console.log('Connexion PostgreSQL : OK');
    console.log('Base ciblée : ' + db.database);
    console.log('Utilisateur PostgreSQL : ' + db.db_user);
    const { rows: [schema] } = await pool.query(`SELECT
      to_regclass('public.fiscal_profiles') IS NOT NULL AS fiscal_profiles,
      to_regclass('public.fiscal_module_activations') IS NOT NULL AS fiscal_module_activations,
      to_regclass('public.fiscal_periods') IS NOT NULL AS fiscal_periods,
      to_regclass('public.fiscal_rules') IS NOT NULL AS fiscal_rules,
      to_regclass('public.fiscal_deadlines') IS NOT NULL AS fiscal_deadlines,
      to_regclass('public.fiscal_documents') IS NOT NULL AS fiscal_documents,
      to_regclass('public.fiscal_audit_log') IS NOT NULL AS fiscal_audit_log,
      to_regclass('public.fiscal_checklist_items') IS NOT NULL AS fiscal_checklist_items,
      to_regclass('public.schema_migrations') IS NOT NULL AS schema_migrations,
      to_regclass('public.permissions') IS NOT NULL AS permissions,
      to_regclass('public.role_permissions') IS NOT NULL AS role_permissions`);
    const missingTables = Object.entries(schema).filter(([k, v]) => k !== 'schema_migrations' && !v).map(([k]) => k);
    console.log('Tables et structures fiscales : ' + (missingTables.length ? 'INCOMPLET' : 'OK'));
    if (missingTables.length) console.log('Tables absentes : ' + missingTables.join(', '));

    if (schema.schema_migrations) {
      const { rows } = await pool.query("SELECT name FROM schema_migrations WHERE name IN ('046_fiscalite.sql','050_fiscal_checklist.sql','057_fiscal_access_permission.sql','058_fiscalite_admin_platform_only.sql') ORDER BY name");
      const done = new Set(rows.map(x => x.name));
      const expected = ['046_fiscalite.sql', '050_fiscal_checklist.sql', '057_fiscal_access_permission.sql', '058_fiscalite_admin_platform_only.sql'];
      const pending = expected.filter(x => !done.has(x));
      console.log('Historique migrations fiscales : ' + (pending.length ? 'INCOMPLET' : 'OK'));
      if (pending.length) console.log('À contrôler : ' + pending.join(', '));
    } else console.log('Historique migrations : TABLE schema_migrations ABSENTE');

    if (schema.permissions && schema.role_permissions) {
      const { rows: [p] } = await pool.query(`SELECT EXISTS(SELECT 1 FROM permissions WHERE code='fiscal.access') AS permission_exists,
        EXISTS(SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions pe ON pe.id=rp.permission_id WHERE r.code='ADMIN' AND pe.code='fiscal.access') AS admin_role_has_permission`);
      console.log('Permission fiscal.access : ' + (p.permission_exists ? 'OK' : 'ABSENTE'));
      console.log('Rôle ADMIN (administrateur local) avec accès Fiscalité : ' + (p.admin_role_has_permission ? 'OK' : 'ABSENT — appliquer les migrations 062/065'));
      if (!p.admin_role_has_permission) process.exitCode = 1;
    } else console.log('Vérification des permissions : impossible, tables permissions/role_permissions absentes');

    console.log('Diagnostic terminé en lecture seule. Aucun changement n’a été appliqué.');
    if (missingTables.length || !schema.schema_migrations) process.exitCode = 1;
    if (schema.permissions && schema.role_permissions) {
      const { rows: [sa] } = await pool.query(`SELECT EXISTS(SELECT 1 FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions pe ON pe.id=rp.permission_id WHERE r.code IN ('SUPERADMIN','SUPER_ADMIN') AND pe.code='fiscal.access') AS bad`);
      console.log('Rôle SUPERADMIN sans accès opérationnel Fiscalité : ' + (sa.bad ? 'ANOMALIE — accès à retirer' : 'OK'));
      if (sa.bad) process.exitCode = 1;
    }
  } catch (e) {
    console.error('DIAGNOSTIC FISCALITÉ — ÉCHEC');
    if (e.code === '28P01' || /password must be a string/i.test(e.message)) {
      console.error('Authentification PostgreSQL impossible. Vérifiez le mot de passe de DATABASE_URL dans .env.');
    } else if (e.code === 'ECONNREFUSED') {
      console.error('Connexion refusée. Vérifiez que le service PostgreSQL tourne et que l’hôte/port sont corrects.');
    } else if (e.code === 'ENOTFOUND') {
      console.error('Hôte PostgreSQL introuvable. Vérifiez l’hôte dans DATABASE_URL.');
    } else {
      console.error('Erreur PostgreSQL (' + (e.code || 'sans code') + ') : ' + e.message);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();
module.exports = { configProblem };
