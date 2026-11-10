# Étape 30 — Partie 6 (13 oct. 2026)

## Corrections
1. **Employés sans compte (multi-station)**  
   - `GET /employees/unlinked?scope=client` : liste sur toutes les stations **déjà accessibles** à l'utilisateur (même client, `user_stations`).  
   - Isolation préservée (pas d'accès aux stations hors périmètre).  
   - `addU` utilise ce scope, affiche `@ station`, et rattache le compte à la **station de la fiche** employé.

2. **Scanner alertes**  
   - Toast explicite : créées vs déjà signalées dans les 24 h (plus de faux « 10 alertes créées »).

## Fichiers
- src/catalog.js
- public/ext-roles.js
- public/ext-ops.js
