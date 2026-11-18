# Dépenses : employé responsable ou dépense hors employé

**Décision validée :** (1) sur quart partagé, l'employé responsable est obligatoire sur chaque dépense ; (2) sinon la dépense est hors employé, au nom de son auteur, justifiée, déduite de la caisse et affichée dans le rapport de fermeture.

**Problème constaté :** les dépenses n'avaient aucun employé ; elles n'entraient dans l'attendu d'aucun employé et tombaient dans « Non attribué à un employé ».

**Changements :**
- `migrations/122_expenses_employee.sql` : colonne `expenses.employee_id` (nullable) + index. Migration appliquée au démarrage par le runner.
- `src/operations.js` (`POST /expenses`) : quart partagé (2 membres ou plus) → employé obligatoire, membre du quart ; quart à une personne → facultatif ; sans employé → commentaire obligatoire (justification) ; employé sans quart ouvert → refusé.
- `src/shift_attribution.js` : `computeEmployeeClosings` soustrait les dépenses en espèces de chaque employé (`expensesByEmp`, paramètre facultatif) ; `expenses_cash` ajouté à chaque ligne.
- `src/shifts.js` (clôture) : dépenses en espèces par employé et dépenses hors employé ; rapport enrichi de `expenses_unassigned`.
- `public/app.js` : formulaire « Dépense » avec sélecteur d'employé (obligatoire sur quart partagé) et justification ; rapport de clôture : ligne « Dépenses hors employé ».
- `public/index.html`, `public/sw.js` : service worker régénéré.

**Tests :** `shift-close-attribution-unit` 16/16 (mocks des deux nouvelles requêtes) ; boucle complète : mêmes échecs préexistants que `main` (`demo-mode-static`, `employee-actions-unit`, `stock-movement-validation-unit`).

**Non couvert :** aucun test unitaire pour les règles de `POST /expenses`.
**Non fait :** mouvements de caisse manuels (fonds, retraits) — pas encore d'employé responsable ; à traiter ensuite si tu le demandes.
**Non vérifié :** comportement réel en production ; migration 122 non appliquée ici.

**Statut :** branche `feat/depense-employe-responsable`, PR à ouvrir, non fusionnée, non déployée.
