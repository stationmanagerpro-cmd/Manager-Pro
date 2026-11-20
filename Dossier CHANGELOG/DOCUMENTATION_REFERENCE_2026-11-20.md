# Documentation de référence (2026-11-20)

## Ajouts (dossier `docs/`)
- `docs/CAHIER_DES_CHARGES.md` : index des règles validées, renvoi aux documents sources (ne recopie pas les règles).
- `docs/ARCHITECTURE_TECHNIQUE.md` : technologies, structure, conventions, tests, limites.
- `docs/SUIVI_EXECUTION.md` : tâches terminées et vérifiées (avec commit et preuve), en cours, bloquées, restantes.
- `docs/ETAT_ACTUEL.md` : dernière tâche, tests exécutés, problèmes ouverts, prochaine tâche, questions ouvertes.

## Vérifications
- `test/repo-hygiene-static.js` : 7/7.
- Les documents ne sont pas servis par l'application (aucune route `docs/`).

## Non vérifié
- Cohérence complète avec les anciens documents de `docs/` (ces quatre fichiers renvoient aux sources au lieu de les recopier).
