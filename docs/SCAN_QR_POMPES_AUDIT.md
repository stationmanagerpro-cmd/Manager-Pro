# Scan QR des pompes — Rapport d'audit initial et proposition d'intégration

Date : 20/11/2026 · Référence : `CAHIER_DES_CHARGES_SCAN_QR_STATION_MANAGER_PRO.md` §17 phases 1-2 · Base de travail : archive `Station-Manager-PRO_refactor-en-tete_b30b373` (version `package.json` 1.11.31).

> Limite de l'audit : réalisé par lecture du code et du schéma issu des 123 migrations rejouées sur PostgreSQL 16 local. Pas de dépôt `.git` dans l'archive : le commit n'est identifié que par le nom de l'archive (AUD-01 non vérifié par Git). Ni GitHub ni Render n'ont été consultés (réseau coupé).

## 1. Constats d'audit (ce qui existe et qui est réutilisé)

| Sujet | Constat | Fichiers |
|---|---|---|
| Architecture | Node.js/Express, PostgreSQL (`pg`), validation `zod`, helpers `pool/tx/HttpError/wrap/body/need/audit` ; front sans framework (scripts `public/ext-*.js` chargés par `index.html`, vues `V`/`VM`) ; PWA avec `sw.js` généré par `scripts/build-sw.js` | `src/core.js`, `src/server.js`, `public/app.js` |
| Pompes / produits | `pumps` (station, numéro, statut) → `pump_counters` (compteur 1 ou 2, **un produit par compteur**) → `products`. Une pompe peut donc distribuer 2 produits | migrations, `src/pumps*.js` |
| Droits | Permissions par rôle (`role_permissions`) ; garde `need('code')` ; station imposée par `X-Station-Id` vérifié (`req.sid`) | `src/core.js` |
| Quarts | Un seul quart `ouvert` par station ; équipe dans `shift_employees` (avec `pump_id`) et `shift_employee_pumps` ; relevés d'ouverture dans `meter_readings` | `src/shifts*.js` |
| Vente carburant | `POST /sales/fuel` : transaction, verrou consultatif + `client_ref` (idempotence), règle d'affectation `resolveFuelSaleEmployee`, carte flotte (`fleetGuard`), file hors ligne côté client (`ext-offline-sales.js`) | `src/fuelsales.js`, `src/shift_sales_check.js` |
| Formulaire de vente | `addFuel()` (`ext-sale-shift.js`) : champs `#fs_pump`, `#fc`, `#fe` ; `modal()` n'a qu'**un seul emplacement** | `public/ext-sale-shift.js`, `public/app.js` |
| Android | WebView + `AndroidBridge.scan()` (ML Kit, `FORMAT_ALL_FORMATS`) rappelant `window.__mpScanHandler(code)` ; permission `CAMERA` déclarée | `android/.../MainActivity.kt`, `AppBridge.kt` |
| PDF | Aucune bibliothèque PDF installable ici ; PDF existants générés côté serveur/navigateur selon les modules | — |
| Migrations | Dossier `migrations/`, lanceur `src/migrate.js` (table `schema_migrations(name)`), dernière = 123 ; tests de numérotation/sûreté | `migrations/`, `docs/MIGRATIONS_INDEX.md` |

## 2. Décisions de conception (à valider — voir `SCAN_QR_POMPES_LIMITES.md`)

1. **Un QR par compteur (point de distribution)**, pas par pompe : une pompe à 2 produits aurait un produit ambigu (cahier §4.3). Index unique partiel = un seul QR actif par compteur.
2. **Le scan ouvre une « session de scan »** (`qr_scans`) : usage unique, 15 min. La vente ne reçoit que `qr_scan_id` ; pompe, produit, employé, quart viennent de la base.
3. **Contrôles refaits dans la transaction de vente** (scan verrouillé `FOR UPDATE`, QR `FOR SHARE`, quart `FOR SHARE`) : une révocation concurrente attend la fin de la vente.
4. **Règles d'affectation = celles de `/sales/fuel`** (aucune règle nouvelle). Conséquence à arbitrer : si **aucune** affectation de pompe n'existe sur le quart, la règle existante autorise l'équipe ; le scan fait de même.
5. **Employé = compte connecté** (`employees.user_id`). Un compte sans fiche employé (ex. administrateur) ne peut pas vendre par scan : il utilise le formulaire classique.
6. **Fail closed** : pas de scan ni de vente par scan sans réponse du serveur ; une vente par scan n'entre jamais dans la file hors ligne ; `offline_at` + `qr_scan_id` refusé côté serveur.
7. **Journal `qr_events` en ajout seul** (déclencheur) ; seule la référence courte est journalisée, jamais le jeton.
8. **Aucune dépendance ajoutée** : encodeur QR, décodeur QR de repli et écrivain PDF sont écrits en JavaScript pur, validés par OpenCV/poppler/qpdf (choix imposé par l'absence de réseau ; remplaçable par une bibliothèque standard si vous le préférez).

## 3. Proposition d'intégration (tables, routes, impacts)

**Tables ajoutées** (migration `124_qr_codes_scan_pompes.sql`, additive, rejouable, aucune table existante modifiée) : `qr_codes`, `qr_scans`, `qr_events`, permission `qr.manage` (ADMIN, GERANT). **Colonne ajoutée à `sales` : aucune.**

**Routes** (aucune en doublon ; préfixe `/api`) : `GET /qr-codes`, `POST /pumps/:pumpId/qr-code`, `POST /qr-codes/bulk`, `PATCH /qr-codes/:id/revoke`, `POST /qr-codes/:id/regenerate`, `GET /qr-codes/sheet.pdf`, `GET /qr-codes/:id/label.pdf`, `GET /qr-codes/history`, `POST /sales/scan-pump`. Route de vente **réutilisée** : `POST /sales/fuel` + champ optionnel `qr_scan_id`.

**Fichiers modifiés** : `src/fuelsales.js`, `src/server.js`, `public/index.html`, `public/ext-shell.js`, `public/app.js` (1 condition de module), `public/ext-offline-sales.js`, `public/sw.js` (régénéré), `package.json` (scripts de test), `docs/MIGRATIONS_INDEX.md`.

**Risques identifiés** : (a) `modal()` à emplacement unique → le scanner a sa propre surcouche ; (b) tests d'intégration existants qui figent la structure de `fuelsales.js`, du menu et de l'audit des liens → code adapté pour les respecter ; (c) caméra WebView Android non testable ici.
