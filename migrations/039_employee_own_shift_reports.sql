-- 039 : autoriser explicitement la consultation en lecture seule des rapports de ses propres quarts.
-- Le droit n'est pas attribué automatiquement : le client le coche dans les permissions du rôle/utilisateur.
INSERT INTO permissions(code, label) VALUES
  ('shift.report.own', 'Voir uniquement les rapports de ses propres quarts (lecture seule)')
ON CONFLICT (code) DO NOTHING;
