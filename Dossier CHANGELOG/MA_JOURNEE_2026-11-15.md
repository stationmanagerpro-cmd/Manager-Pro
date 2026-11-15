# « Ma journée », objectif de ventes, classement des employés

- Menu ⚡ → « 📅 Ma journée » (gérants : droits rapports ou clôture de quart) : ventes du jour et du mois, quarts ouverts, cuves basses (≤ 3 jours), classement des employés sur 30 jours (ventes, montant, écarts de caisse des quarts qu'ils ont gérés).
- Objectif mensuel de ventes par station, en montant ou en litres, avec jauge, rythme attendu et statut (en avance / dans le rythme / en retard / atteint). 0 supprime l'objectif.
- API : GET /my-day, PUT /my-day/target (réglage station « sales_target_month »). Aucune migration.
- Rapport hebdomadaire : existe déjà (Rapports programmés, fréquence hebdomadaire) — rien à ajouter.
