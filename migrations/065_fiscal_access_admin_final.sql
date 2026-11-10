-- 065 : l'administrateur local (rôle ADMIN) d'un compte client doit pouvoir utiliser la Fiscalité dès que le contrat l'autorise.
-- Réparation idempotente (la migration 058 avait retiré ce droit ; 059/062 le rétablissaient mais pouvaient ne pas être appliquées).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'fiscal.access'
WHERE r.code = 'ADMIN'
ON CONFLICT DO NOTHING;

-- Le compte de plateforme (SUPERADMIN) n'utilise jamais le parcours opérationnel.
DELETE FROM role_permissions rp USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id AND r.code IN ('SUPERADMIN', 'SUPER_ADMIN') AND p.code = 'fiscal.access';
