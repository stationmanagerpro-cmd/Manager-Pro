# Étape 10 — Fiche A5 : sauvegarde globale et sécurité de restauration

Date : 2026-10-19

## Correction effectuée

Les commandes de restauration PostgreSQL ne transmettent plus l'URL `DATABASE_URL` complète dans les arguments de processus. La nouvelle fonction `psqlConnectionOptions()` décompose l'URL et fournit :
- hôte, port, utilisateur et base via les arguments `psql` ;
- mot de passe via la variable d'environnement `PGPASSWORD` du processus enfant ;
- paramètres SSL, délai de connexion et nom d'application via les variables `PG*` adaptées.

Cette fonction est utilisée par la restauration globale depuis l'interface (`src/maintenance.js`) et par la restauration manuelle (`src/restore.js`). Les validations rejettent les URL mal formées, les protocoles non PostgreSQL et les URL sans nom de base.

## Vérifications réalisées

- `node test/restore-connection-security-unit.js` : 12 assertions réussies.
- `node test/restore-connection-security-static.js` : 6/6 contrôles réussis.
- `node test/backup-connection-security-unit.js` : 10 assertions réussies.
- `node test/step21-backup-restore-static.js` : 19/19 contrôles statiques réussis.
- `node test/step23-isolated-backups-static.js` : 16/16 contrôles statiques réussis.
- `node test/step26-complete-backup-static.js` : 10/10 contrôles statiques réussis.
- `node --check` sur `src/backup.js`, `src/maintenance.js` et `src/restore.js` : réussi.

## Limites

Ces tests vérifient le code et les options de connexion, pas une restauration réelle. Aucune base PostgreSQL de test n'a été restaurée dans cet environnement. Avant production, effectuer une sauvegarde indépendante, restaurer dans une base isolée, vérifier les données et les fichiers téléversés, puis confirmer les accès et la connexion.

Les opérations destructrices restent désactivées par défaut et les routes globales demeurent réservées au Super Admin.
