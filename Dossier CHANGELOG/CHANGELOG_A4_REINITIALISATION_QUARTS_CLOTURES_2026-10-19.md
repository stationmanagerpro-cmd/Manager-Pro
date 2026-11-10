# Étape 26 — A4 : réinitialisation isolée et quarts clôturés

## Cause technique ciblée
La réinitialisation client utilise le même chemin de suppression que la restauration. Les déclencheurs PostgreSQL `sales_lock` et `readings_lock` refusent toute modification d'une vente ou lecture liée à un quart clôturé. Le nettoyage de données échouait donc sur des clients ayant des quarts clôturés.

## Correctif
- Migration `059_audited_client_reset_closed_shifts.sql` : le verrou du quart reste actif, sauf pour une opération `DELETE` lorsque le paramètre de transaction `station_manager.audited_client_reset` vaut `on`.
- Route de réinitialisation : conserve les contrôles Super Admin, mot de passe, confirmation exacte et sauvegarde isolée préalable.
- Le paramètre d'exception est activé uniquement dans la transaction dédiée à cette réinitialisation et disparaît à la fin de la transaction.
- L'entrée d'audit est maintenant écrite dans la même transaction avant le `COMMIT`; en cas d'échec, suppression et entrée d'audit sont annulées ensemble.
- La restauration ordinaire et les opérations de vente/lecture ne reçoivent pas cette exception.

## Tests
- `node --check src/tenant-backups.js` — OK.
- `node test/client-reset-closed-shift-static.js` — tests statiques à exécuter.
- Aucun test d'intégration sur PostgreSQL réel n'a été exécuté ici. Appliquer la migration seulement après sauvegarde indépendante et recette sur une base de test.
