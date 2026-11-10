# Produits actifs/inactifs, photo du produit, export PDF de la fiche produit — 2026-10-27

## 1. Produits actifs / inactifs (comme pour les fournisseurs)
- Liste « Produits et stock » : n'affiche que les **produits actifs**. Bouton **🗄 Produits inactifs** (⇄ « ← Produits actifs »), bandeau d'information, bouton **🗄 Archiver / ♻ Réactiver** sur chaque ligne et dans la fiche du produit (droit `price.edit`).
- API : `GET /products` (actifs) · `GET /products?inactive=1` (inactifs) · `PATCH /products/:id/status` `{ active, reason? }` (audité).
- Un produit **relié à un compteur de pompe** ne peut pas être archivé (409) : changez d'abord le produit du compteur.
- Un produit inactif n'est plus proposé dans les ventes, les formulaires, les mouvements de stock ni les **nouvelles commandes** (409 « Produit inactif »). Les commandes déjà passées restent réceptionnables et payables.
- Aucune donnée supprimée : ventes, achats, prix, stocks et fiche restent consultables (la fiche d'un produit inactif s'ouvre depuis la liste des inactifs, et « Modifier le produit » y fonctionne).
- Migration `077_produits_photo_inactifs.sql` : `products.photo_path`, `products.deactivated_at` (les produits déjà inactifs reçoivent une date).

## 2. Photo de profil du produit
- Cause du problème : les images n'étaient gérées que pour la station, les clients, les fournisseurs et les employés ; la fiche produit n'affichait qu'une lettre, sans action.
- Maintenant : vraie photo sur la fiche (cliquable) + bouton **📷 Photo** (changer / supprimer), et miniature dans la liste. API `PUT/GET/DELETE /images/products/:id`.
- Droits : `image.manage` **ou** `price.edit` **ou** `stock.adjust` (un gérant de stock peut changer la photo sans droit « images »).

## 3. Export PDF de la fiche produit (`src/product_profile.js`)
- `GET /products/:id/profile.pdf?period=30d|3m|12m|all&section=all|overview|behavior|prices|supply|stock`
- **📄 PDF complet du produit** : identité (statut, codes, prix, marge, stock, fournisseur), indicateurs, ventes et flux par période, mouvements par type, jours de la semaine, meilleurs clients, ventes par employé, approvisionnement par fournisseur, **historique complet des prix**, **historique de dotation** (achats, commandes en cours, coût moyen/min/max), **historique des stocks** (500 derniers mouvements).
- **📄 PDF de l'onglet affiché** : seulement l'onglet ouvert (avec les filtres type/dates de l'écran pour les stocks).
- Mêmes règles que l'écran : sections Dotation/Stocks réservées aux droits correspondants (403 si demandées sans droit, omises du PDF complet) ; prix d'achat, marge et coûts masqués sans droit sur les coûts. En-tête, logo et couleurs de la station. Chaque export est tracé dans l'audit.
- Les routes prix / achats / stocks sont refactorisées en fonctions réutilisées par l'API et le PDF (comportement inchangé).

## Fichiers
src/catalog.js, src/purchases.js, src/admin.js, src/product_profile.js · public/app.js, public/ext-core.js, public/ext-archive.js, public/ext-product-profile.js, public/ext-product-profile.css, public/sw.js (cache v63) · migrations/077_produits_photo_inactifs.sql · test/product-pdf-photo-archive-unit.js, package.json (`npm run test:product-pdf-photo-archive`)

## Déploiement
`npm run migrate` (sauvegarde préalable si la base contient des données), puis redémarrer le serveur.
