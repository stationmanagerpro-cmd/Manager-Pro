# Accès par onglet au compte client (contrat)

**Tâche** : permettre au Super Admin de couper, dans le contrat d'un compte client, des onglets précis (30 onglets, « Pilotage » et « Direction » fusionnés).

**Changements** (branche `feat/acces-onglets-contrat`, depuis origin/main dae1f34) :
- `src/contracts.js` : 30 options `view_<onglet>` à `true` dans `DEFAULT_FEATURES`. Un contrat existant garde donc tous ses onglets.
- `public/app.js` : `contractAllowsView` refuse un onglet dont l'option `view_<onglet>` est à faux. Le contrôle passe par `canView`, donc par le menu, le menu mobile et les liens qui utilisent `canView`.
- `public/ext-contracts.js` : section « Onglets accessibles au compte client » dans le formulaire (30 lignes Oui/Non). Défauts du formulaire à « Oui ». L'interrupteur global « Activation globale des modules » ignore ces options.
- `public/sw.js` : régénéré (`node scripts/build-sw.js`), cache `smp-static-be5545e07aa`.
- `test/contract-module-switches-static.js` : nombre de familles attendu passé de 9 à 10 (nouvelle section).
- `test/contract-onglets-static.js` : nouveau test (4 contrôles).

**Tests** :
- `test/contract-onglets-static.js` : 4/4.
- `test/contract-gates-ui-static.js` : OK.
- `test/contract-module-switches-static.js` : OK (10 familles).
- `test/contract-module-gates-static.js` : 8/8.
- `test/nav-tree-static.js`, `test/nav-colors-static.js`, `test/step8-contract-unlock-static.js`, `test/step41-a4-reset-contract-static.js`, `test/accounting-static.js` : OK.

**Non vérifié** :
- Rendu réel du formulaire contrat et du menu client en navigateur (site non joignable depuis le bac à sable).
- Liens « go('…') » codés en dur dans les tuiles des tableaux de bord : ils ne passent pas forcément par `canView`. À contrôler onglet par onglet.

**Restant** :
- Filtrer les tuiles et raccourcis codés en dur (ci-dessus).
- Fusion et déploiement : non faits, en attente d'autorisation.

**Branche / PR / déploiement** : branche locale, non poussée à ce stade, pas de PR, pas de déploiement.
