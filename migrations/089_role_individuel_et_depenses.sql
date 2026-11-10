-- 1. Rôle individuel : un employé peut avoir un rôle qui n'appartient qu'à lui, séparé des autres employés du même poste.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS personal_user_id BIGINT REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_personal_user ON roles (personal_user_id) WHERE personal_user_id IS NOT NULL;

-- 2. Dépenses de l'entreprise : réservées à l'administrateur local et au gérant (et aux rôles qui en reçoivent l'autorisation).
--    Le rôle commun « Caissier » ne les enregistre plus ; l'autorisation se donne par employé (rôle individuel) ou par rôle personnalisé.
DELETE FROM role_permissions
 WHERE role_id IN (SELECT id FROM roles WHERE code = 'CAISSIER' AND client_id IS NULL)
   AND permission_id = (SELECT id FROM permissions WHERE code = 'expense.create');
