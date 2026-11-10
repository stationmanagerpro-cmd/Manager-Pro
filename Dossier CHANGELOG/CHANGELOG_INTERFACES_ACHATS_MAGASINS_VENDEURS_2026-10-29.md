# Interfaces modernes — Achats, Magasins & dépôts, Vendeurs & commissions

**Date :** 2026-10-29

## Nouveautés

### 1. Achats (`/public/ext-achats.js`)
- Nouvelle page **Achats** (clé de navigation `achats`)
- KPIs : Commandes, Montant commandé TTC, À réceptionner, Reçues
- Filtres période (Aujourd'hui → Tout), statut, fournisseur, recherche
- Tableau des commandes : N°, date, fournisseur, dépôt, facture four., montant TTC, reste dû, statut
- Boutons : Nouvelle commande, accès Fournisseurs
- Menu : Gestion commerciale → Achats

### 2. Magasins & dépôts (`/public/ext-magasins.js`)
- Remplace / enrichit la page **Mes stations** (clé `stations`)
- Onglets : Sites | Caisses | Comparaison des performances
- KPIs globaux : CA TTC, Marge brute, Achats, Valeur du stock
- Graphiques barres : CA par site, Stock par site
- Tableau détaillé : ventes, CA, part, marge, taux, achats, stock valorisé, articles
- Actions : Nouveau magasin/dépôt, Transfert de stock, bascule de station

### 3. Vendeurs & commissions (`/public/ext-vendeurs.js`)
- Nouvelle page **Vendeurs & commissions** (clé `vendeurs`)
- KPIs : Ventes nettes HT, Commissions, Primes, Reste à régler
- Classement vendeurs avec objectifs (barre de progression), taux de commission, primes
- Actions : Prime exceptionnelle, Régler, Rapport collectif
- Onglets : Performances & commissions | Vendeurs | Primes & règlements
- Données agrégées depuis employés / utilisateurs et ventes (taux 3 % par défaut)
- Les actions Prime / Régler sont prêtes à être branchées sur un module paie / caisse

## Fichiers modifiés
- `public/index.html` — inclusion des 3 scripts
- `public/ext-shell.js` — menu Gestion commerciale (+ achats, vendeurs)
- `public/app.js` — V, NAV_ICONS, canView pour les nouvelles clés
- `public/design-v2.css` — style `.b2.on` pour les filtres période

## Notes
- Les pages s'appuient sur les API existantes (`/purchases`, `/suppliers`, `/stations/overview`, `/employees`, `/sales`, etc.).
- Le module commissions vendeurs côté serveur n'existe pas encore : l'UI calcule des commissions indicatives et expose les actions pour une future API.
