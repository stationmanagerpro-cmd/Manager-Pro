-- 063 — Cohérence stricte entre identité de plateforme et rôle. Additif/idempotent.
-- Les comptes globaux doivent porter SUPERADMIN ; les comptes locaux ne peuvent pas porter SUPERADMIN.
INSERT INTO roles (code, label) VALUES ('SUPERADMIN', 'Super administrateur de plateforme')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label;
-- Normaliser les comptes de plateforme historiques, quelle que soit leur ancienne affectation.
UPDATE users
   SET role_id = (SELECT id FROM roles WHERE code = 'SUPERADMIN')
 WHERE is_global = TRUE
   AND role_id <> (SELECT id FROM roles WHERE code = 'SUPERADMIN');
-- Les comptes locaux historiquement mal affectés à SUPERADMIN sont replacés dans ADMIN.
-- Les permissions ADMIN sont conservées pour éviter une perte accidentelle d'accès local.
UPDATE users
   SET role_id = (SELECT id FROM roles WHERE code = 'ADMIN')
 WHERE is_global = FALSE
   AND role_id = (SELECT id FROM roles WHERE code = 'SUPERADMIN');
