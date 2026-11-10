# Rapport d’inventaire initial — Station Manager Pro

**Date :** 12 octobre 2026  
**Étape :** 0 — inventaire de l’archive, avant toute correction  
**Archive source :** `Station-Manager-Pro-profils-clients-fournisseurs-admin-local-2026-10-12.zip`  
**SHA-256 de l’archive source :** `9a7890e43d597d6a5400492e7d133ddb3f75c8adc5ac21cb025bc820e8b2419d`  

## 1. Résumé du contenu

- Archive ZIP valide : le test d’intégrité `unzip -t` n’a signalé aucune erreur.
- 159 fichiers dans l’archive source, environ 1 989 589 octets décompressés.
- Principaux répertoires : `public/` (36 fichiers), `migrations/` (31 fichiers SQL), `src/` (30 fichiers), `docs/` (19 fichiers), `test/` (17 fichiers), `scripts/` (2 fichiers).
- Backend : Node.js/Express et PostgreSQL (`pg`).
- Interface : application web dans `public/`, composée d’un HTML principal, d’un CSS principal, d’un grand nombre de scripts d’extension, d’un service worker et d’éléments PWA.
- Schéma/migrations : migrations numérotées `001` à `031`.
- Tests déclarés : tests unitaires/structurels, tests API et tests d’interface navigateur.

## 2. Vérifications effectivement exécutées

| Vérification | Résultat observé | Limite |
|---|---|---|
| Intégrité de l’archive source | Réussie, aucune erreur ZIP | Ne valide pas le comportement de l’application |
| Syntaxe JavaScript | 81 fichiers vérifiés, 0 erreur `node --check` | Contrôle syntaxique uniquement |
| `npm run test:detail-pages` | Réussi : 19 contrôles structurels sur 19 | Vérifie des motifs/fichiers, pas une session navigateur ni les réponses réelles de l’API |
| `npm run test:platform-unit` | Réussi : 11 assertions sur 11 | Couvre seulement les fonctions testées de finance plateforme/CSV |
| Tests API complets (`npm test`) | Non exécutés | Ils démarrent le serveur et nécessitent une base de test initialisée. Aucun accès à une base n’a été tenté |
| Tests Playwright (`test:ui-shell`) | Non exécutés | Le test importe `playwright`, mais cette dépendance n’apparaît ni dans `package.json` ni dans `package-lock.json` |

## 3. Risques confirmés à traiter en priorité

### P0 — Migration 025 potentiellement destructive pour l’historique de renouvellement

`migrations/020_subscription_modules.sql` crée déjà `license_renewal_requests`. La migration `migrations/025_license_warnings_renewal_requests.sql` contient ensuite `DROP TABLE IF EXISTS license_renewal_requests CASCADE` avant de recréer la table. Si une base a appliqué la migration 020 et possède des demandes de renouvellement, mais n’a pas encore enregistré/appliqué la migration 025, l’application de 025 peut supprimer ces demandes et les objets dépendants. **Ne pas lancer `npm run migrate` sur une base réelle tant que le chemin de migration n’a pas été sécurisé et testé sur une copie.**

### P1 — Détection de base existante fragile dans le lanceur de migrations

`src/migrate.js` marque automatiquement la première migration comme appliquée lorsque `schema_migrations` est vide et que la seule vérification `to_regclass('public.stations')` réussit. Cette heuristique ne prouve pas que le schéma complet correspondant à la migration initiale est présent. Elle peut masquer un historique incomplet ou conduire à un état de migration incohérent.

### P1 — Protection des tests de restauration à renforcer

`scripts/ci-restore-test.js` refuse une URL si elle ne contient pas `test`, `_test` ou `ci`. C’est un garde-fou fondé sur le nom de l’URL, pas une preuve indépendante que la base cible est isolée. Les tests destructifs de restauration devront exiger une base dédiée et vérifier l’environnement/cible avant toute opération.

### P1 — Tests d’interface non reproductibles dans l’état déclaré des dépendances

`test/ui-shell/ui-shell.test.js` importe `playwright`, mais `playwright` n’est pas déclaré dans les dépendances du projet. Ce test ne doit pas être annoncé comme réussi avant d’avoir ajouté/verrouillé la dépendance et exécuté le test dans un environnement équipé du navigateur requis.

## 4. Points d’audit à approfondir lors de l’étape suivante

Ces éléments sont des axes d’investigation, pas des défauts tous démontrés à ce stade :

1. Contrôle uniforme des permissions et des modules de contrat sur chaque route API, y compris les routes montées tôt dans `src/server.js`.
2. Isolation des données entre clients/stations dans les requêtes SQL et lors du changement de station active.
3. Cohérence des rôles Super Admin, Administrateur Local, Gérant et rôles opérationnels entre serveur, permissions effectives et menus visibles.
4. Transactions et idempotence des opérations qui touchent plusieurs tables (ventes, achats, paiements, renouvellements, écritures financières).
5. Échappement des données affichées dans les usages de `innerHTML`, politique CSP et scripts chargés globalement.
6. Cache du service worker, invalidation des assets, affichage mobile et navigation par rôle.
7. Couverture des sauvegardes/restaurations et séparation stricte entre tests et production.
8. Vérification métier pour l’usage au Mali : FCFA/XOF, rapprochements espèces/Mobile Money, équipes et clôtures de poste, sans présumer de conformité fiscale/sociale sans validation locale.

## 5. Décision de sécurité pour cette étape

- Aucun fichier métier n’a été corrigé.
- Aucune migration SQL n’a été appliquée.
- Aucun test nécessitant une base de données n’a été lancé.
- La prochaine étape doit être une revue détaillée des routes/permissions et des migrations, puis une première correction non destructive validée sur une base de test dédiée avant toute proposition de déploiement.
