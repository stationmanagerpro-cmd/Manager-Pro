# Correctif sécurité sauvegarde PostgreSQL — 19/10/2026

## Modifications

- `pg_dump` ne reçoit plus `DATABASE_URL` complète dans ses arguments de processus.
- L'URL PostgreSQL est décomposée en hôte, port, utilisateur et base ; le mot de passe est transmis via l'environnement du processus enfant (`PGPASSWORD`).
- Les paramètres de connexion usuels `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `connect_timeout` et `application_name` sont transmis aux variables d'environnement libpq correspondantes.
- Les URL invalides, les protocoles non PostgreSQL et les noms de base absents sont rejetés avant lancement de `pg_dump`.
- Gestion des erreurs ajoutée sur les flux stdout, gzip et fichier de sortie afin d'éviter qu'une erreur de flux ne laisse la sauvegarde bloquée.
- Nouveau test unitaire statique/fonctionnel : `test/backup-connection-security-unit.js`.

## Vérifications

- `node --check src/backup.js` : réussi.
- `node test/backup-connection-security-unit.js` : 10 assertions réussies.
- `node test/step21-backup-restore-static.js` : 19/19.
- `node test/step23-isolated-backups-static.js` : 16/16.
- `node test/step26-complete-backup-static.js` : 10/10.
- `node test/payroll-zero-amount-guidance-static.js` : réussi.

Aucun dump réel n'a été exécuté contre une base PostgreSQL dans cet environnement. `PGPASSWORD` est plus sûr qu'un secret placé dans la ligne de commande, mais reste une variable d'environnement du processus enfant ; protégez les accès au serveur et à son compte d'exécution.
