# Clé d'accès : durée plus longue, clé écrite sur l'interface, archive, lien (23/10/2026)

## Demandes
1. La clé expirait trop vite. 2. La clé doit être archivée, copiable, et inscrite sur l'interface (pas seulement dans une fenêtre), avec le lien.

## Écran « 🔑 Clé d'accès » (Superadmin)
- **Durées** : 30 jours, 90 jours, 180 jours, **1 an (par défaut)**, 2 ans, sans limite (avant : 24 h / 7 j / 30 j / sans limite). Le serveur accepte jusqu'à 17 520 h (2 ans).
- Une clé **provisoire non activée** n'est plus révoquée automatiquement après 24 h mais après **7 jours**.
- Nouvelle section **« Clés actives et archive (clé + lien) »** : la clé est écrite en clair sur la page (Superadmin uniquement), avec dates de création et d'expiration, le lien de connexion, et les boutons **Copier la clé**, **Copier le lien**, **Copier lien + clé**.
- Historique : la clé s'affiche en clair pour les clés utilisables ; pour les clés révoquées/expirées, le bouton 👁 la relit (journalisé) et la copie.
- Cache du service worker `smp-static-v32`.

## Limites / à valider
- Le **laissez-passer** après saisie de la clé reste réglé par la « durée de validité du laissez-passer » (60 min par défaut, modifiable) ; un appareil déjà enrôlé n'a pas à ressaisir la clé.
- Le lien affiché est l'adresse utilisée pour ouvrir la page : à partir de 127.0.0.1 il n'est pas utilisable ailleurs (avertissement affiché).
- Tests exécutés : `access-keys-unit` 10/10, `access-keys-gate-sim` 9/9, `device-registry-sim` 14/14, tests statiques liés réussis. **Aucun test PostgreSQL ni navigateur** : l'affichage et le déchiffrement des clés (dépend de `JWT_SECRET`/`ACCESS_KEY_SECRET` inchangés) sont à vérifier chez vous.
- Pas de migration de base pour ce correctif.
