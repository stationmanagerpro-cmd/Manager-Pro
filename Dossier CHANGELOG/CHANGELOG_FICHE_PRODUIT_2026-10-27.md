# Fiche produit complète (2026-10-27)

Cliquer sur un produit (liste « Produits et stock » ou recherche globale) ouvre désormais une fiche complète, construite comme les fiches client / fournisseur / employé : identité en haut, puis onglets horizontaux auto-adaptés (une ligne, partage de la largeur, défilement horizontal sur petit écran).

## Interface (public/ext-product-profile.js, public/ext-product-profile.css)
- **Carte d'identité** : nom, catégorie, statut, stock bas, code-barres, SKU, unité, prix de vente / d'achat, marge unitaire, taxe, stock, seuil, fournisseur principal ; boutons « Modifier le produit », « Mouvement de stock », « ← Retour à la liste ».
- **Vue d'ensemble** : quantité vendue, CA (part du CA et rang), marge brute, stock et couverture ; moyenne/jour, dernière vente, valeur du stock, pertes, commandes en cours ; graphiques ventes (CA + quantité), entrées/sorties, mouvements par type, meilleurs clients, approvisionnement par fournisseur. Sélecteur 30 j · 3 mois · 12 mois · Tout.
- **Comportement** : « lecture rapide » (rang, meilleure période, jour fort, tendance, prix réellement encaissé, couverture / rupture probable, produit dormant, pertes, vente à perte) ; marge brute et marge % par mois ; prix encaissé vs coût moyen ; ventes par jour de la semaine ; ventes par employé.
- **Gestion des prix** : prix actuels et marge, alerte « vente à perte », formulaire de modification (prix de vente et prix d'achat, note, ajustements rapides −10/−5/+5/+10 %, aperçu de la marge avant validation), graphique d'évolution et **historique complet** (date, type, ancien → nouveau prix, variation, durée de validité, auteur, note).
- **Historique dotation** : tous les achats du produit (commande, fournisseur, quantités, coût, statut), coût moyen / min / max, courbe du coût unitaire ; bouton **« Commande en cours »** (avec compteur) : commandes émises non entièrement livrées, reste à livrer, attente en jours, lien « Ouvrir / recevoir ». Une commande disparaît de cette liste dès qu'elle est entièrement reçue ou annulée.
- **Historique des stocks** : entrées, sorties, ventes, achats (réceptions), retours, pertes, casse, corrections + / −, transferts, avec quantité signée, stock après mouvement, référence (bon de commande / vente), auteur, commentaire ; filtres type / dates ; bouton « + Mouvement ».
- Onglets Dotation et Stocks masqués sans les droits correspondants ; les coûts et marges sont masqués sans droit (`price.edit`, `report.view`, `finance.view`, `purchase.manage`, `purchase.pay`).

## API (src/product_profile.js, lecture isolée par station)
- `GET /products/:id/profile?period=30d|3m|12m|all` · `GET /products/:id/prices` · `POST /products/:id/prices` (droit `price.edit`) · `GET /products/:id/purchases` · `GET /products/:id/stock-history?kind=&from=&to=&limit=`.
- Tout changement de prix est maintenant historisé : fiche de modification (PATCH /products/:id), création du produit, nouvelle fiche prix et **réception d'achat** (le dernier coût d'achat met à jour le prix d'achat) passent par `recordPriceChange`.

## Base de données
- `migrations/076_historique_prix_produits.sql` : `price_history` reçoit `price_type` (vente/achat) et `old_price` ; reprise des changements de prix déjà présents dans le journal d'audit ; une ligne de départ par produit (prix actuel) ; chaînage des périodes de validité. Aucune suppression.

## Divers
- Recherche globale (serveur et palette Ctrl+K) : un produit ouvre sa fiche. Cache du service worker `smp-static-v61`.
- Tests : `npm run test:product-profile` (API avec faux pool + interface sans navigateur ; le SQL n'est pas exécuté par PostgreSQL dans ces tests).
- Déploiement : lancer `npm run migrate` (sauvegarde préalable exigée par le lanceur si la base contient des données).
