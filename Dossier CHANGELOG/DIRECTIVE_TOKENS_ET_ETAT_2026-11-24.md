# Directive d'économie de tokens et mise à jour de l'état — 2026-11-24

Documentation seule. Aucun code, aucune migration, aucun fichier de `public/` modifié (`npm run build:sw` sans objet).

## Fichiers
- `CLAUDE.md` (nouveau) : consignes de reprise, renvoie vers `docs/ETAT_ACTUEL.md` et `docs/REFERENCE.md`.
- `docs/REFERENCE.md` : section 0 ter (directive tokens, commandes courtes, compte rendu, livraison) ; chiffres de la section 4 mis à jour.
- `docs/ETAT_ACTUEL.md` : dernier commit vérifié `ea18655` ; prochaine tâche ; section 9 (49 commits depuis `57cf79d`, contradictions, tests exécutés).

## Vérification
- `git fetch`, `git log 57cf79d..origin/main` : 49 commits ; `git diff` sur les fichiers cités par la référence.
- Tests statiques exécutés : repo-hygiene 7/7, sw-coherence 8/8, banner-static, migration-safety, tenant-isolation, auth-lockout, links-audit, pump-fuel-rule, qr-static, qr-logic-unit, qr-decoder-unit : tous passés.
- Non exécutés : `npm test` et tests avec serveur ou base (npm injoignable, pas de PostgreSQL).
