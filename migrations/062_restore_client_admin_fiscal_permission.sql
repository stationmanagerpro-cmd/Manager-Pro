-- 062 : réparation idempotente de l'accès opérationnel Fiscalité pour l'ADMIN local.
-- L'accès reste individuel au compte client : le contrat doit aussi autoriser
-- can_access_fiscal/module:fiscal. Les autres clients du même pack ne changent pas.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fiscal.access'
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Le compte Superadmin de plateforme conserve uniquement la gestion des contrats.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code IN ('SUPERADMIN', 'SUPER_ADMIN')
  AND p.code = 'fiscal.access';
