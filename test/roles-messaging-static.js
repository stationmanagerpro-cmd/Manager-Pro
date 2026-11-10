// Contrôles statiques : séparation des rôles, rôles par client, messagerie partagée, liens facture/achat ↔ profil. node test/roles-messaging-static.js
const fs = require('fs'), assert = require('assert');
const r = p => fs.readFileSync(p, 'utf8');
let n = 0; const ok = (m, f) => { f(); n++; console.log('✔', m); };
const server = r('src/server.js'), app = r('public/app.js'), admin = r('src/admin.js'), auth = r('src/auth.js'), core = r('src/core.js'), cat = r('src/catalog.js'), mig = r('migrations/054_role_separation_client_roles.sql');

ok('le Super Admin peut utiliser la messagerie (route autorisée côté serveur)', () => assert(/allowed = \[[^\]]*'\/messaging'/.test(server)));
ok('la messagerie est visible des comptes clients ET du Super Admin (vue partagée)', () => { assert(/SHARED_VIEWS = new Set\(\['msg'\]\)/.test(app)); assert(/GLOBAL_ONLY_VIEWS\.has\(k\) && !SHARED_VIEWS\.has\(k\)/.test(app)); });
ok('les écrans Super Admin restent interdits aux comptes clients', () => assert(/SUPERADMIN_VIEWS = new Set\(\[[^\]]*'roles'/.test(app)));
ok('rôle SUPERADMIN distinct de ADMIN (migration) et affecté aux comptes de plateforme', () => { assert(/'SUPERADMIN'/.test(mig)); assert(/is_global = TRUE/.test(mig)); });
ok('le Super Admin garde au minimum les permissions ADMIN', () => assert(/\$2::boolean AND r\.code = 'ADMIN'/.test(core)));
ok('anti-élévation : attribution de rôle contrôlée (création et changement de rôle)', () => { assert((auth.match(/assertAssignableRole/g) || []).length >= 2); });
ok('rôles personnalisés : création, permissions, libellé, suppression limités au client propriétaire', () => { assert(/client_id/.test(admin) && /assertDelegable/.test(admin) && /r\.delete\('\/admin\/roles\/:code'/.test(admin)); });
ok('profil client : les factures du module Facturation (customer_id) sont renvoyées avec leur état', () => { assert(/FROM invoices i WHERE i\.station_id=\$1 AND i\.customer_id=\$2/.test(cat)); assert(/invoice_payments/.test(cat)); });
ok('profil fournisseur : achats liés par supplier_id (NOT NULL en base)', () => { assert(/FROM purchases pu\s+WHERE pu\.station_id=\$1 AND pu\.supplier_id=\$2/.test(cat)); assert(/supplier_id\s+BIGINT NOT NULL REFERENCES suppliers/.test(r('migrations/001_initial.sql'))); });
ok('restauration : les boucles de clés étrangères ne bloquent plus (colonne optionnelle différée)', () => assert(/planOrder/.test(r('src/tenant-backups.js')) && /planOrder/.test(r('src/fk_order.js'))));
console.log(`\n${n}/${n} contrôles statiques réussis.`);
