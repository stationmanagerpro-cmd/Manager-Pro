# Vérification du branchement et des sources (PostgreSQL) — 2026-11-16

## Périmètre et méthode
- PostgreSQL 16.15 installé et démarré en local (instance de test, aucune donnée de production).
- Base complète construite avec les 114 migrations du dépôt, puis jeux d'essai flotte et cuves chargés (scripts/recette-postgres.sh) : 170 tables.
- **Limite** : les dépendances Node (express, pg, zod…) ne peuvent pas être installées ici (réseau bloqué, cache npm vide). Le serveur ne peut donc pas être démarré en local et les routes n'ont pas été appelées en HTTP. Le démarrage en production est confirmé par les journaux Render du déploiement 4dce57a (migrations 114 et 115 appliquées, service live).

## Résultats
1. **Requêtes SQL** : 1 110 requêtes statiques extraites du code, préparées par PostgreSQL sur le schéma complet.
   - 1 103 valides.
   - 2 faux positifs : `schema_migrations` est créée par le lanceur `migrate.js` (non exécuté ici) ; 1 fragment de CTE complété par `${accounts}` dans platform.js.
   - 5 vraies anomalies, traitées ci-dessous.
2. **Branchement des écrans** : 44 entrées de menu, toutes reliées à une vue. Les 40 fichiers public/*.js non listés à la main dans index.html sont bien chargés (contrôle corrigé). Scripts référencés absents : aucun.
3. **Routeurs** : tous les routeurs de src/ sont montés dans server.js.
4. **Routes ↔ écrans** : 962 appels front reliés à 819 routes ; 7 routes API seules, documentées.

## Corrigé dans cette vérification
- **Export « fin de journée » (src/exports.js)** : la colonne `expenses.label` n'existe pas. La requête entière était masquée par swallow() : l'export renvoyait une liste vide sans erreur visible. Corrigé : la colonne « Réf. » prend `beneficiary`, à défaut `comment`. **Choix à valider.**
- **Recherche superadmin des clients (src/search.js)** : `clients.deleted_at` n'existe pas, la recherche renvoyait toujours zéro résultat. Corrigé : critère `status <> 'archive'`, identique aux listes existantes.
- Les deux requêtes corrigées passent la préparation PostgreSQL.

## Défauts restants (décision requise)
- **Sauvegardes par client (src/contracts.js, ~l.1741)** : `backup_logs` n'a ni `client_id` ni `created_at`. Le bloc renvoie zéro silencieusement. Les sauvegardes sont globales : il faut décider si ce bloc affiche la dernière sauvegarde de la plateforme ou disparaît.
- **Indicateur carburant du jour (src/ops_plus.js)** : la requête lit une table `fuel_sales` qui n'existe pas ; le `try` renvoie zéro. Il devrait suivre la règle canonique (relevés des quarts + ventes carburant), comme src/aggregates.js.
- **150 protections swallow()** réparties dans 40 fichiers : une erreur de requête y devient un résultat vide. Recommandation : vérifier que swallow() journalise bien l'erreur, puis rendre visibles les échecs critiques (export Z, clôture, ventes).

## Non vérifié
- Routes en HTTP sur un serveur démarré (dépendances absentes).
- Affichage des écrans dans un navigateur.
- Comportement de swallow() (journalisation) : non relu dans cette vérification.

## Tests
Suite complète : 190 suites, mêmes 7 échecs préexistants qu'origin/main ; aucune régression.
