# Archive de travaux non intégrés (2026-11-26)

Ces fichiers conservent le contenu de branches GitHub avant leur suppression. **Rien ici n'est actif dans le site** : ce sont de simples fichiers texte, jamais exécutés ni déployés. Aucun n'a été testé sur la version actuelle de `main` (la branche d'origine avait 193 à 204 commits de retard et les correctifs entrent en conflit).

| Fichier | Contenu | Branche d'origine | État |
|---|---|---|---|
| `c38f068_tests-fixtures-perimees.patch` | Alignement de 4 tests périmés | `fix/tests-perimes-2026-11-16` | Ne s'applique plus tel quel sur `main` (conflit) ; non réexaminé |
| `8dc1832_cloture-rapprochement-cuve-alertes.patch` | Clôture : rapprochement cuve, drapeau « vérifié », continuité des index, alertes (`src/shifts.js`) | `feat/rapprochement-cloture-alertes` | **Règle métier : accord du propriétaire requis avant toute reprise** |
| `9e85609_cloture-affichage-rapprochement.patch` | Affichage du rapprochement dans le rapport de clôture (`public/app.js`) | `feat/affichage-rapprochement-cloture` | Dépend du précédent |
| `ad3468d_WIP-outils-gerant-non-teste.patch` | Lot B « outils du gérant » (objectifs, classement, résumé hebdo, justificatifs), migration 113 | `feat/rapport-whatsapp-signature-raccourci` | WIP **non testé** ; la numérotation 113 est déjà prise dans `migrations/` |

Les 4 commits sont dans l'ordre : `c38f068` est le plus ancien, `9e85609` et `8dc1832` s'appuient sur lui.

## Reprendre un lot
`git checkout -b reprise/<nom> main` puis `git am --3way docs/archive-branches/<fichier>.patch` ; résoudre les conflits, lancer les tests, **ne rien fusionner dans `main` sans accord**. Pour `ad3468d`, renuméroter la migration.

## Déjà dans `main` (rien à archiver)
`feat/regroupement-menu-client` (= `d8ac8dc`, vérifié dans `public/ext-shell.js`), `fix/scanner-flottant-reduire` (= `4d87688`), `release/apk-debug-2026-11-17` (APK identique, empreinte Git `5bb1e632…` dans `public/downloads/`), `docs/modele-journal-deploiement` et `docs/changelog-regroupement-deploiement` (repris en `fc6f2de` et `17a4667`).
