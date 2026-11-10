# Améliorations post-audit — 28/10/2026

Améliorations **additives** (aucun comportement métier existant retiré ou masqué).

## 1. Configuration & version
- **`.env.example`** : modèle standard (complète `.env.pc.example` orienté Windows).
- **Version package** alignée : `21.0.0` (README mis à jour en v21).
- Référence migrations : `001` → `077`.

## 2. UX quarts passés
- Badge **« passé »** sur la liste des quarts et sur la carte du quart ouvert si `opened_at` < aujourd’hui.
- **Confirmation** à l’ouverture si la date choisie est antérieure (« Ce quart sera comptabilisé sur la période du … »).

## 3. Audit
- Journal d’audit enrichi à l’ouverture : `shift_date`, `opened_at`, flag `backdated`, message distinct si date antérieure.

## 4. Qualité / exploitation
- **`npm run doctor`** (`scripts/doctor.js`) : Node, `.env`, JWT, fichiers critiques, migrations, connexion PG.
- **`GET /api/health`** enrichi : `version`, `uptime_s`, `db.ok`, `migrations_applied`.
- **Test statique** : `npm run test:shift-open-past` (`test/shift-open-past-date-static.js`).
- **Index migrations** : `docs/MIGRATIONS_INDEX.md` (doublons 027/040/059, gaps, règles de sécurité).

## Fichiers touchés / ajoutés
- `.env.example` (nouveau)
- `package.json`, `README.md`
- `public/app.js` (badge + confirmation)
- `src/shifts.js` (audit enrichi)
- `src/server.js` (health)
- `scripts/doctor.js` (nouveau)
- `test/shift-open-past-date-static.js` (nouveau)
- `docs/MIGRATIONS_INDEX.md` (nouveau)
- ce changelog

## 6. Backdating optionnel des ventes / dépenses (quart passé)

Lorsque le **quart ouvert** a une `opened_at` antérieure à aujourd’hui :

| Entité | Champ | Comportement |
|--------|-------|--------------|
| Vente produits | `sold_at` | = `opened_at` du quart |
| Vente carburant | `sold_at` | idem |
| Paiements | `paid_at` | idem |
| Dépense | `spent_on` | = date du quart (`shift_date` / jour de `opened_at`) |

Sinon → défaut SQL (`now()` / `CURRENT_DATE`) inchangé.

### Pourquoi
Les exports et rapports filtrent sur `sold_at` / `spent_on`. Sans alignement, une vente saisie aujourd’hui sur un quart du 15/10 apparaîtrait dans la période du 28/10.

### UI
Toast informatif à l’ouverture du formulaire vente / dépense si le quart courant est antérieur.

### Fichiers
- `src/operations.js` — helper `businessStampFromShift`, INSERT ventes/dépenses/paiements
- `src/fuelsales.js` — INSERT ventes carburant + paiements
- `public/app.js` — `notifyIfPastShift`
- `test/shift-open-past-date-static.js` — 21 contrôles

## 7. Backdating de la clôture de quart

### Backend (`src/shifts.js`)
- `closeSchema` : champ optionnel `closed_at` (ISO).
- Validations : format valide, **pas dans le futur**, **≥ opened_at**.
- `UPDATE shifts SET closed_at = COALESCE($8::timestamptz, now())`.
- Audit enrichi (`backdated`, date dans le libellé si antérieure).
- Rapport de clôture inclut `closed_at`.

### Frontend (`public/app.js` — écran clôture)
- Champs **Date** et **Heure** de clôture.
- Préremplissage : maintenant ; si quart passé → date d’ouverture + 8 h.
- `min` = date d’ouverture, `max` = aujourd’hui.
- Confirmation spécifique si date antérieure.
- Payload `closed_at` envoyé avec le reste de la clôture.

### Tests
`npm run test:shift-open-past` → **27/27**.

## 8. Séparation logo / photo Manager Pro vs comptes clients

### Cause
L’UI client et les PDF retombaient sur le **logo plateforme** (`/api/branding/logo`) lorsque la station n’avait pas de logo propre. Changer le logo Manager Pro faisait donc « changer » l’apparence de tous les comptes clients sans logo.

### Correctifs
| Zone | Avant | Après |
|------|--------|--------|
| Bandeau tenant (`refreshTenantBrand`) | repli → logo Manager Pro | initiale du client/station (ou logo station) |
| Menu latéral client | nom + logo Manager Pro | nom client/station + logo station / initiale |
| `applyBrand()` | écrasait tous les `data-brand` | ignore `data-brand-scope="tenant"` en session client |
| PDF `docs.branding` | `station.logo \|\| app.logo` | logo station uniquement (sinon aucun) |

### Déjà correct (inchangé)
- Photo personnelle : `PUT /me/photo` → `users.photo_path` de l’utilisateur connecté uniquement
- Logo site : `app_settings.app_logo_path`, édition SuperAdmin only
- Logo station : `stations.photo_path` via `/api/images/stations/:id`

### Test
`npm run test:branding-tenant-isolation` → 10/10

## 9. En-tête figé + date/heure à droite (responsive)

### En-tête
- `#app-header` en `position: sticky; top: 0; z-index: 100` — reste visible au scroll (mobile, tablette, PC)
- `main { overflow-x: clip }` pour ne pas casser le sticky

### Date & heure
- Déplacées sur la **même ligne** que le nom du compte client (`tenant-brandbar`)
- Alignées à **droite** (avant le profil utilisateur)
- Couleurs adaptées au bandeau sombre (fond semi-transparent, texte blanc / muted)
- Format adaptatif : long sur grand écran, compact sous 560px
- Toujours visible sur mobile (plus masquée comme l’ancienne `.top-clock`)
