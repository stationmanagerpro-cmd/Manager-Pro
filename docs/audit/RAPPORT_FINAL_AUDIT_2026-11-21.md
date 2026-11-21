# Rapport final d'audit — Station Manager Pro — 2026-11-21

Audit en lecture seule. Aucun code, migration, donnée, route ni permission n'a été modifié pour l'audit.
Seules modifications du dépôt pendant la période : garde serveur des onglets client (commits `f87380e`, `34d08e4`), décisions et docs (`5b861e5`, `13b763e`), validées par le propriétaire.

## 1. Périmètre et méthode
- Lots : routes et appels front (lot 1), permissions (lot 2), chaînes fonctionnelles (lot 3), migrations (lot 4), commits distants `1b572b3..origin/main` (9 commits).
- Méthode : analyse statique (parsing des routes, des appels front, des gardes), validation SQL sur base PostgreSQL 16 vierge (122 migrations appliquées, `PREPARE` des requêtes littérales).
- Détails : `AUDIT_LOT1` à `AUDIT_LOT4`, `AUDIT_COMMITS_DISTANTS_2026-11-21`.

## 2. Limites (important)
- **Aucun test d'exécution** : le serveur ne démarre pas dans la session (dépendances absentes, registre npm injoignable). Les constats d'accès sont confirmés par lecture de code, pas par appel réel avec des profils.
- Production non accessible : rien n'a été vérifié sur la base de production.
- Les lots 1 à 4 ont été rédigés avant les commits distants ; ceux-ci sont traités dans `AUDIT_COMMITS_DISTANTS`.

## 3. Constats consolidés

| ID | Gravité | Constat | Emplacement | Statut |
|---|---|---|---|---|
| A-01 | **Élevée** (à confirmer en exécution) | `GET /api/sales` renvoie les ventes de toute la station (totaux, client, vendeur, n° de facture) sans permission de lecture | operations.js:223 | Confirmé par lecture |
| A-02 | Moyenne | Centre d'alertes sans filtre : alertes RH, paie, dettes visibles à tous | ops_plus.js:365–510 | Confirmé par lecture |
| A-03 | Moyenne | Acquittement d'une alerte RH sans permission RH | ops_plus.js:536–545 | Confirmé par lecture |
| A-04 | Faible (métier) | Notifications de station (écarts de caisse, licences) visibles par tous les profils ; lecture marquée par station, pas par utilisateur | reports.js:595–611 | À valider métier |
| A-05 | Faible (à valider) | Lecture du catalogue sans permission (`/products`, `/categories`, `/pumps`) : `buy_price` masqué, donc probablement voulu | catalog.js | À confirmer |
| A-06 | Moyenne (partielle) | Modules client : routes propres à un onglet gardées par `view_<onglet>` (23 onglets, commits `f87380e`, `34d08e4`). Routes partagées non gardées par choix : caisse, portail, facturation, tableaux de bord, magasins, trésorerie de direction, messagerie | server.js (VIEW_GUARDS) | **Risque résiduel accepté** |
| M-01 | Moyenne (à confirmer) | Migration 070 : `DROP TABLE client_devices` et `client_device_keys` ; irréversible si appliquée en production. Impossible à vérifier sans accès production | migrations/070 | Non vérifiable ici |
| M-02 | Faible | Migration 061 : anti-doublon e-mail 24 h créé mais non branché au code | migrations/061 | Confirmé |
| M-03 | Faible | Tables orphelines `license_settings` (019) et `email_alert_dedupe` (061) | migrations/019, 061 | Confirmé |
| M-04 | Faible | Numéros de migration en double (027, 040, 059) ; nom non standard `027_prompt_consolide_2026-10-07.sql` | migrations/ | Confirmé |
| M-05 | Faible | Migrations `role_permissions` redondantes (059, 062, 065) | migrations/058–065 | Confirmé |
| M-06 | Faible | `001_initial.sql` non idempotent : reprise impossible sans l'ignorer | migrations/001 | Confirmé |
| F-01 | Faible | `PUT /pumps/:id/counters/:n` sans appel front (le front utilise `PATCH …/index`) | catalog.js:237 | À confirmer |
| F-02 | Faible | Routes sans appel front : `/access/status`, `/admin/licenses/duration-presets`, `/exports/:kind/preferences`, `/money/accounts/:id/movements`, `/mobile/alerts` (probablement Android) | divers | À confirmer |
| F-03 | Faible | Deux appels front à chemin construit : `ext-direction.js:36`, `ext-multistation-views.js:131` | front | Non résolu |
| F-04 | Non vérifié | 185 requêtes SQL interpolées : non examinées | src/ | Non vérifié |
| T-01 | Moyenne (correction d'un constat) | Le lot 1 indiquait que les tests statiques étaient verts. Aujourd'hui, `test/step55-employee-performance-chart-static.js` échoue, y compris sur la base distante sans nos changements | test/ | **Constat à corriger** |

**Ce qui est conforme** (lecture confirmée) : coût d'achat masqué sans `cost.view` ; messagerie (appartenance, portée client) ; postes (sauf permissions larges) ; commissions vendeurs (`requireView`/`requireManage`) ; paie (propres bulletins) ; administration (`appearance.manage`, `is_global`) ; documents et pièces jointes RH ; forfaits (lecture publique voulue) ; sauvegardes (`is_global`).

**Cohérence base** : aucune écriture SQL vers une colonne ou table inexistante ; 1 606 requêtes littérales valides sur schéma migré ; 779 déclarations de routes, toutes montées ; 975 appels front résolus (sauf F-03).

## 4. Plan de correction (non appliqué, à valider)

Ordre proposé, du plus important au plus simple :

1. **A-01** — Décider qui voit les ventes (permission de lecture à définir), puis garder `GET /sales`. Test : deux profils, avec et sans permission.
2. **A-02 / A-03** — Décider qui voit et qui acquitte les alertes RH. Proposition : `hr.view` pour lire, `hr.manage` pour acquitter. Test par profil.
3. **M-01** — Vérification en lecture seule sur la production : la table `client_devices` existe-t-elle encore ? Ne rien exécuter avant ce constat.
4. **A-04** — Décider si les notifications de station restent visibles à tous (écarts de caisse, licences).
5. **Onglets partagés (A-06)** — Décision prise : risque accepté. À réexaminer si un client demande une restriction stricte.
6. **M-02 à M-06, F-01 à F-04, T-01** — Nettoyage sans impact fonctionnel, à traiter après validation : retrait des tables orphelines, renumérotation, réconciliation des routes, correction du test.

## 5. Décisions prises pendant l'audit
- Garde serveur des onglets client : 23 onglets, routes propres uniquement (validé).
- Routes partagées avec la caisse et les écrans de base : non gardées, risque résiduel accepté (validé pour les deux groupes).

## 6. Ce qui reste à faire avant clôture
- Exécution réelle avec des profils (A-01 à A-05, garde des onglets) sur un serveur démarré.
- Vérification production de M-01 (lecture seule).
- Traitement de F-04 (185 requêtes interpolées).
- Validation des décisions métier A-01, A-02, A-03, A-04.
