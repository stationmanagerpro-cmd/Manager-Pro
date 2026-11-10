# Manuel d'utilisation v7 (compte client) — remplacement (2026-10-27)

- `public/manuel/Manuel_Utilisation_Manager_Pro.pdf` remplacé par « Manuel d'utilisation Manager Pro v7 – Compte client » (61 pages, 28 chapitres ; l'ancien en avait 49).
- Nouveautés couvertes : calculatrice, carte des stations/GPS, logo, clé d'accès, signature, couleurs menu/en-tête, agrégats et marges, commissions Mobile Money, alertes en 4 onglets, bon de commande à lignes dynamiques, application mobile, aide et mode démo.
- `public/ext-aide-demo.js` : pagination mise à jour (liste « Aller directement à un chapitre » : 26 chapitres ; boutons « ? » des pages et des fenêtres ; nouveaux « ? » pour Commissions Mobile Money, Fin de journée, Rapport client & marges, Mes stations, Carte, Premiers pas, Manuel & aide). Le PDF est appelé avec `?v=7` pour contourner l'ancien en cache du navigateur.
- Le chapitre « Utilisateurs, rôles et sécurité » n'existe plus dans cette édition : les « ? » des pages Rôles pointent vers la page 5 (menu adapté au rôle).
- Cache du service worker : `smp-static-v72`. Aucune migration SQL.
