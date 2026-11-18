# Ventes produit sur quart partagé — employé obligatoire ; libellé « Pompe »

**Demande :** sur un quart partagé, la vente doit être attribuée à l'employé qui l'a servie ; dans « Ouverture de quart », afficher « Pompe » et non « Pompe 1 » sur le premier sélecteur.

**Constat :** le formulaire de vente présélectionnait toujours le premier participant (ou le compte connecté) : une vente pouvait être attribuée à tort sans que personne ne le remarque. Le serveur acceptait cette valeur par défaut.

**Changements :**
- `public/ext-sale-shift.js` : quart à 2 employés ou plus → aucun employé présélectionné, libellé « Employé qui a servi (obligatoire) », enregistrement bloqué sans choix.
- `src/operations.js` (`POST /sales`) : quart à 2 employés ou plus → 400 sans `employee_id` ; 400 si l'employé ne fait pas partie du quart. Le repli sur le compte connecté ne reste que pour un quart à une seule personne.
- `public/ext-core.js` : libellé « Pompe 1 » → « Pompe » (la 2e pompe reste « Pompe 2 »).
- `public/index.html` : `ext-core.js?v=3`, `ext-sale-shift.js?v=2` ; `public/sw.js` régénéré.

**Tests :** `sw-coherence-static` 8/8 ; syntaxe OK. Boucle complète : mêmes échecs préexistants que sur `main` (`demo-mode-static`, `employee-actions-unit`, `stock-movement-validation-unit`). **Non couvert :** aucun test unitaire pour la règle serveur sur quart partagé.

**Non vérifié :** comportement réel en production et sur l'application Android.

**Correction d'une hypothèse précédente :** le serveur refusait déjà une vente sans employé. Le −2 000 FCFA vient donc probablement d'un autre mouvement (dépense ou ajustement de caisse sans employé), à confirmer sur les données.

**Statut :** branche `fix/vente-employe-pompe-libelle`, PR à ouvrir, non fusionnée, non déployée.
