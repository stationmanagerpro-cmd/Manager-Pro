# Checklist SLA sauvegarde (gratuit — exploitation)

À faire **une fois** sur un environnement de test avant d’accueillir des clients payants.

1. Créer une sauvegarde depuis l’admin (bouton existant).
2. Noter le nom du fichier et la date.
3. Sur un **serveur de test** (jamais la prod en premier) : activer `RESTORE_ENABLED=1` **et** `RESTORE_TARGET_ISOLATED=1` uniquement sur une base isolée dédiée. La restauration remplace tout le schéma `public` et peut effacer toutes les données clients.
4. Restaurer le fichier, vérifier : login, une vente, un quart.
5. Documenter la durée constatée et le responsable.
6. Remettre `RESTORE_ENABLED=0` et `RESTORE_TARGET_ISOLATED=0` après le test.
7. Planifier un test tous les 3 mois.

Aucun coût fournisseur : utilise les outils déjà dans Station Manager Pro.
