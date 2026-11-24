# Test `about-page-ui` : sélecteurs corrigés — 2026-11-24

Test seul. Aucun fichier du site (`public/`, `src/`) ni migration modifié.

## Cause de l'échec (signalé le 2026-11-21)
1. Le bouton œil `#lpeye` (affiche ou masque le mot de passe) est placé avant « Se connecter » dans `.login-card` (`public/app.js`). Le test cliquait `.login-card button`, donc le bouton œil : aucune requête de connexion, `#app.ready` jamais atteint (délai de 30 s).
2. La page « À propos » affiche aussi « Versions et restauration » (classe `ab-edit-btn b2`) ; le test attendait un seul `.ab-edit-btn`.

## Correction (`test/about-page-ui.test.js`)
- `.login-card button` → `.login-card button[onclick^="doLogin"]` (2 occurrences).
- `.ab-edit-btn` → `.ab-edit-btn:not(.b2)` pour le bouton « Modifier la page » (3 clics, 1 comptage). Le comptage « 0 bouton pour le compte client » est inchangé.
- Aucune vérification supprimée ni assouplie.

## Vérification réelle
`node test/about-page-ui.test.js` avec le Playwright de l'installation Python via `NODE_PATH` (hors dépôt) : code de sortie 0, 74 contrôles ✔, 0 erreur JavaScript. `test/ui-shell/ui-shell.test.js` : 66 ✔ sans modification.
Non vérifié : `npm test` complet (serveur, base).
