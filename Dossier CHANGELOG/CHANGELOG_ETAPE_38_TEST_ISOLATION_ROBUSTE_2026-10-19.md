# Étape 38 — Fiabilisation du test d’isolation multi-clients

- Restreint l’URL du test aux protocoles HTTP(S), sans identifiants intégrés, paramètres de requête ni fragment.
- Empêche le suivi automatique des redirections HTTP pour éviter de transmettre les requêtes de test vers une autre destination.
- Ajoute un délai maximal de 10 secondes à chaque requête.
- Vérifie d’abord que le compte A peut lire les produits de sa propre station avant de conclure qu’un refus inter-stations est significatif.
- Ajoute la commande `npm run test:step38-isolation-static`.

Aucun test HTTP réel ni accès PostgreSQL n’a été lancé lors de cette étape. Les vérifications exécutées sont statiques et locales.
