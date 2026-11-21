# Contrôle d'accès : décisions de l'audit (A-01 à A-04) — 2026-11-21

Décisions prises par le propriétaire (« prends les meilleures décisions »), appliquées ici.

## Décisions
- **A-01 Ventes (`GET /api/sales`)** : un gestionnaire (`report.view`, `finance.view` ou `cash.manage`) voit toutes les ventes de la station. Un vendeur (`sale.create`) ne voit que les siennes, rattachées à son employé (`employees.user_id`). Sans l'un ni l'autre : 403. Un vendeur sans fiche employé reçoit une liste vide.
- **A-02 Centre d'alertes** : filtre par source.
  - Alertes RH : `hr.view` ou `hr.manage`.
  - Écarts RH : `hr.view`, `hr.gaps` ou `hr.manage`.
  - Paie : `hr.payroll` ou `hr.manage`.
  - Dettes clients : `finance.view`, `cash.manage` ou `money.manage`.
  - Dettes fournisseurs : `finance.view` ou `money.manage`.
- **A-03 Acquittement d'une alerte RH** : `hr.manage` requis (403 sinon).
- **A-04 Notifications sensibles** (écarts de caisse, paie, RH, contrat) : visibles et acquittables seulement par un gestionnaire. Les autres notifications restent visibles à la station.

## Fichiers
- `src/core.js` : règles partagées (`hasManagerView`, `isSensitiveNotif`, `canSeeSensitiveNotif`).
- `src/operations.js` : `GET /sales`. Requête réécrite avec paramètres littéraux, pour garder la forme exigée par `test/shifts-sales-pdf-static.js`.
- `src/ops_plus.js` : centre d'alertes (filtre par source), acquittement (A-03, A-04).
- `src/reports.js` : `GET /notifications` et `POST /notifications/:id/read` (A-04).
- `test/acces-audit-decisions-static.js` : 5/5.

## Effets attendus (à vérifier en exécution)
- Un vendeur ne voit plus l'historique de toute la station dans l'écran Ventes, seulement le sien.
- Un profil sans droit RH ni finance ne voit plus les alertes correspondantes ; le compteur du centre d'alertes baisse pour eux.
- La fiche employé « profil de base » (`ext-core.js`) ne montre les ventes que si l'appelant est gestionnaire : sinon la liste est vide, sans erreur affichée (`.catch`).

## Vérification
- Syntaxe de `core.js`, `operations.js`, `ops_plus.js`, `reports.js` : OK.
- Tests statiques : aucun nouvel échec. 27 échecs préexistants, identiques avant et après (la plupart exigent un serveur ou une base).
- **Non vérifié à l'exécution** : aucun appel réel avec les profils vendeur, RH et gestionnaire.
