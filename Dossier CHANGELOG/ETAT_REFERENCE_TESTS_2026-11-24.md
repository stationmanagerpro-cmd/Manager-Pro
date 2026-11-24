# État de référence des tests et correction de notes — 2026-11-24

Documentation seule. Aucun fichier de `public/`, `src/`, `test/` ni migration modifié (`npm run build:sw` sans objet).

## Fichiers
- `docs/ETAT_ACTUEL.md` : repère `0364208`, résultats des 247 fichiers de test (un par un, délai 90 s), commits du propriétaire.
- `docs/REFERENCE.md` : description du bandeau corrigée (pas de repli à 10 s ; décision du 19 novembre).

## Résultats réels (sur `0364208`, sans serveur ni base)
224 passent ; 1 échec réel `test/skin-pro-static.js` (règle `html[data-hero-pending] #app-header` hors thème Pro, ajoutée par f139443 ; décision d'apparence au propriétaire, voir `docs/ETAT_ACTUEL.md`) ; 11 bloqués par `zod`, `jsdom` ou `exceljs` absents ; 11 exigent serveur, base ou variables `ISO_TEST_*`.
Non vérifié : `npm test` complet.
