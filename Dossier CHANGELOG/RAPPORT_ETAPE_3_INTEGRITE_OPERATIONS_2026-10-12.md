# Station Manager Pro — Étape 3 : intégrité des opérations métier

Date : 2026-10-12  
Base de départ : `Station-Manager-Pro-etape-2-isolation-permissions-2026-10-12.zip`  
Périmètre : ventes de produits, ventes de carburant, dépenses, reprise après erreur réseau.

## Défaut confirmé dans le code source

La migration `002_exports_transfers_offline.sql` déclare des colonnes `client_ref` et des index uniques partiels sur `(station_id, client_ref)` pour `sales` et `expenses`, mais les routes applicatives n'utilisaient pas ces références. Une répétition de requête après perte de réseau pouvait donc créer une opération supplémentaire au lieu de renvoyer l'opération initiale.

## Corrections préparées

1. `src/operations.js` — la route `POST /sales` accepte une `client_ref` facultative (1 à 128 caractères après trim), verrouille transactionnellement la paire station/référence, recherche une vente existante avant tout mouvement métier, et renvoie cette vente avec HTTP 200 en cas de répétition. Les nouvelles ventes persistent la référence.
2. `src/fuelsales.js` — le même mécanisme est appliqué à `POST /sales/fuel`, partageant l'espace de clés de vente pour éviter qu'une même référence ne crée deux ventes par des routes différentes.
3. `src/operations.js` — la route `POST /expenses` accepte et persiste la référence; une répétition renvoie la dépense existante sans répéter le règlement financier ni l'audit.
4. Les verrous utilisent `pg_advisory_xact_lock` à l'intérieur de la transaction. La migration existante fournit les index uniques qui servent de contrainte durable. Les références restent facultatives pour compatibilité avec les clients historiques.
5. Ajout de `test/business-idempotency-static.js` et de `npm run test:business-idempotency-static`.

## Vérifications réellement exécutées

- `node --check` sur les fichiers JavaScript de `src/`, `test/` et `scripts/` : **51/51 réussis**.
- `npm run test:business-idempotency-static` : **14/14 contrôles statiques réussis**.
- `npm run test:migration-safety` : **7/7 réussis**.
- `npm run test:tenant-isolation-static` : **11/11 réussis**.
- `npm run test:detail-pages` : **19/19 contrôles structurels réussis**.
- `npm run test:contract-module-gates` : **8/8 réussis**.
- Intégrité de l'archive ZIP vérifiée après création.

## Limites importantes

- Aucun test d'intégration HTTP avec PostgreSQL n'a été exécuté.
- Aucun test de concurrence avec deux transactions réelles n'a été exécuté; les tests d'idempotence ci-dessus sont statiques.
- Les clés de reprise doivent être générées par le client une fois par action et réutilisées à chaque nouvelle tentative. Si le client envoie une nouvelle clé à chaque retry, le serveur ne peut pas reconnaître la répétition.
- Les anciennes bases doivent déjà avoir appliqué la migration 002 pour disposer des colonnes/index `client_ref`. Aucun changement de base n'a été appliqué dans cette étape.
- Les tests complets API, navigateur, restauration et calculs métier restent à faire sur une base de test isolée. L'installation de dépendances et l'exécution des tests destructifs ne sont pas incluses.

## Production

