# Changelog étape 42 — A5

- Corrige une contradiction majeure entre l'ancienne réinitialisation globale et la fiche A5 du cahier des charges.
- Retire l'effacement générique de toutes les tables non conservées par une whitelist.
- Suspend la route reset-global avec HTTP 409 jusqu'à définition d'un périmètre strictement plateforme.
- Force `global_reset_enabled` à false côté statut API.
- Actualise les messages UI pour ne pas annoncer la suppression des données opérationnelles des clients.
- Ajoute 8 assertions statiques de non-régression et une commande npm dédiée.
- Aucune migration ou opération sur une base PostgreSQL n'a été lancée.
