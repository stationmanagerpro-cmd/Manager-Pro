# Rapport d'avancement — Étape 26 / Fiche A4

## Base documentaire
Cahier des charges Station Manager Pro, fiche A4, pages 4–6 : sauvegarder, réinitialiser et restaurer un compte client isolément; conserver identité, contrat, stations et utilisateurs; demander le mot de passe Super Admin et la confirmation écrite; créer une sauvegarde préalable; journaliser l'action; ne pas toucher aux autres clients.

## Cause confirmée par revue du code
Le mécanisme de verrouillage PostgreSQL `forbid_change_on_closed_shift()` refusait les suppressions de ventes et de lectures de compteurs associées à des quarts clôturés. La réinitialisation appelait ces suppressions dans une transaction, mais ne disposait d'aucune exception explicitement auditée. Cela explique le message « Quart clôturé : modification interdite » lors d'une réinitialisation.

## Correctif de code ajouté
- Nouvelle migration `059_audited_client_reset_closed_shifts.sql`.
- La fonction de verrou n'autorise le `DELETE` que si le paramètre transactionnel `station_manager.audited_client_reset` vaut `on`; INSERT et UPDATE sur quart clôturé restent refusés.
- Seule la route Super Admin de réinitialisation active ce paramètre, à l'intérieur de sa transaction.
- L'audit de la réinitialisation est inséré dans cette même transaction avant validation. Une erreur provoque un rollback.
- La sauvegarde isolée préalable, le contrôle du client, le mot de passe et la phrase `REINITIALISER CE CLIENT` restent exigés.
- Ajout du test statique `test/client-reset-closed-shift-static.js` et du script `npm run test:client-reset-closed-shift`.

## Vérifications réalisées dans l'environnement de développement
- `node --check src/tenant-backups.js` : OK.
- `node --check src/server.js` : OK.
- `node test/step23-isolated-backups-static.js` : 16/16.
- `node test/migration-safety-static.js` : 7/7.
- `node test/client-reset-closed-shift-static.js` : 8/8.

## Limites et recette obligatoire
Ces résultats sont des tests statiques et de syntaxe; aucun test n'a été exécuté contre la base PostgreSQL réelle de l'utilisateur. Avant d'utiliser la fonction, faire une sauvegarde indépendante, appliquer la migration 059 sur une base de test, créer un client de test contenant des ventes et lectures liées à un quart clôturé, vérifier la sauvegarde préalable, la réinitialisation et l'entrée d'audit, puis confirmer que les données des autres clients n'ont pas changé. La restauration A4 doit aussi être testée avec les deux formats JSON et JSON.GZ.
