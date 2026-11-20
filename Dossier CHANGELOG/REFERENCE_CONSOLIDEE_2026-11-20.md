# Référence consolidée et synchronisation (2026-11-20)

## Modifications
- `docs/REFERENCE.md` (nouveau) : remplace `CAHIER_DES_CHARGES.md` et `ARCHITECTURE_TECHNIQUE.md`. Contient la procédure de synchronisation (branches et commits), les règles permanentes, l'index des sources de règles, l'architecture et les moyens de test.
- `docs/ETAT_ACTUEL.md` : fusionne l'état actuel et le suivi d'exécution.
- Supprimés (fusionnés) : `docs/CAHIER_DES_CHARGES.md`, `docs/ARCHITECTURE_TECHNIQUE.md`, `docs/SUIVI_EXECUTION.md`.
- Les anciens documents datés de `docs/` ne sont pas supprimés : leur fusion et leur suppression attendent l'accord de l'utilisateur.

## Vérifications
- Migrations sur PostgreSQL 16 local (base `smp_check`) : 122 fichiers appliqués, 0 échec, 173 tables.
- `repo-hygiene-static` 7/7, `sw-coherence-static` 8/8.
- Tests statiques supplémentaires : voir `docs/ETAT_ACTUEL.md`.

## Non vérifié
- `npm test` : registre npm injoignable, dépendances incomplètes.
