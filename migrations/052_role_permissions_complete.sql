-- 052 : Matrice complete des droits par role metier
-- Idempotent. Complete 051 + permissions granulares ajoutees au fil des migrations.

-- S'assurer que les roles existent
INSERT INTO roles (code, label) VALUES
 ('ADMIN','Administrateur'),('GERANT','Gerant'),('CAISSIER','Caissier'),('POMPISTE','Pompiste'),
 ('MAGASINIER','Magasinier'),('COMPTABLE','Comptable'),('SUPERVISEUR','Superviseur')
ON CONFLICT (code) DO NOTHING;

-- ADMIN : toutes les permissions connues
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- GERANT : pilotage station complet (sauf role ADMIN exclusif deja filtre cote API)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'GERANT' AND p.code IN (
  -- Ops
  'shift.open','shift.close','shift.report.own',
  'sale.create','sale.delete','price.edit','stock.adjust',
  'expense.create','cash.manage','report.view','finance.view','finance.report',
  'audit.view','user.manage','role.assign','settings.edit',
  'purchase.manage','purchase.pay','transfer.manage',
  'customer.view','customer.edit','customer.delete',
  'supplier.view','supplier.edit','supplier.delete',
  'receivable.view','debt.view',
  'export.customers','export.suppliers',
  'money.manage','appearance.manage','appearance.self','image.manage',
  -- RH / paie
  'hr.view','hr.manage','hr.settings','hr.payroll','hr.payroll.close','hr.payroll.reopen',
  'hr.debts','hr.gaps',
  'hr.employee.view','hr.employee.create','hr.employee.edit','hr.employee.documents',
  'hr.documents.view',
  'hr.leave.view','hr.leave.request','hr.leave.manage','hr.leave.approve',
  'hr.attendance.view','hr.attendance.manage','hr.attendance.correct',
  'hr.schedule.view','hr.schedule.manage',
  'hr.skills.view','hr.skills.manage',
  'hr.training.view','hr.training.manage',
  'hr.evaluation.view','hr.evaluation.manage',
  'hr.overtime.view','hr.overtime.propose','hr.overtime.validate','hr.overtime.approve'
)
ON CONFLICT DO NOTHING;

-- SUPERVISEUR : ops + stocks + caisse + rapports, sans user.manage ni parametres sensibles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'SUPERVISEUR' AND p.code IN (
  'shift.open','shift.close','shift.report.own',
  'sale.create','sale.delete','price.edit','stock.adjust',
  'expense.create','cash.manage','report.view','finance.view',
  'purchase.manage','purchase.pay',
  'customer.view','customer.edit','supplier.view','supplier.edit',
  'receivable.view','debt.view',
  'export.customers','export.suppliers',
  'hr.view','hr.employee.view','hr.leave.view','hr.attendance.view','hr.schedule.view',
  'appearance.self'
)
ON CONFLICT DO NOTHING;

-- CAISSIER : ventes, caisse, clients, quarts
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'CAISSIER' AND p.code IN (
  'sale.create','cash.manage','expense.create',
  'customer.view','customer.edit','receivable.view',
  'shift.open','shift.close','shift.report.own',
  'report.view','appearance.self'
)
ON CONFLICT DO NOTHING;

-- POMPISTE : ventes + son rapport de quart
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'POMPISTE' AND p.code IN (
  'sale.create','shift.report.own','appearance.self'
)
ON CONFLICT DO NOTHING;

-- MAGASINIER : stocks, achats, fournisseurs
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'MAGASINIER' AND p.code IN (
  'stock.adjust','purchase.manage','purchase.pay','transfer.manage',
  'supplier.view','supplier.edit','debt.view',
  'report.view','export.suppliers','appearance.self'
)
ON CONFLICT DO NOTHING;

-- COMPTABLE : finance, rapports, audit, creances/dettes, paie lecture
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'COMPTABLE' AND p.code IN (
  'report.view','finance.view','finance.report','audit.view',
  'expense.create','cash.manage','money.manage',
  'receivable.view','debt.view',
  'customer.view','supplier.view',
  'export.customers','export.suppliers',
  'hr.view','hr.payroll','hr.payroll.close',
  'hr.employee.view','appearance.self'
)
ON CONFLICT DO NOTHING;
