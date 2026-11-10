# Étape 26 — sauvegarde complète et migration conservée

## Changements

- Ajout de `scripts/windows/backup-complete.ps1` pour créer une archive hors du projet qui rassemble un dump PostgreSQL réellement créé par `npm run backup` et les fichiers du répertoire `UPLOAD_DIR`.
- La sauvegarde combinée écrit un manifeste contenant les tailles et empreintes SHA-256, extrait ensuite l'archive dans un dossier temporaire et vérifie chaque fichier. En cas d'échec, le package incomplet est supprimé et l'échec remonte à PowerShell.
- Le script refuse une destination dans le dossier du projet et n'inclut pas `.env`, les mots de passe ni les secrets.
- Le script de migration demande maintenant un chemin de conservation du dump source hors du dossier du projet, idéalement un disque externe chiffré. Le dump source est conservé après restauration afin de permettre un retour arrière contrôlé.
- Le guide Windows décrit la commande de sauvegarde combinée et précise que la vérification d'archive ne remplace pas un test de restauration PostgreSQL.
- Ajout de 13 contrôles statiques dédiés à l'étape 26 et actualisation des contrôles de l'étape 25.

## Limites connues

- Les scripts PowerShell n'ont pas été exécutés sous Windows dans cet environnement. Ils doivent être testés sur le PC avant usage sur les données réelles.
- Aucune connexion PostgreSQL, migration de données ou restauration réelle n'a été exécutée pendant cette étape.
- L'intégrité SHA-256 prouve que les fichiers de l'archive correspondent au manifeste, pas que le dump PostgreSQL peut être restauré avec succès. Une restauration d'essai sur une base distincte reste obligatoire.
- Le script n'inclut volontairement pas `.env`. Conserver les secrets séparément dans un gestionnaire sécurisé; ne jamais placer de sauvegarde sur un disque non chiffré.
