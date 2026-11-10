-- 059 : rétablir l'accès fiscal pour le rôle ADMIN des comptes clients.
-- Le Superadmin de plateforme est distingué par users.is_global et le rôle SUPERADMIN.
-- La protection opérationnelle reste dans requireFiscalAccess() et le middleware global.
-- Idempotent : ne supprime ni ne modifie aucune donnée métier.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'fiscal.access'
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Défense en profondeur : le rôle SUPERADMIN ne reçoit pas le droit opérationnel.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'SUPERADMIN'
  AND p.code = 'fiscal.access';
