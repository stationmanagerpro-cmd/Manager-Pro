# Commissions vendeurs — branchement réel (objectifs + taux)

**Date :** 2026-10-29

## Règle métier
Les commissions sont un avantage accordé par l’administration en contrepartie d’un **objectif de performance** des employés (pompistes) mesuré sur leurs **ventes validées** (`sales.employee_id`, `status = 'valide'`).

- **Objectif** : somme HT à atteindre (indicateur de performance, barre de progression).
- **Taux** : % du CA HT → commission = CA HT × taux / 100.
- Objectif et taux sont **paramétrables** :
  - par défaut au niveau station (`settings.seller_commission_defaults`) ;
  - **personnalisables par employé** (`employees.sales_target`, `employees.commission_rate`).

## Dépendances créées

| Couche | Fichier | Rôle |
|--------|---------|------|
| BDD | `migrations/080_seller_commissions.sql` | Colonnes `sales_target`, `commission_rate` sur `employees` + table `seller_commission_entries` (primes, règlements) |
| API | `src/seller_commissions.js` | Routes REST branchées sur ventes + employés + settings |
| Serveur | `src/server.js` | Montage `app.use('/api', require('./seller_commissions'))` |
| UI | `public/ext-vendeurs.js` | Interface complète : ranking, paramétrage, primes, règlements |

## API

- `GET  /seller-commissions/summary?period=month` — agrégat ventes + commissions
- `GET  /seller-commissions/config` — défauts station
- `PUT  /seller-commissions/config` — fixer objectif & taux par défaut
- `PUT  /seller-commissions/employees/:id` — objectif & taux personnalisés
- `POST /seller-commissions/primes` — prime exceptionnelle
- `POST /seller-commissions/reglements` — règlement (marque aussi les primes « du »)
- `GET  /seller-commissions/entries` — historique
- `POST /seller-commissions/entries/:id/cancel` — annulation

## Interface (onglet Paramétrage)
- Formulaire défauts station (objectif + taux)
- Tableau par vendeur avec badge « perso » vs « défaut »
- Bouton ⚙ sur chaque ligne pour personnaliser objectif / taux
- Actions Prime et Régler connectées à l’API

## Prérequis déploiement
Exécuter les migrations (`node src/migrate.js` ou process habituel) pour appliquer `080_seller_commissions.sql`.
