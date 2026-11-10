# Ouverture de quart avec date passée — 28/10/2026

## Demande
Lors de l'ouverture d'un quart, permettre de saisir une **date (et heure)** afin d'enregistrer des quarts antérieurs. Cette date doit être prise en compte dans tous les agrégats et fonctionnalités existantes.

## Modifications

### Backend (`src/shifts.js`)
- Schéma d'ouverture enrichi : champs optionnels `shift_date` (YYYY-MM-DD) et `opened_at` (ISO datetime).
- Validation : date/heure invalide → 400 ; **futur interdit**.
- Si fournis, `shift_date` et `opened_at` sont enregistrés à la place de `CURRENT_DATE` / `now()`.
- Sinon comportement inchangé (date du jour, heure courante).

### Frontend (`public/app.js` — `openQ`)
- Deux champs dans la modale d'ouverture :
  - **Date d'ouverture** (`type=date`, max = aujourd'hui)
  - **Heure d'ouverture** (`type=time`)
- Valeurs par défaut = maintenant.
- Envoi de `shift_date` + `opened_at` (ISO) au POST `/shifts/open`.
- Contrôle côté UI : futur refusé.

## Prise en compte dans les agrégats existants
Les rapports, exports, finance, RH, tableaux de bord, etc. filtrent déjà les quarts via :

```sql
opened_at >= $from::date AND opened_at < $to::date + 1
```

(ou équivalent). En posant correctement `opened_at` / `shift_date` à l'ouverture, **aucun autre changement n'est nécessaire** : un quart saisi a posteriori apparaît dans la bonne période dès qu'il est clôturé.

Les ventes / dépenses / mouvements créés *pendant* le quart restent horodatés à l'instant de saisie (`created_at = now()`), mais sont rattachés au quart via `shift_id`. Les synthèses « par quart » et « par période de quarts » restent cohérentes.

## Points d'attention
- Un seul quart **ouvert** par station (contrainte existante) : clôturer le quart courant avant d'ouvrir un quart passé.
- Un quart passé laissé ouvert déclenchera l'alerte « ouvert > 24 h » (comportement voulu).
- La clôture continue d'utiliser `closed_at = now()` (pas de backdating de la clôture dans cette itération).

## Fichiers modifiés
- `src/shifts.js`
- `public/app.js`
