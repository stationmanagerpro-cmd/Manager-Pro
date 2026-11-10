# Étape 35 — Contrôle des accès directs à l’API

- Ajout d’un test statique ciblé sur l’ordre des middlewares privés, la validité de session, l’affectation station/client et la protection des routes de plateforme.
- Ajout d’une commande reproductible : `npm run test:step35-direct-access-static`.
- Aucun endpoint métier ni règle d’autorisation n’a été modifié dans cette étape.
- Le test est statique : il lit le code, sans lancer le serveur ni se connecter à PostgreSQL.
