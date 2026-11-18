# Correctifs issus de l'audit du 2026-11-18

- Branche : `audit/corrections-2026-11-18` (depuis `origin/main` 4ebd745). **Non poussée, aucune PR, aucune fusion, aucun déploiement.**
- Rapport d'audit et registre : `ANO-001` à `ANO-019` (tableur de suivi hors dépôt).

## Corrigé
- **ANO-007** — `src/help_guides.js` : le contrôle Super Admin précède désormais la validation du corps sur `POST /help-guides` et `PUT /help-guides/:key`. Un compte client reçoit 403, et non plus 400 pour un corps invalide. Le contrôle dans le handler reste en place.
- **ANO-008** — `GET /help-guides` renvoie `help_keys` (liste des modules intégrés). `public/ext-help.js` l'utilise, avec repli sur sa liste locale si la réponse ne la contient pas.
- `public/index.html` : `ext-help.js?v=4`. `public/sw.js` régénéré (`smp-static-b1ee3cb8c22`, contrôle `--check` à jour).
- `test/help-guides-unit.js` : deux contrôles ajoutés (ordre de la garde, liste serveur). 8/8.

## Vérifié
- `test/help-guides-unit.js` : 8/8.
- Suite statique et unitaire complète : 200 réussis, 3 échecs. Le même résultat qu'avant les modifications.

## Non corrigé (et pourquoi)
- **ANO-003** : reclassé. Les trois `UPDATE` dynamiques sont protégés par des schémas `.strict()`. Aucune modification.
- **ANO-001** (CSP) : retirer `'unsafe-inline'` casserait les handlers `onclick` existants. Chantier à planifier.
- **ANO-002** (jeton Mapbox de repli) : à retirer seulement après confirmation que `MAPBOX_TOKEN` est défini sur Render.
- **ANO-004** (`innerHTML`) : revue ligne à ligne non réalisée.
- **ANO-009** (MutationObserver) : non modifié, risque de régression sur la persistance du bouton « Besoin d'aide ».
- **ANO-010** : `stock-movement-validation-unit.js` échoue à cause d'un `zod` factice (`stubs/zod`, contraintes ignorées), pas à cause du code. Les deux autres échecs (`demo-mode-static.js`, `employee-actions-unit.js`) n'ont pas été analysés.
- **ANO-011 à 013** : aucune route supprimée ni renommée, sans preuve et sans autorisation.
- **ANO-005, 006** : migrations déjà appliquées, non modifiées.
- **ANO-014** : APK à recompiler (Android Studio), impossible ici.
- **ANO-015** : déploiement, uniquement sur demande explicite.
- **ANO-016, 017** : décisions métier, à valider par le propriétaire.
- **ANO-018, 019** : `npm audit` et tests avec PostgreSQL impossibles dans cet environnement.

## Tests non effectués
- Site de production, navigateur, base de données réelle.

## Suite
- Revue de la branche, puis PR et fusion sur votre mot. Déploiement après « déploie ».

## Suite — points « non corrigé » traités (2026-11-18)
- **ANO-010 (partiel)** : `test/demo-mode-static.js` corrigé : la liste des clés du menu attendait 4 clés, la fonctionnalité d'aide en ajoute `besoin_aide`. Test passe. Suite : 201 réussis, 2 échecs.
- `employee-actions-unit.js` et `stock-movement-validation-unit.js` : échecs liés au `zod` factice du bac à sable (contraintes min/max ignorées). Non corrigés ici ; à relancer avec `npm ci` (zod réel).
- **ANO-001 (CSP)** : non modifié. ~1 376 attributs inline (onclick, onchange, oninput…) à migrer avant de retirer `'unsafe-inline'`.
- **ANO-002 (Mapbox)** : non modifié. `MAPBOX_TOKEN` à confirmer dans Render avant suppression du repli.
- **ANO-004 (innerHTML)** : revue des 15 insertions suspectes : sources internes (URL blob, nombres, champs déjà échappés, dataURL de canevas). Aucune injection exploitable constatée.
- **ANO-009** : non modifié (risque sur le bouton d'aide, pas de test navigateur avec base).
- **ANO-014** : SDK Android absent (Gradle présent, pas de SDK) : recompilation impossible ici.
- **ANO-015** : le service Render `Manager-Pro` est en auto-deploy sur `main` : toute fusion déploie automatiquement. Fusion et déploiement doivent donc être validés ensemble.
- **ANO-018 / ANO-019** : dépendances non installées (pas de `node_modules`, réseau npm bloqué) : `npm audit` et tests d'intégration impossibles.

## ANO-016 — responsable obligatoire sur chaque dépense (2026-11-18)
Décision du propriétaire : chaque dépense a un responsable (employé, admin, gérant…), compte utilisateur de la station, désigné par une autre personne ; motif obligatoire ; responsable prévenu dans la messagerie ; dépense visible dans le rapport de fermeture.
- Migration `123_expenses_responsible.sql` : colonne `expenses.responsible_user_id` (nullable, historique intact).
- `POST /expenses` : responsable requis ; refus si le responsable est l'auteur ; refus si hors station ou inactif ; motif obligatoire pour toute dépense ; si le responsable est employé du quart, la dépense lui est rattachée (écart de caisse). Notification `expense_assigned` (hors rejeu).
- `GET /expenses/responsables` : comptes actifs de la station.
- Formulaire « Dépense » : sélecteur de responsable obligatoire (remplace le sélecteur d'employé). `app.js` modifié, `sw.js` régénéré.
- **Changement de règle** : l'obligation « employé responsable sur quart partagé » (PR #18) est remplacée par la règle du responsable ci-dessus. Un responsable sans compte utilisateur n'est plus admis.
- Rapport de fermeture : les dépenses sans employé restent dans « Dépenses hors employé » ; le nom du responsable n'y figure pas encore.
- Test : `test/expense-responsible-static.js` 8/8 (vérification statique, base non exécutée). Suite : 202 réussis, 2 échecs d'environnement.
- Non vérifié : tests d'intégration avec PostgreSQL, comportement en production, ancien client (cache) qui n'envoie pas `responsible_user_id` (refusé).

## Règle : aucune clôture antérieure à une opération du quart (2026-11-18)
Décision du propriétaire : une clôture de quart ne peut pas être antérieure à une vente ou opération du même quart.
- `src/shifts.js` (route de clôture) : refus 400 si `closed_at` est antérieur à la dernière vente (`sales.sold_at`), au dernier paiement (`payments.paid_at`) ou au dernier mouvement de caisse (`cash_movements.created_at`) du quart.
- L'écart de clôture (`ecart_cloture`) est daté à l'heure de clôture retenue, comme l'ouverture le fait déjà pour ses mouvements.
- Test : `test/shift-close-after-ops-static.js` 5/5. `test/shift-close-attribution-unit.js` : simulateur complété pour la nouvelle requête. Suite : 203 réussis, 2 échecs d'environnement (zod factice).
- Non couvert : les dépenses (la base de production n'a pas de `created_at` pour `expenses`, seulement la date `spent_on`), ni les relevés de compteurs et mouvements de stock dont la colonne horodatée n'a pas été confirmée.
- Non vérifié : tests d'intégration avec PostgreSQL.
