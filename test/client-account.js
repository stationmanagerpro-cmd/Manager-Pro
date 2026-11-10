// Test B1 : création d'un compte client puis connexion du gérant (npm run test:client-account)
// Usage : node test/client-account.js <admin> <motdepasse>   (base de TEST uniquement)
const BASE = process.env.API || 'http://localhost:3000/api';
const [login, password] = process.argv.slice(2);
if (!login || !password) { console.error('Usage: node test/client-account.js <admin> <password>'); process.exit(2); }
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ✔ ' + m); else { fails++; console.log('  ✖ ' + m); } };
const call = async (method, p, body, token, sid) => {
  const r = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }), ...(sid && { 'X-Station-Id': String(sid) }) }, body: body != null ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};
const profils = [
  { suffix: 'a', duration_unit: 'month', duration_value: 1, max_users: 1 },
  { suffix: 'b', duration_unit: 'indefinite', max_users: 5 },
  { suffix: 'c', duration_unit: 'day', duration_value: 10, max_users: 3 },
  { suffix: 'd', duration_unit: 'year', duration_value: 1, max_users: 10 },
  { suffix: 'é', duration_unit: 'month', duration_value: 3, max_users: 2 },   // identifiant avec accent
];
(async () => {
  console.log('=== B1 : comptes clients -> connexion gérant ===');
  const t = Date.now();
  const adm = (await call('POST', '/auth/login', { login, password })).j;
  ok(adm && adm.token, 'login admin principal');
  const stationsSeen = new Set();
  for (const p of profils) {
    const owner = `gerant_${p.suffix}_${t}`, pwd = 'MotDePasse123!';
    const c = await call('POST', '/admin/clients', { name: `Client ${p.suffix} ${t}`, owner_login: owner, owner_password: pwd, duration_unit: p.duration_unit, duration_value: p.duration_value, max_users: p.max_users }, adm.token);
    ok(c.s === 201 && c.j.station_id, `création client ${p.suffix} avec station par défaut`);
    const l = await call('POST', '/auth/login', { login: owner, password: pwd });
    ok(l.s === 200, `connexion gérant ${p.suffix}`);
    if (l.s !== 200) continue;
    const me = (await call('GET', '/me', null, l.j.token)).j;
    ok(me.stations && me.stations.length === 1, `gérant ${p.suffix} : une station chargée (pas « Aucune station »)`);
    stationsSeen.add(me.stations[0].id);
    const own = me.stations[0].id;
    const other = c.j.station_id === own ? null : c.j.station_id;
    ok(other === null, `station chargée = station créée (${p.suffix})`);
  }
  ok(stationsSeen.size === profils.length, 'isolation : chaque gérant a sa propre station');
  console.log(fails ? `\n${fails} échec(s)` : '\nTout est OK');
  process.exit(fails ? 1 : 0);
})();
