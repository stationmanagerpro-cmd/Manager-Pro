-- ANO-01 / RG-03 : prix d'achat, marges et valeur du stock au prix d'achat réservés aux rôles de gestion.
-- Nouvelle permission « cost.view », accordée à l'administrateur local, au gérant et au comptable (rôles modèles, hors rôles personnalisés).
-- Les rôles personnalisés d'un client ne l'obtiennent pas automatiquement : l'administrateur local peut la leur accorder.
INSERT INTO permissions (code, label) VALUES ('cost.view', 'Voir les prix d''achat, marges et valeur du stock à l''achat')
  ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
   WHERE r.code IN ('ADMIN','GERANT','COMPTABLE') AND r.client_id IS NULL AND p.code = 'cost.view'
ON CONFLICT DO NOTHING;
