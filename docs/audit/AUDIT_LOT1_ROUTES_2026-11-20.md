# Audit technique — Lot 1 : routes, appels front, permissions (2026-11-20)

Mission : audit en lecture seule (aucune modification de code, de migration, de donnée ni de route).
Référence : commit `7b3232b` sur `main` au début du lot.

## 1. Périmètre et statut

| Partie | Statut | Détail |
|---|---|---|
| Inventaire des fichiers | Fait | 116 fichiers `src/`, 103 scripts `public/`, 122 migrations, 239 fichiers `test/`, 189 scripts npm |
| Routes API (779 déclarations) | Fait en statique | 776 dans les routeurs, 3 directes dans `server.js` (`/health`, `/c/:token`, `/superadmin`) |
| Appels front → routes | Fait en statique | 975 appels littéraux, 2 appels dynamiques non résolus |
| Permissions des routes | Fait en partie | Voir §4 : 699 routes avec garde nommée visible, 77 relues par nature, ~25 gestionnaires lus un par un |
| Migrations | Non réinspecté dans ce lot | Vérification précédente : les 122 s'appliquent sur PostgreSQL 16 (base vide), seule `001_initial.sql` n'est pas idempotente |
| Fonctionnalités (chaîne complète UI → SQL) | Non inspecté | Lots suivants |
| Communications entre modules, tâches automatiques | Non inspecté | Lots suivants |
| Tests de bout en bout | Non exécutés | Voir §6 |

## 2. Méthode

- Extraction statique des déclarations (`r/router/admin/pub/priv.get|post|put|patch|delete`) et de leurs montages réels dans `src/server.js`. Cas particulier traité : `auth.js` (`pub` sous `/api/auth`, `priv` sous `/api`) et les exports multiples (`branding`, `access_keys`, `home_page`) montés par export.
- Extraction des appels front (`G`, `Po`, `Pu`, `api('M', …)`, `fetch` avec `method` lu dans les options) et rapprochement méthode + chemin, avec gestion des chemins concaténés.
- Vérification de la garde de chaque route : garde nommée sur la ligne, dans le gestionnaire, ou via un helper défini dans le fichier.
- Chaque anomalie candidate a été relue dans le code source avant d'être retenue.
- **Limite majeure** : le serveur ne peut pas être démarré dans la session (`node_modules` absent ; `npm ci --offline` échoue faute de cache complet ; registre npm inaccessible). Aucune route n'a donc été exécutée. Tout le résultat est une lecture de code.

## 3. Routes et appels front

- Montage : 779 routes déclarées, toutes montées ou directes ; aucune route déclarée non montée.
- Chaîne globale (`server.js`) : routes publiques `pub` avant la ligne 107 ; ensuite `auth` (jeton obligatoire, l.107), `priv`, `station` (en-tête `X-Station-Id` et accès à la station, l.116) s'appliquent à tout `/api` suivant.
- Appels front (975 littéraux) :
  - 633 correspondent exactement à une route de même méthode ;
  - 337 utilisent un préfixe dynamique couvert par une route (vérifié par motif) ;
  - 4 `/images/banner/…` et `/images/stations/…` : couverts par `/images/:entity/:id` (GET, PUT, DELETE, `admin.js`) — vérifié à la main ;
  - 1 `/hr/reports/${kind}` : les 4 valeurs utilisées (`payroll`, `employer-cost`, `social-fiscal`, `employees`) existent en GET — vérifié à la main ;
  - 0 mauvaise méthode après correction du lecteur de `fetch`.
- Deux appels dont le chemin est passé par l'appelant, **non résolus** : `ext-direction.js:36` (`G(path)`) et `ext-multistation-views.js:131`.

Routes sans référence front (test textuel sur tout le front) :

| Route | Fichier | Remarque |
|---|---|---|
| `GET /public/access/status` (et alias `/access/status`) | access_keys.js:111 | Aucune référence front |
| `GET /admin/licenses/duration-presets` | contracts.js:1410 | Aucune référence front |
| `GET` / `PUT /exports/:kind/preferences` | exports.js:42, 47 | Aucune référence front |
| `GET /money/accounts/:id/movements` | finance.js:164 | Aucune référence front |
| `GET /me/advertising/images/:index` | branding.js:303 | Aucune référence front |
| `PUT /pumps/:pumpId/counters/:n` | catalog.js:237 | Le front n'appelle que `PATCH …/counters/:n/index` (catalog.js:253) |
| `GET /mobile/alerts` | mobile_alerts.js:9 | Probablement l'application Android : à confirmer |
| `GET /c/:token` | server.js:106 | Page HTML lue par `espace-client.js` : à rattacher |

Routes avec une référence textuelle mais sans appel exact détecté (28) : à confirmer, liste dans `docs/audit/inventaire_routes_lot1.csv`.

## 4. Permissions et isolation

- 699 routes ont une garde nommée visible (`need`, `any`, `needPrincipal`, `needGlobal`, `requireSuper`, `requireFiscalAccess`, helpers `requireView` / `requireManage`, `canEdit`, `view`, `principal`…).
- 77 routes n'ont pas de garde nommée visible. Classement :
  - **Publiques par conception** : `/public/access/*` (limiteurs), `/public/portal/:token` (jeton + limiteur), `/public/home`, `/branding/` (logo, favicon, login-bg, manifest) — écran de connexion.
  - **Limitées à l'utilisateur connecté** (identifiant issu de la session, pas de paramètre) : `/me*`, `/me/preferences/*`, `/me/photo`, `/auth/logout`, `/me/license/history`, `/me/subscription-payment-info`, `/me/profile/activity*`, `/hr/me`, `/hr/me/payslips`, `/dashboard/my-prefs`, `/notifications*`, `/push/*`, `/usage/ping`.
  - **Contrôle interne confirmé dans le gestionnaire (lu)** : `PUT /settings/:key` et `POST /settings/reset/:key` (admin.js:172, 198), `PUT /station-banner` (admin.js:264), `GET`/`PUT /admin/stations/:id/permission-caps` (`is_global`, admin.js:487), `PUT`/`POST`/`DELETE /admin/branding*` (`canEdit` : `appearance.manage` + `is_global`, branding.js:101), `PUT`/`DELETE /admin/clients/:id/dashboard-config` (`is_global`, reports.js:452, 469), `GET /messaging/support/clients` (`is_global`), `GET /usage/team` (rôle ADMIN + client), `POST /docs/render*` (droits), `GET /hr/debts/:id/attachment` (droits ou propriétaire), `POST /hr/actions/:id/review` et `/reject` (droits ou employé concerné), `GET /hr/employees/:id/actions` et `customer-debts` (propriétaire ou droits), `GET /hr/payroll` (non gestionnaire : ses seuls bulletins, hr.js:1531–1538), `GET /me/subscription-payment-info` (`is_global` refusé), **toutes les routes `seller-commissions`** (`requireView` / `requireManage`).
  - **Non relues une à une** : le reste des 77 (classé par nature).

### Anomalies de permission retenues

| ID | Gravité | Constat | Fichier | Statut |
|---|---|---|---|---|
| P-01 | Élevée (à confirmer en exécution) | `GET /api/sales` renvoie les ventes de la station (1 000 lignes max ou plage de dates : totaux, client, vendeur, n° de facture) sans aucun contrôle de permission. Le code ne définit aucune permission de lecture des ventes (seules `sale.create`, `sale.credit`, `sale.delete` existent). Tout utilisateur ayant accès à la station peut lire ces données par l'API, même si l'écran Ventes est masqué dans l'interface. | operations.js:223–240 | Confirmé par lecture de code, non exécuté |
| P-02 | Moyenne (à valider métier) | `GET /products`, `GET /categories`, `GET /pumps`, `GET /pumps/history` : lecture du catalogue sans permission. Probablement voulu (écran de vente), à confirmer. | catalog.js:17, 55, 149, 228 | À valider |
| P-03 | Faible à vérifier | `GET /messaging/status` et `GET /messaging/users` sans garde visible (la messagerie est peut-être ouverte à tous les utilisateurs de la station ; la photo `/messaging/users/:id/photo` doit rester limitée à la station). | messaging.js:147, 206, 235 | À vérifier |
| P-04 | Faible | Routes `GET /alerts/center`, `POST /alerts/center/:source/:id/ack`, `GET /packs`, `GET /shifts/current`, `GET /shifts/` : pas de garde nommée visible ; à relire. | ops_plus.js, premium.js, shifts.js | À relire |

Vérification de l'isolation entre clients : non réalisée dans ce lot (nécessite une exécution avec deux comptes de clients distincts).

## 5. Anomalies de connexion (front ↔ back)

Aucun appel front ne pointe vers une route absente. Anomalies à confirmer :

| ID | Constat | Fichier | Gravité |
|---|---|---|---|
| C-01 | Route `PUT /pumps/:pumpId/counters/:n` (règle carburant serveur) jamais appelée : le front utilise `PATCH …/index`. Si la route `PUT` est encore utilisée par d'autres clients, elle reste à conserver. | catalog.js:237 | Moyenne |
| C-02 | Routes sans appel front (liste §3). Candidates à la suppression ou à l'intégration : certaines sont probablement pour l'application Android. | voir §3 | Faible |
| C-03 | Deux appels à chemin construit par l'appelant, non résolus. | ext-direction.js:36, ext-multistation-views.js:131 | Faible |

## 6. Tests

- Tests exécutés pendant ce lot : analyses statiques (scripts de parsing de routes et d'appels, relectures de code). **Aucun test d'exécution.**
- Non exécutables ici : serveur (dépendances absentes), `npm test`, tests de bout en bout, tests par profil et isolation entre clients.
- Tests statiques du dépôt : non relancés dans ce lot (déjà verts à la dernière livraison, voir `docs/ETAT_ACTUEL.md`).

## 7. Plan des lots suivants (en attente de validation)

1. **Lot 2 — Permissions détaillées** : relire les 77 routes restantes et les handlers ci-dessus (P-02 à P-04).
2. **Lot 3 — Chaîne fonctionnelle par module** (ventes, stock, achats, RH, comptabilité, fiscal, clients, plateforme) : UI → fonction JS → route → SQL.
3. **Lot 4 — Migrations** : inventaire des 122 fichiers, dépendances, colonnes utilisées par le code, contrôle des modèles (aucune migration modifiée).
4. **Lot 5 — Exécution** : seulement si les dépendances peuvent être installées (sinon hors périmètre). Tests d'isolation et de permissions avec deux clients et plusieurs profils.
5. **Lot 6 — Rapport final** : matrice des fonctionnalités, plan de correction classé par gravité, aucune correction avant validation.

Aucune correction n'a été appliquée. Chaque correction proposée attendra votre approbation.

## 8. Fichiers joints

- `docs/audit/inventaire_routes_lot1.csv` : 776 routes (méthode, chemin, fichier:ligne, garde nommée, utilisation front).
- `docs/audit/front_appels_lot1.csv` : 975 appels front et leur statut de rapprochement.
