#!/usr/bin/env node
/**
 * Vérification réelle sauvegarde/restauration sur une base PostgreSQL locale dédiée.
 * Prérequis impératifs : DATABASE_URL vers une base locale dont le nom contient test/ci,
 * ALLOW_DESTRUCTIVE_TESTS=1, droits CREATE/DROP DATABASE et pg_dump/psql compatibles.
 * Crée une base temporaire distincte, restaure le dump, compare le schéma et les lignes,
 * puis supprime uniquement la base temporaire. Ne jamais utiliser en production.
 */
require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Pool } = require('pg');
const backup = require('../src/backup');

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) { console.error('REFUS : DATABASE_URL requis.'); process.exit(1); }
let source;
try { source = new URL(sourceUrl); } catch { console.error('REFUS : DATABASE_URL invalide.'); process.exit(1); }
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const sourceName = decodeURIComponent(source.pathname.replace(/^\//, ''));
if (!localHosts.has(source.hostname.replace(/^\[|\]$/g, '')) || !/(^|[_-])(test|ci)([_-]|$)/i.test(sourceName)) {
  console.error('REFUS : le test exige une base PostgreSQL locale dédiée dont le nom contient test ou ci.'); process.exit(1);
}
if (process.env.ALLOW_DESTRUCTIVE_TESTS !== '1') {
  console.error('REFUS : définir ALLOW_DESTRUCTIVE_TESTS=1 uniquement après vérification que la base source est jetable.'); process.exit(1);
}
if (!sourceName || !/^[A-Za-z0-9_-]+$/.test(sourceName)) {
  console.error('REFUS : nom de base source non pris en charge pour ce test.'); process.exit(1);
}

function runPsql(url, args = [], input = null) {
  const connection = backup.psqlConnectionOptions(url);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PSQL || 'psql', [...connection.args, '-v', 'ON_ERROR_STOP=1', ...args], {
      env: connection.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => reject(new Error('Impossible de lancer psql : ' + e.message)));
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`psql code ${code}: ${stderr.slice(-2000)}`)));
    if (input) child.stdin.end(input); else child.stdin.end();
  });
}

function restoreDump(file, targetUrl) {
  const connection = backup.psqlConnectionOptions(targetUrl);
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PSQL || 'psql', [...connection.args, '-v', 'ON_ERROR_STOP=1', '-q'], {
      env: connection.env, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true
    });
    const input = fs.createReadStream(file);
    const gunzip = zlib.createGunzip();
    let stderr = '', finished = false;
    const fail = e => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error('Restauration de test échouée : ' + (e.message || String(e)) + (stderr ? ' — ' + stderr.slice(-1500) : '')));
    };
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', fail);
    input.on('error', fail);
    gunzip.on('error', fail);
    child.stdin.on('error', e => { if (e.code !== 'EPIPE') fail(e); });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      if (code === 0) resolve();
      else reject(new Error(`Restauration de test échouée (psql code ${code}) : ${stderr.slice(-2000)}`));
    });
    input.pipe(gunzip).pipe(child.stdin);
  });
}

async function schemaSnapshot(pool) {
  const { rows: columns } = await pool.query(`
    SELECT table_schema, table_name, column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_schema, table_name, ordinal_position
  `);
  const { rows: tables } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const counts = {};
  for (const { table_name } of tables) {
    const safe = '"' + table_name.replace(/"/g, '""') + '"';
    const result = await pool.query(`SELECT COUNT(*)::bigint AS n FROM public.${safe}`);
    counts[table_name] = String(result.rows[0].n);
  }
  return { columns, counts };
}

async function main() {
  const sourcePool = new Pool({ connectionString: sourceUrl });
  const tempName = `smp_restore_test_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  if (!/^[A-Za-z0-9_]+$/.test(tempName)) throw new Error('Nom temporaire invalide.');
  const tempUrl = new URL(sourceUrl);
  tempUrl.pathname = '/' + tempName;
  let created = false;
  let backupPath = null;
  try {
    const sourceSnapshot = await schemaSnapshot(sourcePool);
    const result = await backup.dump();
    backupPath = path.join(backup.dir(), result.name);
    if (!fs.existsSync(backupPath)) throw new Error('Le fichier de sauvegarde annoncé est introuvable : ' + result.name);
    console.log(`Sauvegarde créée et validée : ${result.name} (${result.size} octets compressés, ${result.uncompressed_size} octets décompressés).`);

    // Création uniquement de la base temporaire au nom généré; la base source n'est jamais réinitialisée.
    await runPsql(sourceUrl, ['-q', '-c', `CREATE DATABASE "${tempName}"`]);
    created = true;
    await restoreDump(backupPath, tempUrl.toString());
    console.log('Restauration dans la base temporaire : OK.');

    const restoredPool = new Pool({ connectionString: tempUrl.toString() });
    try {
      const restoredSnapshot = await schemaSnapshot(restoredPool);
      if (JSON.stringify(sourceSnapshot.columns) !== JSON.stringify(restoredSnapshot.columns)) {
        throw new Error('Le schéma restauré diffère du schéma source (colonnes/types/nullabilité).');
      }
      if (JSON.stringify(sourceSnapshot.counts) !== JSON.stringify(restoredSnapshot.counts)) {
        throw new Error('Les nombres de lignes diffèrent entre la source et la restauration.');
      }
      console.log(`Comparaison réussie : ${sourceSnapshot.columns.length} colonnes, ${Object.keys(sourceSnapshot.counts).length} tables, nombres de lignes identiques.`);
    } finally { await restoredPool.end(); }
  } finally {
    if (created) {
      try { await runPsql(sourceUrl, ['-q', '-c', `DROP DATABASE "${tempName}"`]); console.log('Base temporaire supprimée : OK.'); }
      catch (e) { console.error('ATTENTION : impossible de supprimer la base temporaire ' + tempName + ' : ' + e.message); }
    }
    await sourcePool.end();
    if (backupPath && fs.existsSync(backupPath) && process.env.KEEP_RESTORE_TEST_BACKUP !== '1') {
      try { fs.rmSync(backupPath, { force: true }); } catch (_) {}
    }
  }
}

main().catch(e => { console.error(e.message || e); process.exitCode = 1; });
