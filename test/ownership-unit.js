'use strict';
// Qui gère quoi : seul l'administrateur local auteur d'une station ou d'un sous-compte peut la gérer ; le superadmin non.
const assert = require('assert');
const { canManageStation, canManageUser } = require('../src/ownership');
let n = 0; const check = async (l, f) => { await f(); n++; console.log('✓ ' + l); };

// Base simulée : station {created_by, creator_global} liée aux utilisateurs listés ; utilisateurs {client_id}
const mkPool = ({ station = null, linked = true, me = { client_id: 1 } } = {}) => ({ query: async sql => {
  if (/FROM stations s\s+JOIN user_stations/.test(sql)) return { rows: station && linked ? [station] : [] };
  if (/SELECT client_id FROM users/.test(sql)) return { rows: me ? [me] : [] };
  return { rows: [] };
} });
const admin = (id, extra = {}) => ({ id, is_global: false, perms: new Set(['user.manage']), ...extra });
const superadmin = { id: 99, is_global: true, perms: new Set(['user.manage']) };

(async () => {
  await check("l'administrateur local auteur de la station peut la gérer", async () => {
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: 5, creator_global: false } }), admin(5), 10), true);
  });
  await check('un autre administrateur local du même client ne peut pas gérer une station créée par un autre', async () => {
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: 5, creator_global: false } }), admin(6), 10), false);
  });
  await check('le superadmin ne gère jamais une station', async () => {
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: 5, creator_global: false } }), superadmin, 10), false);
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: 99, creator_global: true } }), superadmin, 10), false);
  });
  await check('station sans auteur ou créée par le superadmin : tout administrateur local lié la gère', async () => {
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: null, creator_global: null } }), admin(6), 10), true);
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: 99, creator_global: true } }), admin(6), 10), true);
  });
  await check('sans lien avec la station : refusé', async () => {
    assert.strictEqual(await canManageStation(mkPool({ station: { created_by: 5, creator_global: false }, linked: false }), admin(5), 10), false);
  });
  await check('sous-compte : seul son auteur (administrateur local) peut le désactiver', async () => {
    const p = mkPool();
    assert.strictEqual(await canManageUser(p, admin(5), { id: 20, client_id: 1, created_by: 5 }), true);
    assert.strictEqual(await canManageUser(p, admin(6), { id: 20, client_id: 1, created_by: 5 }), false);
  });
  await check('sous-compte : le superadmin ne peut pas le désactiver, même créé par un autre', async () => {
    assert.strictEqual(await canManageUser(mkPool(), superadmin, { id: 20, client_id: 1, created_by: 5 }), false);
    assert.strictEqual(await canManageUser(mkPool(), superadmin, { id: 20, client_id: 1, created_by: null }), false);
  });
  await check('sous-compte d\'un autre client : refusé', async () => {
    assert.strictEqual(await canManageUser(mkPool({ me: { client_id: 2 } }), admin(5), { id: 20, client_id: 1, created_by: 5 }), false);
  });
  await check('historique sans auteur : tout administrateur local du client peut le gérer', async () => {
    assert.strictEqual(await canManageUser(mkPool(), admin(6), { id: 20, client_id: 1, created_by: null }), true);
  });
  console.log(`\n${n}/${n} contrôles réussis.`);
})().catch(e => { console.error('✘', e.message); process.exit(1); });
