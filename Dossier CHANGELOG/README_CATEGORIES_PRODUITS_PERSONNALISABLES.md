# Catégories de produits personnalisables — Étape 59

## Fonctionnalités

- Consulter les catégories disponibles dans le formulaire produit.
- Ajouter une catégorie avec nom libre et option « avec compteurs ».
- Renommer une catégorie sans changer son code interne, pour préserver les produits, ventes et rapports historiques.
- Supprimer une catégorie seulement si aucun produit ne l'utilise.
- La catégorie système `CARBURANT` ne peut pas être supprimée.
- La gestion est protégée par la permission `settings.edit`; l'API vérifie aussi cette permission.

## Installation

1. Faites une sauvegarde de PostgreSQL avant de déployer une mise à jour.
2. Décompressez le ZIP dans une copie de travail de votre projet.
3. Conservez votre `.env` et ne l'envoyez jamais à GitHub.
4. Installez les dépendances si nécessaire avec `npm.cmd install`.
5. Aucun changement de schéma SQL n'est nécessaire pour cette évolution : elle utilise la table `categories` existante.
6. Redémarrez le serveur (`npm.cmd start`) ou déployez les changements via votre procédure habituelle.
7. Connectez-vous avec un compte autorisé à modifier les paramètres, ouvrez **Produits et stock**, puis **Gérer les catégories**.

## Limite importante : périmètre partagé

Dans le schéma actuel, `categories` est une table commune à toute la base, et non une table rattachée à `station_id`. Les créations et renommages de catégories sont donc visibles par toutes les stations qui partagent cette base. Cette livraison documente ce comportement explicitement; elle ne prétend pas fournir des catégories isolées par station. Pour une personnalisation indépendante par station, il faudra une migration dédiée qui rattache les catégories à chaque station et migre les références existantes des produits.

## Vérifications

- `node --check src/catalog.js`
- `node --check public/app.js`
- Contrôles statiques de présence des routes, permissions, affichage du libellé, et protection contre la suppression d'une catégorie utilisée.

Aucun test connecté à une base PostgreSQL de production n'a été exécuté.
