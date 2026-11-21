# Audit des commits distants (1b572b3 → origin/main) — 2026-11-21

Périmètre : 9 commits ajoutés après la base d'audit `1b572b3`. Audit en lecture seule : aucun code modifié.
Méthode : lecture des diffs (`git diff 1b572b3 origin/main`), recherche des usages de chaque clé `view_*` dans `src/` et `public/`, lecture de `featureOn`, `DEFAULT_FEATURES` et de la garde `go()`.
Limite : aucun test d'exécution (serveur non démarrable ici). Les constats ci-dessous sont statiques et restent à confirmer par un test avec un compte client.

## Changements
- `src/contracts.js` (+31) : 30 clés `view_<onglet>` ajoutées à `DEFAULT_FEATURES`, toutes à `true`.
- `public/app.js` (commit 25eb53f) : `go()` refuse un onglet si `ME.contract.features['view_'+k]` est faux.
- `public/ext-contracts.js` : écran Super Admin pour activer/désactiver ces onglets.
- `public/index.html`, `ext-sectioned-form.js`, `ext-skin-pro.css` : en-tête et pied de formulaire (front uniquement).

## Constats

### C-01 — Restriction d'onglets uniquement côté interface (gravité : élevée, à valider)
- Aucune route serveur ne lit les 30 clés `view_*` ajoutées. `grep` : elles n'apparaissent que dans `DEFAULT_FEATURES`, `public/ext-contracts.js` et la garde `go()`.
- Conséquence : un compte client dont l'onglet est coupé (`view_treso = false` par exemple) ne voit plus l'onglet, mais peut appeler directement l'API correspondante s'il possède la permission métier. La restriction est contournable.
- Les modules sont, eux, contrôlés côté serveur (`src/server.js` lignes 162–208, `featureOn(contract, 'module:…')`). Les `view_*` n'ont pas ce garde-fou.
- Remarque : certains `view_*` anciens (`view_usage`, `view_note`, `view_reports`) sont utilisés côté serveur ; le nouveau lot ne l'est pas.

### C-02 — Compatibilité des contrats existants (gravité : faible, favorable)
- `DEFAULT_FEATURES` est fusionné avec les contrats enregistrés (`src/contracts.js:138`). Les contrats existants reçoivent donc `view_* = true` : aucun onglet ne disparaît à la mise en ligne. Vérifié statiquement.

### C-03 — Clés de `go()` non vérifiées (gravité : moyenne, à tester)
- La garde compare `'view_' + k` au nom passé à `go(k)`. Si un nom d'onglet diffère de la clé (ex. `view_moidash` ↔ `go('moidash')`), la restriction ne s'applique pas. Non vérifié pour les 30 clés.

### C-04 — Commits de présentation (en-tête, formulaire contrat) (gravité : nulle)
- Front uniquement, sans impact sur les données ni les permissions.

## Suite donnée (mise à jour)
- C-01 : garde serveur ajoutée pour 28 motifs (23 onglets) (voir `Dossier CHANGELOG/GARDE_SERVEUR_ONGLETS_2026-11-21.md`). Les routes partagées avec la caisse et les autres écrans restent non gardées (risque résiduel, décision à prendre) : caisse (`/money/accounts`), portail client et facturation (`/invoices`), tableaux de bord (`/dashboard/*`, `/aggregates`), magasins (`/stations/overview`), trésorerie de direction (`/treasury`), messagerie (`/messaging/alert-config`), fidélité en caisse (`/loyalty/settings`).
- Les 30 clés sont bien celles des commits distants (contrôlé par `git diff`).

## Actions proposées (historique)
1. Décider si un onglet coupé doit aussi bloquer l'API (recommandé : garde serveur par route, sur le modèle des modules).
2. Test de confirmation avec un compte client dont `view_treso = false` : appel direct de l'API trésorerie.
3. Vérifier la correspondance clé ↔ nom d'onglet pour les 30 clés (C-03).
