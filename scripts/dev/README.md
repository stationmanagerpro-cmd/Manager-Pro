# Scripts de dépannage (développement uniquement)

Ces scripts ne font pas partie de l'application : ils servent au diagnostic local (schéma, soldes fournisseurs, etc.).
Ils sont exclus de l'image Docker (`.dockerignore`) et ne doivent jamais être exécutés sur une base de production sans sauvegarde préalable.

Lancer depuis la racine du projet (le fichier `.env` est lu dans le dossier courant) :

    node scripts/dev/check-db.js
