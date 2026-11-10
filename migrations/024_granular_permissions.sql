-- 024 Permissions fines clients / fournisseurs / exports / dettes / créances / attribution des rôles
-- Non destructif. Le comportement actuel est reproduit : tout rôle qui pouvait effectuer une action reçoit la
-- permission équivalente. L'administrateur peut ensuite retirer finement ces permissions (Rôles & permissions).

INSERT INTO permissions (code, label) VALUES
  ('customer.view',    'Voir les clients'),
  ('customer.edit',    'Créer / modifier les clients'),
  ('customer.delete',  'Supprimer les clients'),
  ('supplier.view',    'Voir les fournisseurs'),
  ('supplier.edit',    'Créer / modifier les fournisseurs'),
  ('supplier.delete',  'Supprimer les fournisseurs'),
  ('export.customers', 'Exporter la liste des clients (PDF / Excel)'),
  ('export.suppliers', 'Exporter la liste des fournisseurs (PDF / Excel)'),
  ('debt.view',        'Voir les dettes (montants dus aux fournisseurs)'),
  ('receivable.view',  'Voir les créances (montants dus par les clients)'),
  ('role.assign',      'Attribuer les rôles aux utilisateurs')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT DISTINCT rp.role_id, np.id
  FROM role_permissions rp
  JOIN permissions op ON op.id = rp.permission_id
  JOIN (VALUES
    ('cash.manage','customer.view'),('sale.create','customer.view'),('finance.view','customer.view'),
    ('cash.manage','customer.edit'),('settings.edit','customer.edit'),
    ('settings.edit','customer.delete'),('cash.manage','customer.delete'),
    ('purchase.manage','supplier.view'),('purchase.pay','supplier.view'),('finance.view','supplier.view'),('stock.adjust','supplier.view'),
    ('purchase.manage','supplier.edit'),
    ('purchase.manage','supplier.delete'),
    ('cash.manage','export.customers'),('finance.view','export.customers'),('report.view','export.customers'),
    ('purchase.manage','export.suppliers'),('finance.view','export.suppliers'),('report.view','export.suppliers'),
    ('finance.view','debt.view'),('purchase.manage','debt.view'),('purchase.pay','debt.view'),('report.view','debt.view'),('stock.adjust','debt.view'),
    ('finance.view','receivable.view'),('cash.manage','receivable.view'),('report.view','receivable.view'),('sale.create','receivable.view'),
    ('user.manage','role.assign')
  ) AS m(old_code, new_code) ON m.old_code = op.code
  JOIN permissions np ON np.code = m.new_code
ON CONFLICT DO NOTHING;

-- L'administrateur reçoit toujours l'ensemble des nouvelles permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
 WHERE r.code = 'ADMIN'
   AND p.code IN ('customer.view','customer.edit','customer.delete','supplier.view','supplier.edit','supplier.delete',
                  'export.customers','export.suppliers','debt.view','receivable.view','role.assign')
ON CONFLICT DO NOTHING;
