# Regroupement du menu compte client — 2026-11-17

Branche : feat/regroupement-menu-client (base 40fcd9e). Intégré sur `main` en `d8ac8dc`. **Déployé en production** (Render, `dep-dbtsqaqfngtc73a4gh9g`, statut `live` vérifié le 2026-11-17 à 03:43 UTC).

## Déploiement
- Commit déployé : `d8ac8dc`. Déclenchement manuel ; aucune migration ni variable d'environnement modifiée.
- Version précédente : `bb34603` (`dep-dbtrpuon74is73eltoag`, désactivée) — cible du retour arrière.
- Retour arrière : redéployer `dep-dbtrpuon74is73eltoag`, ou revert du commit `d8ac8dc` sur `main`, sans force-push.
- Vérification en production (navigateur, sous-menus bureau et téléphone) : **non effectuée** à ce jour.

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
