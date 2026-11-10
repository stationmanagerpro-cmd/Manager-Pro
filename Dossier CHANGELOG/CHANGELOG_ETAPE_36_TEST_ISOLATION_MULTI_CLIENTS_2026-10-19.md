# Changelog — Étape 36

- Ajout d'un test d'intégration en lecture seule pour vérifier l'isolation entre deux comptes clients affectés à des stations différentes.
- Garde-fou : exécution limitée à une API locale (`localhost`, `127.0.0.1`, `::1`).
- Vérification que les comptes ne sont pas globaux et sont affectés à leur station respective.
- Ajout d'un contrôle statique du script et de commandes npm dédiées.
- Ajout d'une procédure d'exécution dans le rapport de l'étape.
- Le test réel contre l'API et PostgreSQL reste à exécuter sur une base locale de test.
