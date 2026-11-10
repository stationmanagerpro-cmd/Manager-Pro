# Tableau de bord — filtre « entre 2 dates » (2026-11-08)

**Problème** : le Tableau de bord moderne n'offrait qu'un menu fixe (Aujourd'hui, Hier, Semaine, Mois, Trimestre, Année), sans choix de dates libres.

**Correction**
- Nouveau sélecteur `public/ext-dash-range.js` : bouton « jj-mm-aaaa - jj-mm-aaaa » → panneau avec Défaut, Aujourd'hui, Hier, Les 7 / 30 derniers jours, Ce mois-ci, Le mois dernier, Cette semaine, Ce trimestre, Cette année, **Gamme personnalisée** (Du / Au) et Appliquer / Annuler.
- Contrôles : deux dates valides, début ≤ fin, pas de date future, 366 jours maximum (limite du serveur).
- `range()` (app.js) : nouveaux codes `d7`, `d30`, `lastmonth` ; `custom` utilise les dates choisies (CA/CB).

**Liaison aux sources (tous les blocs suivent la période)**
- KPI + indicateurs financiers : `/dashboard?from&to` ; comparaison « vs période préc. » sur la période précédente de même durée.
- Transactions : `/dashboard/overview?from&to&pfrom&pto`.
- Indicateurs détaillés (agrégats) : `/aggregates?from&to`.
- Graphique : `/dashboard/daily?from&to` (nouveau côté serveur : 7 à 90 jours, jamais après aujourd'hui).
- Dernières ventes : désormais limitées à la période (`/dashboard/overview`).
- Soldes de caisses, créances, dettes, cuves, quarts ouverts, alertes : état courant (non filtrés par nature).

**Fichiers** : public/ext-dash-range.js (nouveau), ext-design.js, app.js, index.html, sw.js (cache v104), src/reports.js, test/dashboard-period-filter-static.js, package.json.

## Complément — Pilotage direction et Vue par station (2026-11-08)

Le même sélecteur (`DashRange.html(opts)`, désormais paramétrable par écran) remplace les anciens choix de période.

**Pilotage direction** (période propre à l'écran, indépendante du Tableau de bord)
- Toutes les stations choisies : `/dashboard?from&to`, période précédente de même durée, `/dashboard/rankings?from&to`, graphique `/dashboard/daily?from&to` (7 à 90 jours jusqu'à la date de fin).

**Vue par station** (période propre à l'écran ; un seul jour = comportement historique)
- Nouveau côté serveur : `GET /stations/by-station?from=&to=` → CA TTC et encaissement espèces cumulés sur la période, comparés à la période précédente de même durée ; nombre de quarts saisis sur la période (`shifts.shift_date`) ; plafond 366 jours, dates invalides refusées (400).
- Les puces d'agrégats de chaque station (`/aggregates`) suivent la même période.
- Inchangés par nature (état courant) : solde clients, niveaux de cuves.

**Fichiers** : public/ext-dash-range.js, ext-direction.js, ext-multistation-views.js, index.html (ext-direction v2, ext-multistation-views v4), sw.js (cache v105), src/multistation_views.js, test/multistation-routes-mock.js, test/dashboard-period-filter-static.js.

## Complément — Dernières ventes avec « Aujourd'hui »
Quand la période du jour est sélectionnée (défaut), « Dernières ventes » affiche à nouveau les dernières ventes tous jours confondus (`/dashboard/overview?recent=all`). Pour toute autre période, la liste reste limitée aux dates choisies.
