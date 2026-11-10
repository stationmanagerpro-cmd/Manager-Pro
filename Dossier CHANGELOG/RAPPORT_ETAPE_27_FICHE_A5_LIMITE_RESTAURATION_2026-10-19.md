# Étape 27 — Fiche A5 : limitation de la décompression à la restauration

## Constat

La route de restauration contrôlait auparavant le fichier compressé en appelant `zlib.gunzip` sur tout le contenu reçu. La limite du téléversement compressé n'empêchait pas un fichier très compressible de produire un dump décompressé volumineux et de consommer beaucoup de mémoire durant cette validation.

## Correction

La route écrit d'abord le fichier gzip dans un fichier temporaire à permissions restreintes, puis valide sa décompression en flux, en comptant les octets. La taille décompressée est bornée par `RESTORE_MAX_UNCOMPRESSED_MB`, avec valeur par défaut de 2 048 Mo et configuration bornée de 1 à 4 096 Mo. Cette validation intervient avant la sauvegarde pré-restauration et avant la modification de la base.

## Contrôles

- Syntaxe de `src/maintenance.js` vérifiée.
- 7 contrôles statiques dédiés à la limite décompressée.
- Les tests existants couvrent aussi les options de connexion, les sauvegardes et la restauration statiquement.

## Non certifié

Ce correctif n'a pas été validé par restauration réelle sur PostgreSQL dans cet environnement. Le fonctionnement en production doit être confirmé sur une base isolée avant d'activer `RESTORE_ENABLED=1`.
