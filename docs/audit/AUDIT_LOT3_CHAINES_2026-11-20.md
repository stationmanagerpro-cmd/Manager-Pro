# Audit technique — Lot 3 : chaînes fonctionnelles et cohérence SQL (2026-11-20)

Suite des lots 1 et 2. Lecture seule : aucun code, migration, donnée ni route modifiés.
Limite inchangée : serveur non démarrable dans la session ; aucune chaîne n'a été exécutée de bout en bout.

## 1. Contrôles automatiques réalisés

| Contrôle | Résultat |
|---|---|
| Tables référencées dans les requêtes SQL du serveur (FROM, JOIN, INTO, UPDATE, DELETE) | 220 noms relevés ; toutes les tables réelles existent dans les migrations (173 tables). Les autres noms sont des faux positifs (alias de sous-requêtes, CTE, fonctions `EXTRACT(… FROM …)`, mots de texte). |
| Colonnes écrites (`INSERT INTO t (colonnes)` et `UPDATE t SET colonne = …`) | **0 écart** sur 173 tables lues. Toutes les colonnes écrites existent dans le schéma issu des migrations (y compris les `ADD COLUMN` multi-lignes). |
| Colonne dynamique dans une écriture (`signature.js:79`) | Nom choisi parmi deux valeurs fixes (`image_path`, `handwritten_path`) : pas d'injection. |
| Correspondance routes ↔ appels front (lot 1) | Aucune route absente ; 2 appels à chemin construit par l'appelant non résolus. |
| Routes par module (tableau §2) | Toutes les routes d'un module ont au moins une référence front, sauf celles listées au lot 1. |

Non couvert par ces contrôles : les colonnes **lues** (`SELECT`), les `INSERT` sans liste de colonnes, les requêtes construites par concaténation, et tous les calculs (paie, TVA, comptabilité, fiscal).

## 2. Cartographie par module (routes, usage, appels)

Source : `docs/audit/inventaire_routes_lot1.csv` et `docs/audit/front_appels_lot1.csv`. « Utilisées » inclut les références textuelles dans le front : c'est une borne haute.

| Module | Routes | Utilisées | Non utilisées | Appels front |
|---|---:|---:|---:|---:|
| hr | 151 | 151 | 0 | 128 |
| admin | 143 | 142 | 1 | 175 |
| fiscal | 66 | 66 | 0 | 58 |
| messaging | 38 | 38 | 0 | 47 |
| me | 26 | 25 | 1 | 39 |
| accounting | 22 | 22 | 0 | 34 |
| money | 21 | 20 | 1 | 31 |
| finance | 16 | 16 | 0 | 13 |
| customers | 14 | 14 | 0 | 27 |
| shifts | 14 | 14 | 0 | 26 |
| products | 12 | 12 | 0 | 31 |
| suppliers | 11 | 11 | 0 | 16 |
| seller-commissions | 11 | 11 | 0 | 13 |
| purchase-orders | 10 | 10 | 0 | 16 |
| employees | 9 | 9 | 0 | 22 |
| stock | 9 | 9 | 0 | 12 |
| dashboard | 9 | 9 | 0 | 20 |
| sales | 6 | 6 | 0 | 12 |
| exports | 6 | 4 | 2 | 4 |
| pumps | 8 | 7 | 1 | 14 |
| public | 6 | 5 | 1 | 4 |
| mobile | 1 | 0 | 1 | 0 |
| c | 1 | 0 | 1 | 0 |

Les autres modules (moins de 10 routes chacun) sont dans le même état : toutes leurs routes ont une référence front, sauf les exceptions du lot 1.

## 3. Chaîne vérifiée de bout en bout par lecture : vente

| Maillon | Élément | Vérifié |
|---|---|---|
| Interface | `app.js:765`, `ext-core.js:349`, `ext-detail-pages.js:169` : `Po('/sales', {items, payments, customer_id, employee_id})` | Oui |
| Route | `POST /api/sales`, `need('sale.create')`, validation `saleSchema`, verrou `assertNotLocked` | Oui |
| Transaction | `tx(...)`, clé de déduplication `client_ref` (retries) | Oui (lecture) |
| Écritures | `INSERT INTO sales`, `stockMove` (mouvement de stock → trigger `apply_stock_movement` qui met à jour `stock` par upsert), `cashMove` (caisse), `UPDATE customers SET balance` (crédit client) | Oui (lecture + colonnes vérifiées) |
| Refus | Stock insuffisant → 409 (dans la transaction, donc annulé) | Oui (lecture) |
| Réponse et actualisation | Non vérifié | Non |

Conclusion : la chaîne est cohérente par lecture. L'exécution (montants, arrondis, cas de crédit, double envoi) n'est pas vérifiée.

## 4. Anomalies et points à confirmer (cumul des lots 1 à 3)

| ID | Gravité | Constat | Source | Statut |
|---|---|---|---|---|
| P-01 | Élevée | `GET /api/sales` sans contrôle de permission (ventes de toute la station) | operations.js:223 | Confirmé par lecture |
| P-04 | Moyenne | Centre d'alertes sans filtre de permission (alertes RH, paie, dettes) | ops_plus.js:365 | Confirmé par lecture |
| P-05 | Moyenne | Acquittement d'alertes RH sans permission RH | ops_plus.js:536 | Confirmé par lecture |
| P-06 / P-07 | Faible | Notifications de station visibles à tous les profils (écarts de caisse, licences) | reports.js:595, 604 | À valider métier |
| C-01 | Moyenne | Route `PUT /pumps/:id/counters/:n` sans appel front (le front utilise `PATCH …/index`) | catalog.js:237 | À confirmer |
| C-02 | Faible | Routes sans appel front : `/access/status`, `/admin/licenses/duration-presets`, `/exports/:kind/preferences` (GET/PUT), `/money/accounts/:id/movements`, `/me/advertising/images/:index`, `/mobile/alerts` (probablement Android), `/c/:token` (page HTML) | voir lot 1 | À confirmer |
| C-03 | Faible | Deux appels front à chemin construit par l'appelant | ext-direction.js:36, ext-multistation-views.js:131 | Non résolu |

Aucune anomalie d'écriture SQL (colonnes ou tables inexistantes) n'a été trouvée.

## 5. Ce qui n'est pas vérifié

- Exécution des chaînes (serveur non démarrable). Toute anomalie ci-dessus doit être confirmée par un test avec des comptes de profils différents.
- Colonnes lues (`SELECT`) : non contrôlées automatiquement.
- Calculs métier : paie, fiscal, TVA, comptabilité, commissions, marges. Non relus dans ce lot.
- Isolation entre clients : non testée.

## 6. Prochaine étape

Lot 4 : migrations (inventaire des 122 fichiers, ordre, dépendances, idempotence, et contrôle des colonnes lues par le code). Lecture seule, sans rejouer de migration sur une base existante.
