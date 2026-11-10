# Étape 41 — Fiche A4 : vérification des garde-fous de réinitialisation

Date : 19 octobre 2026

## Périmètre
Reprise de la fiche A4 du cahier des charges : réinitialiser un client isolément en tant que Superadmin, avec sauvegarde préalable, confirmation écrite, mot de passe, conservation des éléments d'identité et audit transactionnel.

## Vérifications exécutées
- `node --check src/tenant-backups.js` : OK.
- `node --check src/server.js` : OK.
- `node test/step41-a4-reset-contract-static.js` : 7/7.
- `node test/client-reset-closed-shift-static.js` : 8/8.
- `node test/step23-isolated-backups-static.js` : 16/16.
- `node test/migration-safety-static.js` : 7/7.
- `node test/isolated-restore-json-static.js` : OK.
- `node test/restore-uncompressed-limit-static.js` : 7/7.
- `node test/restore-connection-security-static.js` : 6/6.

Ces tests sont des contrôles statiques et de syntaxe. Ils ne prouvent pas le comportement réel de PostgreSQL ni celui du navigateur.

## Constat sur le code
1. La réinitialisation est désactivée tant que `CLIENT_RESET_ENABLED` n'est pas explicitement égal à `1`.
2. La route demande le mot de passe du Superadmin et la phrase exacte `REINITIALISER CE CLIENT`.
3. Une sauvegarde isolée est créée avant la transaction destructive.
4. Le nettoyage exclut notamment clients, contrats, stations, utilisateurs, rôles, permissions et paramètres.
5. La suppression de lignes liées à des quarts clôturés n'est permise que dans le contexte transactionnel prévu pour la réinitialisation auditée; les INSERT/UPDATE restent verrouillés.
6. L'entrée d'audit est écrite avant le `COMMIT`; une erreur pendant la transaction déclenche un `ROLLBACK`.

## Limites restantes — ne pas marquer A4 « terminé »
- Migration `059_audited_client_reset_closed_shifts.sql` non appliquée ni testée ici sur PostgreSQL.
- Pas de test d'intégration avec un client de test comprenant des ventes et lectures de quarts clôturés.
- Pas de preuve de comparaison avant/après pour démontrer que les autres clients restent inchangés.
- Pas de recette de restauration avec fichiers JSON et JSON.GZ sur base de test.
- Pas de validation UI réelle sous un compte Superadmin et sous un compte client.

## Conclusion
A4 reste **Partiel — garde-fous statiques contrôlés**. Ne pas activer `CLIENT_RESET_ENABLED=1` en production avant la recette sur une base de test et une sauvegarde indépendante vérifiée. Aucun accès à la base de production n'a été effectué pendant cette étape.
