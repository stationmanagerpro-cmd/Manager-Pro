# Stockage durable des fichiers dans Neon — étape 60

## Ce que change cette mise à jour

- Ajoute `migrations/060_stored_files.sql`, qui crée `stored_files` avec UUID, clé de stockage, type MIME, taille, contenu binaire (`BYTEA`) et date de création.
- Les nouveaux fichiers envoyés via les fonctions communes (`src/files.js`) sont enregistrés dans PostgreSQL/Neon. Les lectures, suppressions et types MIME passent également par la base.
- Les appels concernés sont adaptés à l'API asynchrone : photos de profil, images de stations/clients/fournisseurs/employés, branding, page d'accueil, publicités client, documents fiscaux et pièces jointes de dettes RH.
- Les références de nouveaux fichiers sont stockées sous la forme `stored_files:<uuid>.<extension>` ; les colonnes existantes `photo_path`, `file_path`, etc. restent compatibles.
- Les anciens chemins locaux restent lisibles/supprimables tant que les anciens fichiers sont encore présents sur le disque. Ils ne sont pas automatiquement transférés dans Neon par cette migration.
- Contrôles conservés : détection du vrai format à partir des octets, rejet des formats non autorisés et taille maximale de 2 Mio par fichier.

## Déploiement conseillé

1. Faire une branche de secours / sauvegarde de la base Neon avant la mise à jour.
2. Déployer le code de cette archive sur GitHub/Render.
3. Depuis le dossier du projet local, avec `DATABASE_URL` pointant vers la base Neon visée, lancer `npm run migrate` (le script de migration du projet sauvegarde d'abord les bases contenant des données, sauf option explicite `--no-backup`).
4. Vérifier dans Neon SQL Editor :

   ```sql
   SELECT to_regclass('public.stored_files') AS stored_files_table;
   SELECT name, applied_at FROM schema_migrations WHERE name = '060_stored_files.sql';
   ```

5. Tester l'envoi d'une nouvelle photo, vérifier sa présence après redéploiement de Render, puis tester la lecture et la suppression.

## Limites et précautions

- Cette archive ne se connecte pas à ta base Neon et n'exécute aucune migration distante. La table n'existera qu'après application de la migration.
- La migration crée le stockage, mais ne migre pas automatiquement les fichiers déjà enregistrés dans `uploads/` ni les références historiques. Les anciens fichiers locaux restent dépendants de la présence de ces fichiers sur le disque Render. Pour les conserver, il faut les importer dans `stored_files` et mettre à jour leurs références avant de supprimer l'ancien stockage.
- Les fichiers sont conservés dans la base PostgreSQL ; cela augmente la taille de la base et consomme son quota. La limite actuelle par fichier est de 2 Mio.
- Effectuer un test de restauration avant la production. Ne pas lancer une migration sur la base de production sans sauvegarde vérifiée.
