#!/usr/bin/env node
// Diagnostic rapide de l’environnement Station Manager Pro.
// Usage : npm run doctor
// N’altère aucune donnée. Codes de sortie : 0 = OK, 1 = problèmes bloquants.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let fails = 0, warns = 0;
const ok = (m) => console.log('  ✔ ' + m);
const warn = (m) => { warns++; console.log('  ⚠ ' + m); };
const bad = (m) => { fails++; console.log('  ✖ ' + m); };

console.log('=== Station Manager Pro — doctor ===');
console.log('Version package :', pkg.version);
console.log('Node            :', process.version);
console.log('CWD             :', process.cwd());
console.log('');

// Node
const major = parseInt(process.version.slice(1), 10);
if (major >= 18) ok('Node >= 18');
else bad('Node ' + process.version + ' — requis >= 18');

// .env
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) ok('.env présent');
else bad('.env absent — copier .env.example ou .env.pc.example');

if (!process.env.DATABASE_URL) bad('DATABASE_URL non défini');
else ok('DATABASE_URL défini');

if (!process.env.JWT_SECRET) bad('JWT_SECRET non défini');
else if (String(process.env.JWT_SECRET).length < 32) warn('JWT_SECRET trop court (< 32 caractères)');
else ok('JWT_SECRET défini (≥ 32 car.)');

// Domaine public (Caddyfile) — ANO-16 : ne jamais déployer avec un domaine fictif
if (fs.existsSync(path.join(root, 'Caddyfile'))) {
  const domain = String(process.env.APP_DOMAIN || '').trim();
  if (!domain) (process.env.NODE_ENV === 'production' ? bad : warn)('APP_DOMAIN non renseigné : le Caddyfile ne peut pas servir votre domaine (voir .env.example)');
  else if (/votredomaine|^example\.|\.example$/i.test(domain)) (process.env.NODE_ENV === 'production' ? bad : warn)('APP_DOMAIN contient un domaine fictif : ' + domain);
  else ok('APP_DOMAIN défini : ' + domain);
}

// Fichiers critiques
for (const f of ['src/server.js', 'src/migrate.js', 'src/shifts.js', 'migrations/001_initial.sql', 'public/app.js']) {
  if (fs.existsSync(path.join(root, f))) ok(f);
  else bad(f + ' manquant');
}

// Migrations
const migDir = path.join(root, 'migrations');
if (fs.existsSync(migDir)) {
  const files = fs.readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
  ok(files.length + ' fichiers de migration');
  const nums = files.map(f => f.split('_')[0]);
  const dup = nums.filter((n, i) => nums.indexOf(n) !== i);
  if (dup.length) warn('Préfixes de migration en double : ' + [...new Set(dup)].join(', '));
  else ok('Aucun préfixe de migration en double');
} else bad('Dossier migrations/ absent');

// PostgreSQL (si pg dispo et DATABASE_URL)
(async () => {
  try {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 4000 });
    const c = await pool.connect();
    try {
      const { rows: [v] } = await c.query('SELECT version() AS v');
      ok('PostgreSQL joignable : ' + String(v.v).split(',')[0]);
      const { rows: mig } = await c.query(
        `SELECT to_regclass('public.schema_migrations') AS t`);
      if (mig[0]?.t) {
        const { rows: [cnt] } = await c.query('SELECT COUNT(*)::int AS n FROM schema_migrations');
        ok('schema_migrations : ' + cnt.n + ' entrée(s)');
      } else warn('Table schema_migrations absente — lancer npm run migrate');
      const { rows: [st] } = await c.query(`SELECT to_regclass('public.stations') AS t`);
      if (st?.t) ok('Table stations présente');
      else warn('Table stations absente — base non initialisée');
    } finally {
      c.release();
      await pool.end();
    }
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') warn('Module pg non installé (npm install)');
    else warn('PostgreSQL inaccessible : ' + e.message);
  }

  console.log('');
  if (fails) {
    console.log(`Résultat : ${fails} erreur(s), ${warns} avertissement(s)`);
    process.exit(1);
  }
  console.log(`Résultat : OK${warns ? ` (${warns} avertissement(s))` : ''}`);
  process.exit(0);
})();
