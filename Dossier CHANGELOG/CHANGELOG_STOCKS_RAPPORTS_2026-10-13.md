# Gestion des stocks + Rapports (13 oct. 2026)

## Gestion des stocks (menu « Gestion des stocks »)
- Tableau de bord : nb produits, alertes bas, valeur achat/vente
- Inventaire complet filtrable
- Liste stock sous seuil
- Derniers mouvements
- Raccourcis : produits, mouvement, achats, exports, scanner alertes

## Centre de rapports (menu « Rapports »)
- Hub vers : direction, fin de journée, rapprochement, dashboard, jour J, stocks, exports, MM, factures, audit
- Exports rapides CSV/XLSX/PDF du jour

## Technique
- `public/ext-stock-reports.js`
- S’appuie sur APIs existantes `/stock/overview`, `/products`, `/exports/...`
- Permissions contrat modules.stock / can_view_reports
