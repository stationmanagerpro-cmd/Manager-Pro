# Étape 43 — A5 : audit du périmètre plateforme

Date : 2026-10-19

## Objectif

Poursuivre la fiche A5 sans réactiver une opération destructive tant que le périmètre plateforme-only n’est pas prouvé. Référence : `Station_Manager_Pro_Cahier_des_charges.docx`, fiche A5.

## Constat dans le code

1. `src/tenant-backups.js` produit une archive logique plateforme à partir d’une liste explicite (`users`, `roles`, `permissions`, `role_permissions`, `app_settings`, `settings`). Les utilisateurs sont filtrés par `is_global=true`. Les paramètres `app_settings`/`settings` rattachés à un `client_id` ou `station_id` sont filtrés lorsqu’une telle colonne existe.
2. La restauration logique plateforme applique également une liste autorisée limitée et ignore les lignes de paramètres rattachées à un client ou à une station.
3. La route `POST /admin/maintenance/reset-global` reste suspendue et répond HTTP 409. Cette protection est conservée.
4. La route SQL `POST /admin/maintenance/restore` utilise `DROP SCHEMA IF EXISTS public CASCADE` avant de rejouer le dump. Elle peut remplacer l’ensemble du schéma, y compris les données métier des clients. Elle n’est disponible que lorsque `RESTORE_ENABLED=1`; ne pas activer cette variable sur la base active pour un essai. Un test de restauration d’un dump complet doit se faire sur une base de reprise isolée, jamais sur la base opérationnelle.

## Action de cette étape

- Ajout de `test/a5-platform-scope-audit-static.js`.
- Ajout de la commande `npm run test:a5-platform-scope-audit`.
- Le test vérifie la liste autorisée plateforme, le filtrage du compte global, les paramètres rattachés aux clients/stations, la suspension du reset et le caractère globalement destructif de la restauration SQL complète.
- Aucun code destructif n’a été réactivé et aucune base PostgreSQL n’a été contactée.

## Résultats

Le test statique A5 plateforme a réussi : **9/9**. Contrôles complémentaires relancés : A5 reset 8/8, sauvegarde/restauration 19/19, sauvegardes isolées 16/16, sauvegarde complète 10/10, sécurité `pg_dump` 10 assertions et sécurité `psql` 12 assertions. `package.json` est valide et les fichiers JavaScript vérifiés passent `node --check`.

## Limites / décisions restantes

- La liste des six tables est une liste de code, pas encore une preuve complète de leur sémantique dans toutes les installations. Il faut vérifier les migrations et le schéma réel d’une base de test.
- Certaines tables `settings`/`app_settings` sans colonnes `client_id` ou `station_id` nécessitent une revue métier avant d’être considérées globales.
- A5 demeure **partielle** : le cycle complet sauvegarder/restaurer/réinitialiser n’a pas été exécuté sur PostgreSQL isolé.
- Le reset global reste suspendu. La restauration SQL complète ne doit pas être activée sur la base opérationnelle pour tester.
