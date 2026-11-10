# Correctif — Octroi d'accès compte aux employés (2026-10-15)

## Symptôme
« Octroyer un accès » affichait « Aucun employé sans compte sur cette station… » alors que la fiche employé était active et sans compte.

## Cause réelle
- Il n'existe qu'UNE table `roles` (migration 001, complétée par 051/052) : pas de double liste superadmin/client en base.
- Dans `src/catalog.js`, `GET /employees/:id` était déclarée avant `GET /employees/unlinked`. Express lisait « unlinked » comme un id → 400 « Identifiant employé invalide ».
  `public/ext-roles.js` avalait l'erreur (`.catch(() => [])`) → liste vide → message trompeur.

## Corrections
- `src/catalog.js` : `/employees/unlinked` déplacée avant `/employees/:id` ; `/employees/:id` limitée aux ids numériques `(\d+)`.
- `public/ext-roles.js` : erreurs réelles affichées ; liste de rôles unique filtrée (ADMIN jamais proposé à un compte client) ; rôle par défaut selon la fonction de l'employé.
- `public/sw.js` : cache `smp-static-v4` pour forcer le rechargement des scripts.
- `test/employees-unlinked-route-static.js` : test de non-régression.

## Déploiement
Redémarrer le serveur Node (aucune migration). Rafraîchir le navigateur (Ctrl+F5).
