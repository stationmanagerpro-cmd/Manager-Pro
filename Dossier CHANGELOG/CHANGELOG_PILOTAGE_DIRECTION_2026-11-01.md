# Pilotage direction : même design que le tableau de bord, statistiques par station (2026-11-01)
- Nouvelle page `public/ext-direction.js` (remplace l'ancienne vue de ext-modern-pack, qui reste intacte) avec les cartes et diagrammes du tableau de bord (dv2-*, Chart.js).
- Filtres : station (toutes ou une seule) et période (aujourd'hui, hier, semaine, mois, trimestre, année).
- Indicateurs : chiffre d'affaires, dépenses, résultat, volume vendu (avec variation vs période précédente), ventes du jour, quarts ouverts, stock bas, employés, solde des caisses, créances clients, dettes fournisseurs.
- Diagrammes : ventes journalières empilées par station ; CA / dépenses / résultat par station ; classement des stations.
- Classements : meilleurs employés, meilleurs clients, fournisseurs (achats), produits les plus vendus, dépenses par poste.
- Bloc « Statistiques de chaque station » : CA, dépenses, résultat, carburant, produits, litres + top 3 employés / clients / fournisseurs.
- Aucun faux zéro : une station dont les données sont indisponibles est signalée et exclue des totaux.
- Serveur : nouvelle route `GET /dashboard/rankings?from&to&limit` (src/reports.js), limitée à la station de l'en-tête X-Station-Id. Les achats fournisseurs exigent finance.view ou debt.view.
- Cache : service worker v86, ext-polish.css v2.
