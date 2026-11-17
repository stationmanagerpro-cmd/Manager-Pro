# Besoin d'aide : table créée à la demande — 2026-11-17

## Cause
- La migration 120 (`help_guides`) n'est pas appliquée en production : `npm run migrate` est manuel.
- Sans la table, `GET /api/help-guides` échoue. Le front affiche alors des cartes vides et `is_superadmin` reste faux : pas de bouton « Modifier » pour le superadmin.

## Correction
- `src/help_guides.js` : `CREATE TABLE IF NOT EXISTS help_guides` (idempotent, même schéma que la migration 120) exécuté avant lecture et écriture.
- Aucune autre modification ; l'accès, le menu et la vue restent ceux de `main`.

## Tests
- `test/help-guides-unit.js` : 4/4.
- `test/besoin-aide-static.js` : 14/14.
- Suite complète : échecs préexistants sur `main` (`demo-mode-static`, `employee-actions-unit`, `stock-movement-validation-unit`).

## Non vérifié
- Affichage réel en production (compte superadmin et compte client) après déploiement.

## Retour arrière
Revert du commit de cette branche. La table créée reste vide sans effet.
