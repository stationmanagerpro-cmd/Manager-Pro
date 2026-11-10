# Modernisation — Phase D (13 oct. 2026)

## Exports comptables
- Format **CSV** (séparateur `;`, BOM UTF-8 Excel FR) sur tous les kinds existants
- Nouveaux kinds : `payments` (paiements), `eod_lines` (lignes fin de journée)
- Formats : `csv` | `xlsx` | `pdf` | `json`

## PDF fin de journée (serveur)
- `GET /api/reports/eod.pdf?date=YYYY-MM-DD`
- Indicateurs, quarts du jour, stock bas, signatures Gérant / Contrôle
- Carburant via `meter_readings` des quarts fermés

## UI (vue Fin de journée)
- PDF serveur, Ventes CSV, Dépenses CSV, Paiements CSV, Journal XLSX
