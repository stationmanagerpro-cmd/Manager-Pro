# Vue consolidée, Vue par station, Archivage mensuel

Aucune migration : tout repose sur les tables existantes.

## Où les trouver
- **Tableau de bord → Vue consolidée** (`consolidee`) et **Vue par station** (`parstation`) — API `GET /api/stations/consolidated|by-station?date=AAAA-MM-JJ`
- **Finance & rapports → Archivage mensuel** (`archive`) — API `GET /api/exports/archive/monthly[/summary]?month=AAAA-MM` (soumis au module contractuel « exports »)

## Sources de chaque chiffre
| Affichage | Source |
|---|---|
| CA TTC jour/semaine/mois/année | même définition que le tableau de bord : `sales.total` (produits) + `meter_readings.amount` (quarts clos, par `closed_at`) + carburant déclaré des quarts ouverts. Variations : J-1, S-1 (mêmes jours), M-1 (même jour du mois) ; `n/d` si la période précédente est à zéro |
| CA HT, répartition par station | TVA par ligne (`sale_details.tax_rate`) ; compteurs : `products.tax_rate` |
| Créances clients / Dettes fournisseurs | `customers.balance > 0` / `suppliers.balance_due > 0` |
| Écarts de jaugeage (% ventes) | `shift_stock_counts.gap` (physique − théorique) ÷ `meter_readings.liters`, quarts clos du mois |
| Encaissement espèces | `payments` (mode espèces) |
| Quarts saisis | `shifts` par `shift_date` |
| Cuves | `stock.quantity` − litres vendus du quart ouvert, ÷ `tanks.capacity_liters` (jauge hachurée si capacité absente) |
| Feux stock/finance/opérations | règles et seuils dans `src/station_views_logic.js` (renvoyés par l'API, motif au survol) |

## Archive ZIP (100 % PDF)
Les PDF réutilisent les modules existants : `docs.buildPdf` (identité, couleurs et signature de la station), les jeux de données du hub d'exports (`exports.loadDataset` : dépenses, ventes, quarts, caisse, stock — mêmes colonnes, totaux et droits que `GET /exports/:kind?format=pdf`) et le rendu de facture de `billing.js` (`buildInvoicePdf`, partagé avec `/invoices/:id/pdf`). Seuls les justificatifs de dépenses déjà stockés (images/PDF) sont joints tels quels.

`01_Rapports_des_journees`, `02_Factures_des_achats`, `03_Factures_clients`, `04_Factures_des_depenses`, `05_Rapports_transactions_tiers`, `06_Rapports_divers`, plus `LISEZ-MOI.txt` et `INDEX_ARCHIVE.csv` (tables sources, lignes, SHA-256 par fichier). Un dossier n'est inclus que si les droits **et** le module du contrat le permettent.

## Icônes
Les agrégats reprennent les pastilles du tableau de bord (`dv2-kpi` / `dv2-ico` vert, bleu, violet, ambre) ; les dossiers d'archive ont leur propre icône.

## Droits
Stations = `user_stations` ∩ actives ∩ même client ; plafonds de station et modules du contrat appliqués ; rubrique non autorisée → masquée. Super Admin : refusé.

## Tests
`npm run test:station-views` (unitaires + doublures). Le SQL n'a pas pu être exécuté sur PostgreSQL dans l'environnement de rédaction : à valider sur la base de test (`npm test`).
