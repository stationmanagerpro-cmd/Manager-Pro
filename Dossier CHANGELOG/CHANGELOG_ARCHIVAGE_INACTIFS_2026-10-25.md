# Archivage des clients, fournisseurs et employés inactifs (2026-10-25)

- Migration `072_archive_inactifs.sql` : colonnes `active` / `deactivated_at` sur `customers` et `suppliers`.
- API : `PATCH /customers/:id/status` et `PATCH /suppliers/:id/status` ({ active, reason? }) ; employés via `PATCH /employees/:id/status` (existant).
- Listes : `/customers` et `/suppliers` ne renvoient que les actifs (`?inactive=1` pour les inactifs) ; `/employees` renvoie les non-inactifs (`?status=inactif` ou `?status=all`).
- Interface : bouton « Clients / Fournisseurs / Employés inactifs » dans chaque liste, boutons Archiver / Réactiver par ligne (`public/ext-archive.js`).
- Les formulaires (ventes, achats, quarts, factures) ne proposent plus les inactifs ; la vente à crédit à un client inactif est refusée.
- Aucune donnée supprimée : historique, soldes et fiches restent consultables.
- Achats : `POST /purchases` refuse (409) un bon de commande pour un fournisseur inactif. Les commandes déjà passées restent réceptionnables et payables. Test : `npm run test:purchase-inactive-supplier`.
