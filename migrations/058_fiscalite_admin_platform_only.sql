-- 058 : l'ADMIN de plateforme autorise la Fiscalite pour le client via le contrat,
-- mais ne doit jamais recevoir le droit d'utiliser le parcours fiscal operationnel.
-- La permission reste disponible pour les roles operationnels explicitement autorises.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.code = 'ADMIN'
  AND p.code = 'fiscal.access';
