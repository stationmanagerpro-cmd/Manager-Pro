# Station Manager Pro — Étape 2 : isolation client/station et garde-fous de tests

Date : 2026-10-12
Base de départ : archive complète `Station-Manager-Pro-etape-1-securite-migrations-2026-10-12.zip`.

## Corrections appliquées

1. **Accès aux stations (`src/core.js`)**
   - L'affectation `user_stations` est désormais vérifiée en joignant la station et le compte utilisateur.
   - Une station inactive est refusée (`stations.active = true` requis).
   - Lorsqu'un utilisateur possède un `client_id`, la station doit appartenir au même client. Les comptes historiques sans `client_id` restent limités à leurs affectations explicites.
   - Le refus reste générique afin de ne pas révéler d'informations sur une station non autorisée.

2. **Barrières de modules contractuels (`src/server.js`)**
   - Ajout du contrôle contractuel de la messagerie : `can_use_messaging` ou `modules.messaging` doit l'autoriser.
   - Ajout du contrôle contractuel des exports : `can_export_reports` ou `modules.reports` doit l'autoriser.
   - Les contrôles déjà présents sur RH, finance, rapports, ventes et stocks restent en place. Ils s'ajoutent aux permissions par rôle et aux plafonds de permissions par station ; ils ne les remplacent pas.

3. **Protection contre l'exécution accidentelle des tests sur la production**
   - `test/security.js` refuse les API non locales.
   - `test/all.js` refuse de lancer la suite d'intégration sauf sur une base PostgreSQL locale dédiée dont le nom contient `test` ou `ci`, avec `ALLOW_DESTRUCTIVE_TESTS=1` défini explicitement.
   - `scripts/ci-restore-test.js` applique également la restriction de base locale dédiée et exige `ALLOW_DESTRUCTIVE_TESTS=1`.
   - Ajout de `npm run test:tenant-isolation-static`.

## Tests réellement exécutés

- `node --check` sur tous les fichiers JavaScript de `src/`, `test/` et `scripts/` : **réussi**.
- `npm run test:tenant-isolation-static` : **11/11 contrôles statiques réussis**.
- `npm run test:migration-safety` : **7/7 contrôles statiques réussis**.
- `npm run test:detail-pages` : **19/19 contrôles structurels réussis**.
- Intégrité de l'archive ZIP : vérifiée à la création.

## Tests non exécutés / limites

- La suite complète `npm test` n'a pas été exécutée : les dépendances du projet ne sont pas installées dans cet environnement (`dotenv` introuvable lors de la tentative). Aucun `npm install` n'a été lancé et aucune base n'a été contactée.
- Aucun test d'intégration PostgreSQL, test de requête API réelle, test navigateur ou test multi-client avec données réelles n'a été exécuté.
- Les tests statiques ne prouvent pas à eux seuls la sécurité fonctionnelle de toutes les routes. Il faudra compléter par une matrice de tests API en base locale jetable.

## Production

