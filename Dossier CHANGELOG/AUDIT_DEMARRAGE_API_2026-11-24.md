# Audit des trois appels lents au démarrage — 2026-11-24

Documentation seule, aucun code ni migration modifié (`npm run build:sw` sans objet).
Rapport : `docs/audit/AUDIT_DEMARRAGE_API_2026-11-24.md` ; état : `docs/ETAT_ACTUEL.md`.
Mesures sur PostgreSQL 16 jetable (données générées) : SQL rapide ; cause probable = allers-retours séquentiels et réservoir de 10 connexions, non prouvée. Non vérifié : production, serveur applicatif (npm bloqué).
