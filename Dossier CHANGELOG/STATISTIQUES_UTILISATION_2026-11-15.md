# Statistiques d'utilisation de la plateforme (Superadmin)

- Nouvelle section « Utilisation de la plateforme » dans le tableau de bord plateforme (7 / 30 / 90 jours) : temps total, connexions, utilisateurs et clients actifs ; diagramme du temps passé par client ; courbe connexions + heures par jour ; classement des clients ; classement des utilisateurs du plus au moins fréquent.
- Connexions : comptées depuis l'historique des sessions (déjà existant).
- Temps passé : mesuré par un battement toutes les 60 s quand l'application est ouverte et visible (POST /usage/ping, table user_usage, migration 108). La mesure démarre au déploiement ; pas d'historique antérieur.
- API : GET /admin/platform/usage?days=30 (Superadmin uniquement).
