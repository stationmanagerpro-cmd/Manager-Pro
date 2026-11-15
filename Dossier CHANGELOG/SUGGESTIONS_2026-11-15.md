# Suggestions mises en place (15 novembre 2026)

Superadmin (tableau de bord → Utilisation de la plateforme)
- Clients inactifs (aucune activité depuis 7 jours) : pastille « inactif » + compteur.
- Évolution en % du temps et des connexions par rapport à la période précédente.
- Heures de pointe (connexions par heure, UTC) et écrans les plus utilisés (minutes) — migration 109.
- Export CSV du rapport d'utilisation (clients + utilisateurs). Export manuel, pas d'envoi automatique mensuel.
- État du système : dernière sauvegarde réussie et échecs sur 7 jours (⚠ si plus de 26 h).

Gérants
- Menu utilisateur → « Activité de l'équipe » (administrateur local) : temps passé, connexions, dernière activité de ses propres utilisateurs. API GET /usage/team.
- Nouvelle alerte « Quart ouvert trop longtemps » (seuil en heures) — Centre d'alertes, analysée toutes les ~5 min.
- Nouvelle alerte « Connexion de nuit » (23 h–5 h heure serveur UTC) envoyée au gérant. Les deux alertes doivent être activées dans le Centre d'alertes.

Non fait : mode sombre complet (nécessite une vérification visuelle écran par écran), envoi automatique du rapport mensuel, détection de « nouvel appareil » (adresses IP mobiles trop variables : fausses alertes).
