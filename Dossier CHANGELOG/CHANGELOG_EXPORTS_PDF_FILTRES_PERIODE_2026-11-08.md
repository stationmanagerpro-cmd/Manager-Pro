# CHANGELOG — Exports PDF et filtres par période (2026-11-08)

## Fichiers modifiés
| Fichier | Nature |
|---|---|
| `public/ext-report-tools.js` (nouveau) | Barre de filtre commune (Date de début / Date de fin / Filtrer / Réinitialiser / Exporter en PDF), validation des dates, aide `RT.pdf` |
| `src/docs.js` | Ligne « Période » dans l'en-tête ; sections `options` (cases à cocher vectorielles) et `image` |
| `src/docs_render.js` | Schéma : `period`, sections `options` et `image` (PNG/JPEG data-URL ≤ 1,5 Mo) |
| `src/fleet.js` | `/fleet/cards` : `from`, `to`, `active_only` → `period` par carte (prises valides, litres, montant, refus) |
| `src/finance.js` | `/finance/events` : `period_totals` (toute la période), limite jusqu'à 5000, garde début ≤ fin ; `/money/commission-report` : garde début ≤ fin |
| `src/ops_plus.js` | `/reports/reconciliation` : période + `operations` (statuts) ; nouveau `/reports/eod-period` |
| `public/ext-fleet.js` | Cartes flotte : filtre, colonnes/totaux de période, PDF |
| `public/ext-finance-p4.js` | Journal financier : filtre, totaux exacts, PDF |
| `public/ext-modern-pack.js` | Fin de journée, Rapprochement, Commissions Mobile Money : filtre + PDF |
| `public/ext-magasins.js` | Mes stations : PDF via le moteur commun, cases cochées |
| `public/ext-map.js` | Carte des stations : PDF avec capture de la carte et repères numérotés (comptes station) |
| `public/ext-skin-pro.css` | Bouton de période actif lisible (texte blanc) |
| `public/index.html`, `public/sw.js` | Nouveau script, versions de cache |
| `test/fleet-ui-static.js` | Motif `ext-fleet.js?v=N` accepté |
| `test/pdf-engine-stub.js`, `test/report-ui-harness.js` (nouveaux) | Tests ajoutés (`npm run test:pdf-engine`, `npm run test:report-ui`) |

## Règles de dates
Début ≤ fin ; jours de début et de fin inclus (comparaison par jour entier, même expression que les requêtes existantes de chaque écran ; Cartes flotte : fuseau `FLEET_TZ`).

## Points de vigilance
- Journal financier : l'ancien total ne couvrait que les 100 lignes affichées ; `period_totals` couvre toute la période (`totals` est inchangé).
- Rapprochement : un quart est « rapproché » (fermé, compté, écart nul), « avec écart » ou « non rapproché » (ouvert ou non compté). Mode un jour inchangé ; mode période strict.
- Carte des stations : pas de bouton pour le Super Admin (garde-fou serveur sur les routes métier). Ville/quartier absents en base : l'adresse est reprise.
- Aucun calcul financier existant modifié.
