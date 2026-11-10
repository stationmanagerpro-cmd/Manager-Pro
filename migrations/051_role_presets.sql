-- 051 : Rôles métier prédéfinis — permissions cohérentes par profil
-- Idempotent (ON CONFLICT DO NOTHING)

-- S'assurer que les rôles existent
INSERT INTO roles (code, label) VALUES
 ('ADMIN','Administrateur'),('GERANT','Gérant'),('CAISSIER','Caissier'),('POMPISTE','Pompiste'),
 ('MAGASINIER','Magasinier'),('COMPTABLE','Comptable'),('SUPERVISEUR','Superviseur')
ON CONFLICT (code) DO NOTHING;

-- Permissions de base éventuellement manquantes
INSERT INTO permissions (code, label) VALUES
 ('customer.view','Voir les clients'),
 ('customer.edit','Modifier les clients'),
 ('supplier.view','Voir les fournisseurs'),
 ('supplier.edit','Modifier les fournisseurs'),
 ('shift.report.own','Voir ses propres rapports de quart'),
 ('receivable.view','Voir les créances clients'),
 ('debt.view','Voir les dettes fournisseurs')
ON CONFLICT (code) DO NOTHING;

-- ADMIN : toutes les permissions existantes
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- GERANT : quasi tout sauf user.manage global sensible — on donne user.manage + settings
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'GERANT' AND p.code IN (
  'shift.open','shift.close','sale.create','sale.delete','price.edit','stock.adjust',
  'expense.create','cash.manage','report.view','finance.view','audit.view',
  'user.manage','settings.edit','purchase.manage','purchase.pay',
  'customer.view','customer.edit','supplier.view','supplier.edit',
  'shift.report.own','receivable.view','debt.view',
  'hr.view','hr.manage','hr.payroll','hr.debts','hr.gaps','finance.report','money.manage'
)
ON CONFLICT DO NOTHING;

-- CAISSIER : ventes, caisse, clients, rapport propre
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'CAISSIER' AND p.code IN (
  'sale.create','cash.manage','expense.create','customer.view','customer.edit',
  'report.view','shift.open','shift.close','shift.report.own','receivable.view'
)
ON CONFLICT DO NOTHING;

-- POMPISTE : ventes + son rapport de quart
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'POMPISTE' AND p.code IN (
  'sale.create','shift.report.own'
)
ON CONFLICT DO NOTHING;

-- MAGASINIER : stock et achats
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'MAGASINIER' AND p.code IN (
  'stock.adjust','purchase.manage','purchase.pay','supplier.view','supplier.edit',
  'report.view','debt.view'
)
ON CONFLICT DO NOTHING;

-- COMPTABLE : finance, rapports, audit, créances/dettes (lecture / saisie limitée)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'COMPTABLE' AND p.code IN (
  'report.view','finance.view','finance.report','audit.view','expense.create',
  'receivable.view','debt.view','cash.manage','customer.view','supplier.view',
  'hr.payroll','hr.view'
)
ON CONFLICT DO NOTHING;

-- SUPERVISEUR : ops + rapports + clôture, sans user.manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'SUPERVISEUR' AND p.code IN (
  'shift.open','shift.close','sale.create','sale.delete','stock.adjust','price.edit',
  'expense.create','cash.manage','report.view','finance.view',
  'customer.view','supplier.view','purchase.manage',
  'shift.report.own','receivable.view','debt.view'
)
ON CONFLICT DO NOTHING;
