-- Permission « consulter ses propres commissions » + attribution par défaut aux rôles de pilotage.
-- L'administrateur local peut ensuite l'accorder aux pompistes via Rôles & permissions.
-- Le Superadmin active la fonctionnalité au niveau contrat (employee_portal_commissions).

INSERT INTO permissions (code, label) VALUES
  ('commission.own', 'Consulter ses propres commissions vendeur')
ON CONFLICT (code) DO NOTHING;

-- ADMIN : toutes les permissions (y compris la nouvelle)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN' AND p.code = 'commission.own'
ON CONFLICT DO NOTHING;

-- GERANT : peut consulter (vue équipe via report.view ; own pour cohérence)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'GERANT' AND p.code = 'commission.own'
ON CONFLICT DO NOTHING;

-- SUPERVISEUR
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.code = 'SUPERVISEUR' AND p.code = 'commission.own'
ON CONFLICT DO NOTHING;

-- POMPISTE : NON attribué par défaut — l'admin du client l'active explicitement
-- via l'écran Rôles & permissions une fois le contrat autorise employee_portal_commissions.
