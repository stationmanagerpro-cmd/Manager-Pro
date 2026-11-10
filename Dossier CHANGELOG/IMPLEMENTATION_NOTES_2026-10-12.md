# Station Manager Pro — première tranche de correction (2026-10-12)

## Implémenté dans cette tranche

- Ajout des routes de fiche dédiées `clidet` et `supdet`, avec navigation par sections, accessibles depuis les noms/lignes des listes clients et fournisseurs.
- Réutilisation des API existantes d'historique client/fournisseur pour ventes, paiements, avoirs, commandes et factures fournisseur.
- Ajout d'une fiche administrative Super Admin `clientdetail` avec sections Vue d'ensemble, Contrat/abonnement, Utilisateurs, Modules, Historique et Publicité personnalisée.
- Ajout de `GET /admin/clients/:id/users`, limité au Super Admin et ne renvoyant pas les secrets d'authentification. L'activité de session est déterminée à partir des sessions non révoquées et non expirées.
- Ajout d'une configuration de panneau publicitaire par client stockée dans `app_settings`, d'une limite serveur de cinq images, de validation PNG/JPEG par le module de fichiers existant, d'un ordre d'images, d'un mode brouillon/publication et d'une API d'affichage strictement limitée au client de la station courante.
- Le dashboard client remplace le panneau publicitaire global par la configuration propre à son client ; le carrousel démarre à partir de deux images.

## Vérifications réalisées

- `node --check` a réussi sur les fichiers JavaScript de `src/`, `public/` et `test/` après les modifications.
- Aucune migration SQL n'a été nécessaire pour les publicités, car leur configuration utilise la table `app_settings` existante.

## À valider avant production

1. Exécuter les migrations déjà prévues sur une base de test dédiée, jamais sur la production pour les essais.
2. Vérifier que le compte Super Admin possède `user.manage` et que les routes de gestion client restent réservées au rôle global.
3. Vérifier les requêtes utilisateur sur la version exacte de la base : colonnes `users.client_id`, `users.full_name`, `users.job_title` et tables `user_sessions`, `user_stations`.
5. Tester deux clients différents et confirmer qu'aucun ne peut lire les images ou la configuration de l'autre.
6. Valider dans un navigateur réel les interactions, les formulaires de facture client, les actions de contrat et les permissions par rôle.

Cette livraison constitue une première tranche et ne signifie pas que l'ensemble du cahier des charges est terminé.

## Deuxième tranche — formulaires intégrés et cohérence des historiques

- La création d'une facture/vente client est maintenant proposée directement dans l'onglet Factures de la fiche client, sans ouvrir une modale de saisie. Le formulaire contrôle le produit, la quantité, le mode de règlement et l'employé, puis appelle le processus métier `POST /sales`.
- La création d'un bon de commande est maintenant intégrée à l'onglet Commandes de la fiche fournisseur. Les coûts unitaires sont contrôlés côté interface et côté API ; le détail de commande existant reste accessible pour réception, facture et paiement.
- L'historique fournisseur utilisait une ancienne table `purchase_orders`, alors que le processus métier actuel enregistre dans `purchases`. La requête utilise désormais la table réelle et retourne les paiements associés lorsque le rôle le permet.
- Les permissions de lecture des historiques ont été alignées sur celles des listes correspondantes (`customer.view` ou `sale.create`, et `supplier.view` ou permissions d'achat applicables). Les avoirs/créances client sont masqués aux rôles sans `receivable.view`; les avoirs fournisseur sont limités aux rôles ayant `debt.view`.
- Ajout d'un test structurel sans base de données : `npm run test:detail-pages`. Il vérifie la présence des vues/formulaires et quelques invariants de sécurité.

## Vérifications de cette tranche

- `node --check public/ext-detail-pages.js` : réussi.
- `node --check src/catalog.js` : réussi.
- `npm run test:detail-pages` : 11 contrôles réussis.

## Troisième tranche — robustesse du traitement des renouvellements

- Le traitement d'une demande de renouvellement utilise désormais une transaction unique pour la décision, le renouvellement éventuel du contrat, la réactivation du client et l'écriture de l'historique de licence. Une erreur sur l'une de ces opérations annule l'ensemble au lieu de laisser une demande approuvée sans contrat renouvelé.
- La demande est verrouillée (`FOR UPDATE`) pendant le traitement et le changement de statut est conditionné à `status = 'pending'`, afin d'éviter les doubles décisions concurrentes.
- L'identifiant de demande est validé avant toute requête SQL.
- Trois contrôles structurels supplémentaires couvrent ces invariants. Ils ne remplacent pas les tests d'intégration PostgreSQL.


## Correctif d’accès au panneau publicitaire (2026-10-12)

- Ajout d’une page Super Admin dédiée `Panneau publicitaire client`, accessible directement depuis chaque ligne de la liste `Licences & contrats clients` avec le bouton `Configurer la publicité`.
- L’onglet `Publicité personnalisée` reste également disponible dans la fiche administrative du client.
- La page dédiée conserve le contrôle Super Admin et utilise les routes publicitaires existantes propres au client sélectionné.


## Tranche profils et compte administrateur local — 2026-10-12

- Les fiches client et fournisseur restent des pages dédiées sans modale de détail; les lignes de clients et fournisseurs y naviguent.
- Dans la fiche Super Admin d’un client, chaque ligne de compte utilisateur ouvre désormais une fiche individuelle avec identité, rôle, statut, dernière connexion, session et stations liées.
- La création d’un client et de sa licence exige maintenant les identifiants d’un administrateur local. Le compte est créé avec le rôle `ADMIN` non-global, rattaché au client et lié à sa station initiale; le nom du responsable reste une information de contact distincte.
- Aucun accès Super Admin n’est donné à ce compte local (`is_global = FALSE`). Les autorisations effectives restent limitées par les permissions de rôle et les règles contractuelles côté serveur.
