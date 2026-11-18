# Migrations : suppression des BEGIN/COMMIT imbriqués — 18 novembre 2026

## Problème
- `src/migrate.js` ouvre déjà une transaction par fichier (BEGIN, fichier, INSERT dans `schema_migrations`, COMMIT).
- Sept fichiers ouvraient et fermaient leur propre transaction : `045`, `046`, `047`, `048`, `049`, `050`, `086`.
- Le COMMIT interne validait le travail avant l'INSERT dans `schema_migrations`, et le ROLLBACK du runner n'annulait rien.
- Reproduit sur base PostgreSQL 16 : après une erreur au milieu d'un fichier, les tables déjà créées restaient en base, sans enregistrement. Au démarrage suivant, le fichier aurait été rejoué sur des objets existants.

## Correction
- Suppression des seules lignes `BEGIN;` et `COMMIT;` dans les sept fichiers (14 lignes au total).
- Aucun autre changement de contenu. Aucune migration déjà appliquée n'est modifiée au sens du runner : elles sont identifiées par leur nom et ne sont pas rejouées.

## Vérifications
- Base PostgreSQL 16 neuve, 120 migrations appliquées dans l'ordre, avec une transaction par fichier :
  - version HEAD et version corrigée : 173 tables chacune, schémas identiques (`pg_dump --schema-only`, hors jetons `\restrict`).
  - erreur injectée à la fin de `046` : code retour 3, nombre de tables inchangé avant/après (rien de la migration n'est resté).
- Aucune opération incompatible avec une transaction dans ces fichiers (`CONCURRENTLY`, `VACUUM`, `ADD VALUE`, etc.).
- 60 tests statiques et unitaires qui lisent les migrations : tous OK (dont `migration-safety-static`).

## Conséquences
- Pour une base déjà à jour : aucun effet (les migrations sont ignorées).
- Pour une base neuve ou une base qui doit encore appliquer ces fichiers : chaque fichier est désormais atomique.

## Non modifié (volontairement)
- `public/downloads/Manager_Pro-debug-2026-11-17.apk` : téléchargement de l'APK par les utilisateurs, conservé.
- `public/manuel/Manuel_Utilisation_Manager_Pro.pdf` : manuel utilisé par l'aide, conservé.
- `migrations/070_remove_client_device_link.sql` : suppression de tables voulue par le projet, non modifiée.

## Non vérifié
- Déploiement sur Render et base de production réelle (non accessibles depuis cette session).
