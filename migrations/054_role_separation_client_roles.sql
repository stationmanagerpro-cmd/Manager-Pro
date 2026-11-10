-- 054 — Séparation des rôles et rôles personnalisés par compte client. Additif, idempotent, sans suppression de données.
-- 1) Rôle dédié « Super administrateur » (compte de plateforme), distinct du rôle ADMIN (administrateur d'un compte client).
INSERT INTO roles (code, label) VALUES ('SUPERADMIN', 'Super administrateur') ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT sa.id, rp.permission_id
    FROM roles sa
    JOIN roles ad ON ad.code = 'ADMIN'
    JOIN role_permissions rp ON rp.role_id = ad.id
   WHERE sa.code = 'SUPERADMIN'
  ON CONFLICT DO NOTHING;
UPDATE users SET role_id = (SELECT id FROM roles WHERE code = 'SUPERADMIN')
 WHERE is_global = TRUE AND role_id = (SELECT id FROM roles WHERE code = 'ADMIN');

-- 2) Rôles personnalisés : un rôle peut appartenir à un client (client_id) ; NULL = rôle commun de la plateforme.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS client_id BIGINT REFERENCES clients(id);
CREATE INDEX IF NOT EXISTS idx_roles_client ON roles (client_id) WHERE client_id IS NOT NULL;
