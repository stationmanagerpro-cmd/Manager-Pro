# Fiche A5 — Limite de décompression lors de la restauration globale

Date : 2026-10-19

## Correctif

- La restauration globale ne décompresse plus le fichier gzip complet dans un Buffer uniquement pour le valider.
- Validation du gzip par flux avant la sauvegarde pré-restauration et avant toute modification de la base.
- Compte les octets décompressés et rejette les fichiers dépassant `RESTORE_MAX_UNCOMPRESSED_MB` (2 048 Mo par défaut, valeur bornée de 1 à 4 096 Mo).
- La limite de taille téléversée compressée existante demeure active (`RESTORE_MAX_MB`, bornée à 200 Mo).
- La validation exige toujours un flux gzip valide et un dump décompressé d'au moins 100 octets.

## Vérifications réalisées

- `node --check src/maintenance.js` : réussi.
- `node test/restore-uncompressed-limit-static.js` : 7/7 contrôles statiques réussis.
- Tests existants de sécurité de connexion et de sauvegarde/restauration exécutés séparément; ils restent des tests de code, pas une restauration réelle.

## Limites

Aucun test de restauration sur une base PostgreSQL isolée n'a été effectué dans cet environnement. Avant production, faire une sauvegarde indépendante, restaurer dans une base de test et vérifier les données, fichiers téléversés, comptes, permissions et reconnexion.
