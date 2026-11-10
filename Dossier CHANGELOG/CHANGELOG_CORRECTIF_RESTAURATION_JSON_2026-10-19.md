# Correctif restauration client — 19 octobre 2026

## Problème ciblé
Le point de terminaison de restauration isolée attendait uniquement une archive gzip. Un fichier `.json` valide mais non compressé était donc refusé, alors que le cahier des charges demande les deux formats et une détection à partir du contenu réel.

## Changements
- Ajout d’un parseur qui reconnaît la signature gzip ou lit un JSON UTF-8 non compressé, sans se fier à l’extension.
- Vérification explicite du format, de la version, du périmètre client/plateforme et de l’identifiant du client avant toute modification.
- Messages d’erreur plus précis pour les archives corrompues, les formats non pris en charge et les archives appartenant à un autre client.
- Le formulaire de restauration client accepte `.json` et `.json.gz` et envoie le type de contenu approprié.
- La restauration reste réservée au Super Admin, exige le mot de passe et demeure protégée par `CLIENT_RESTORE_ENABLED=1`; tester d’abord sur une base isolée.
- Ajout d’un test statique dédié : `npm run test:isolated-restore-json`.

## Validation effectuée
- `node --check src/tenant-backups.js` : réussi.
- `node --check public/ext-detail-pages.js` : réussi.
- Tests statiques de fiscalité, logo, sauvegardes isolées et restauration JSON : en cours de vérification.

La restauration réelle avec PostgreSQL et une archive représentative doit encore être exécutée dans l’environnement de déploiement.
