# Étape 44 — A5 : double verrou pour la restauration SQL complète

Date : 2026-10-19

## Changement
La restauration SQL complète depuis l’interface exige maintenant simultanément `RESTORE_ENABLED=1` et `RESTORE_TARGET_ISOLATED=1`. La deuxième variable est une déclaration explicite que l’opérateur travaille sur une base de reprise isolée. Le statut envoyé à l’interface ne peut annoncer la restauration active que si les deux conditions sont remplies. Les messages UI signalent que l’opération remplace tout le schéma `public` et peut effacer les données de tous les clients.

## Limites
Ce verrou est une protection de configuration, pas une preuve technique que la base cible est isolée : l’application ne peut pas déduire de façon fiable l’intention de l’opérateur à partir de cette variable seule. Ne jamais activer ces variables sur une base active de production. La réinitialisation globale reste suspendue. Aucun test PostgreSQL réel n’a été exécuté dans cette étape.

## Vérifications
Le test statique `test:a5-full-restore-dual-guard` couvre les deux variables, le statut UI, les avertissements et la transaction de restauration. Les tests statiques A5 existants sont également exécutés lors de la validation de livraison.
