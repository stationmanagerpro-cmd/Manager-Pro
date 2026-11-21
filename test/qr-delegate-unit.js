'use strict';
// Vente au nom d'un employé par scan QR : règles pures (sans base de données).
// node test/qr-delegate-unit.js
const assert = require('assert'); const L = require('../src/qr_logic');
const fs = require('fs'); const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let ok = 0, ko = 0; const t = (n, f) => { try { f(); ok++; console.log('✓ ' + n); } catch (e) { ko++; console.log('✗ ' + n + '\n   ' + e.message.split('\n')[0]); } };

// Contexte : pompe 3 sur le quart 9 ; l'utilisateur est l'employé 30 (non responsable) ; responsable de la pompe : employé 20.
const base = () => ({ stationId: 1, qr: { id: 5, station_id: 1, status: 'active', counter_id: 10, pump_id: 3 },
  counter: { id: 10, pump_id: 3, product_id: 7 }, pump: { id: 3, station_id: 1, status: 'active', deleted_at: null, number: 3 },
  product: { id: 7, active: true, deleted_at: null }, shift: { id: 9, status: 'ouvert' }, employee: { id: 30 },
  team: [{ employee_id: 20, pump_id: 3 }], pumpAssign: [], counterRead: true });

t('Sans permission : aucune délégation (null)', () => assert.strictEqual(L.delegateTarget(base(), false), null));
t('Responsable lui-même : vente normale (null)', () => { const c = base(); c.employee = { id: 20 }; assert.strictEqual(L.delegateTarget(c, true), null); });
t('Permission + pompe à un responsable unique : cible = ce responsable', () => assert.deepStrictEqual(L.delegateTarget(base(), true), { ok: true, employee_id: 20 }));
t('Pompe sans responsable : pas de délégation (comportement historique)', () => { const c = base(); c.team = []; assert.strictEqual(L.delegateTarget(c, true), null); });
t('Pompe partagée par plusieurs responsables : refus DELEGATE_OWNER_UNCLEAR', () => { const c = base(); c.team = [{ employee_id: 20, pump_id: 3 }, { employee_id: 21, pump_id: 3 }]; assert.strictEqual(L.delegateTarget(c, true).code, 'DELEGATE_OWNER_UNCLEAR'); });
t('Responsable désigné via shift_employee_pumps (sans compte connecté) : cible reconnue', () => { const c = base(); c.team = []; c.pumpAssign = [{ employee_id: 22, pump_id: 3 }]; assert.deepStrictEqual(L.delegateTarget(c, true), { ok: true, employee_id: 22 }); });
t('Aucun quart ouvert : pas de délégation', () => { const c = base(); c.shift = null; assert.strictEqual(L.delegateTarget(c, true), null); });

// Au moment de la vente : scan délégué.
const scan = (over = {}) => ({ id: 77, user_id: 30, station_id: 1, qr_code_id: 5, shift_id: 9, pump_id: 3, counter_id: 10, product_id: 7,
  employee_id: 20, delegated_by_user_id: 30, consumed_sale_id: null, expires_at: new Date(Date.now() + 60000), ...over });
const saleCtx = (canDelegate) => ({ ...base(), employee: { id: 20, user_id: 55 }, canDelegate, delegatedBy: 30 });
t('Scan délégué accepté quand la permission est présente et le responsable est toujours sur la pompe', () => assert.strictEqual(L.evaluateScanUse(saleCtx(true), scan(), {}, 30).ok, true));
t('Scan délégué refusé si la permission a été retirée (DELEGATE_NOT_ALLOWED)', () => assert.strictEqual(L.evaluateScanUse(saleCtx(false), scan(), {}, 30).code, 'DELEGATE_NOT_ALLOWED'));
t('Scan délégué : le responsable doit correspondre au scan (sinon SCAN_MISMATCH)', () => assert.strictEqual(L.evaluateScanUse(saleCtx(true), scan(), { employee_id: 21 }, 30).code, 'SCAN_MISMATCH'));
t('Scan non délégué : comportement inchangé (canDelegate sans effet)', () => { const c = { ...base(), team: [{ employee_id: 30, pump_id: 3 }], canDelegate: true }; assert.strictEqual(L.evaluateScanUse(c, scan({ employee_id: 30, delegated_by_user_id: null }), {}, 30).ok, true); });
t('Scan délégué déjà consommé → SCAN_USED', () => assert.strictEqual(L.evaluateScanUse(saleCtx(true), scan({ consumed_sale_id: 1 }), {}, 30).code, 'SCAN_USED'));

// Contrôles statiques de câblage (migration, permission, routes, audit, alerte).
const mig = read('migrations/125_vente_au_nom_employe.sql');
t('Migration 125 : permission sale.record_for_employee, rôle ADMIN seul, colonne delegated_by_user_id', () => {
  assert.ok(mig.includes("'sale.record_for_employee'")); assert.ok(mig.includes("r.code = 'ADMIN'"));
  assert.ok(!/'GERANT'|'CAISSIER'|'POMPISTE'/.test(mig), 'ne doit pas accorder à d autres rôles');
  assert.ok(mig.includes('ADD COLUMN IF NOT EXISTS delegated_by_user_id BIGINT REFERENCES users(id)'));
});
t('Scan : la route passe par delegateTarget et journalise la délégation', () => {
  const q = read('src/qr_codes.js');
  assert.ok(q.includes("L.delegateTarget(ctx, req.user.perms.has('sale.record_for_employee'))"));
  assert.ok(q.includes("L.refuse('DELEGATE_NO_ACCOUNT')")); assert.ok(q.includes('delegated_by_user_id: ctx.delegatedBy'));
});
t('Vente : permission transmise à la vérification du scan, audit et alerte après validation', () => {
  const f = read('src/fuelsales.js');
  assert.ok(f.includes("canDelegate: req.user.perms.has('sale.record_for_employee')"));
  assert.ok(f.includes('vendue_au_nom_de_employe_id')); assert.ok(f.includes("require('./qr_delegate').notifyDelegatedSale"));
});
t('Interface scan : affiche « vente au nom de cet employé » si délégué', () => assert.ok(read('public/ext-qr-scan.js').includes('vente au nom de cet employé')));

console.log(`\n${ok}/${ok + ko} contrôles réussis.`);
if (ko) process.exit(1);
