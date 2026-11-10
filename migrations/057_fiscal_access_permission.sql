-- 057 : permission explicite d'accès à la Fiscalité (contrat + rôle utilisateur).
-- L'accès opérationnel nécessite aussi une autorisation fiscale active dans le contrat client.
INSERT INTO permissions (code, label)
VALUES ('fiscal.access', 'Accéder au module La Fiscalité')
ON CONFLICT (code) DO NOTHING;

-- Aucun rôle ADMIN n'est automatiquement autorisé ici : l'ADMIN de plateforme
-- gère les contrats/licences et autorise le module pour le client, sans l'utiliser.
-- Les permissions opérationnelles doivent être attribuées aux rôles du client prévus à cet effet.
