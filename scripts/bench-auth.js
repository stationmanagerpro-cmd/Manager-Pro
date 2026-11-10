#!/usr/bin/env node
// ANO-15 / RG-10 : mesure du coût des requêtes authentifiées (session + permissions + contrat) AVANT toute décision de cache.
// Usage : node scripts/bench-auth.js <login> <motdepasse> [n=300] [concurrence=10] [chemin=/api/me]
// Cible : un serveur lancé (BASE=http://localhost:3000 par défaut). Ne modifie aucune donnée (requêtes GET uniquement) ;
// à lancer sur une base de test. Sortie : p50 / p95 / p99 / max en ms, séquentiel puis concurrent.
const [login, password, nArg, cArg, pathArg] = process.argv.slice(2);
if (!login || !password) { console.error('Usage : node scripts/bench-auth.js <login> <motdepasse> [n] [concurrence] [chemin]'); process.exit(1); }
const BASE = process.env.BASE || 'http://localhost:3000', N = +nArg || 300, C = +cArg || 10, PATH = pathArg || '/api/me';
const pct = (a, p) => a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const stats = (label, a) => console.log(`${label.padEnd(12)} n=${a.length}  p50=${pct(a, .5).toFixed(1)} ms  p95=${pct(a, .95).toFixed(1)} ms  p99=${pct(a, .99).toFixed(1)} ms  max=${Math.max(...a).toFixed(1)} ms`);
(async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  if (!r.ok) { console.error('Connexion refusée : ' + r.status); process.exit(1); }
  const { token } = await r.json(), headers = { authorization: 'Bearer ' + token };
  const one = async () => { const t = performance.now(); const x = await fetch(BASE + PATH, { headers }); await x.arrayBuffer(); if (!x.ok) throw new Error(PATH + ' → ' + x.status); return performance.now() - t; };
  for (let i = 0; i < 20; i++) await one();                                    // échauffement
  const seq = []; for (let i = 0; i < N; i++) seq.push(await one());
  const par = []; for (let i = 0; i < N; i += C) par.push(...await Promise.all(Array.from({ length: Math.min(C, N - i) }, one)));
  console.log(`Chemin ${PATH} — ${BASE}`); stats('séquentiel', seq); stats('concurrent ×' + C, par);
  console.log('\nDécision (audit ANO-15) : n\'ajouter un cache de 30 à 60 s (par utilisateur, invalidé à tout changement de rôle/contrat) que si le p95 est jugé pénalisant sous charge réelle.');
})().catch(e => { console.error(e.message); process.exit(1); });
