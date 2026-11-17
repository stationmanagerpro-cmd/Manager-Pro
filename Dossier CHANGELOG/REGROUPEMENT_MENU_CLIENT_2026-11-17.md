# Regroupement du menu compte client — 2026-11-17

Branche : feat/regroupement-menu-client (locale, base 40fcd9e = main). **Non poussée, non fusionnée, non déployée.**

## Réalisé
Restructuration de `TREE` dans `public/ext-shell.js` uniquement : données de navigation, sans changement de vue, de clé, d'URL ni de droit (la visibilité reste calculée par vue).
- Tableau de bord : 7 → 6 vues (`reconcile` retiré).
- Exploitation (17 à plat) → 4 sous-rubriques : Ventes & caisse ; Quarts & pompes ; Stock & approvisionnement ; Contrôles (reconcile ajouté ici).
- Finance & rapports (12) → 3 : Trésorerie ; Résultats ; Rapports & données.
- La Fiscalité (14) → 3 : Accueil & profil ; Déclarations & périodes ; Audit & score.
- Administration (14) → 3 : Accès & rôles (param, « Utilisateurs », inclus) ; Station & paramètres ; Stations & audit.
- Ressources humaines : « Suivi du personnel » (11) → Présence & planning (5) ; Compétences & suivi (6).
- Gestion commerciale, Paie, Comptabilité, Communication, Mon profil & aide : inchangées.

## Tests
- Comparaison avant/après (script) : 99 vues uniques avant et après, aucune perdue, aucune ajoutée, doublon `reconcile` supprimé.
- `test/nav-tree-static.js` (nouveau) : aucune vue en double, aucune rubrique vide.
- Adaptations de deux tests statiques au nouveau texte de `TREE` (intention conservée) : `confort-static` et `fiscal-access-c1-static`.
- `build-sw.js` relancé ; `--check` : à jour.
- Suite complète : 191 réussis ; 7 échecs identiques à ceux de `main` (corrigés sur la branche `fix/tests-perimes-2026-11-16`, non fusionnée ici).

## Non vérifié
- Affichage réel des sous-menus en navigateur (bureau et téléphone 390 px) : non vérifié, la session n'ouvre pas l'application connectée.
- Comportement de débordement après regroupement : à confirmer à l'écran.

## Procédure de retour arrière
Revert du commit sur la branche ou sur main, sans force-push. Aucune donnée ni migration impliquée.
