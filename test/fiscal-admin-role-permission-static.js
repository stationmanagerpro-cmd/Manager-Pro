'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations/059_restore_client_admin_fiscal_permission.sql'), 'utf8');
const fiscal = fs.readFileSync(path.join(root, 'src/fiscal.js'), 'utf8');
if (!/r\.code\s*=\s*'ADMIN'/.test(migration) || !/p\.code\s*=\s*'fiscal\.access'/.test(migration)) {
  throw new Error('La migration doit restaurer fiscal.access au rôle client ADMIN');
}
if (!/r\.code\s*=\s*'SUPERADMIN'[\s\S]*p\.code\s*=\s*'fiscal\.access'/.test(migration)) {
  throw new Error('La migration doit exclure fiscal.access du rôle SUPERADMIN');
}
if (!fiscal.includes('req.user.is_global') || !fiscal.includes('FISCAL_SUPERADMIN_NO_OPS')) {
  throw new Error('La route fiscale doit conserver le refus opérationnel du Superadmin');
}
console.log('OK fiscal-admin-role-permission-static');
