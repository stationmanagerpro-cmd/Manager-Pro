# Suspension de l'accès d'une station (arrêt de travail) — 2026-11-16

## Demandé
Pouvoir rendre inactif le sous-compte d'une station en cas de besoin (ex. la station arrête le travail). Choix validé : un interrupteur sur la fiche station.

## Réalisé
- migrations/114_station_suspension.sql : colonne `stations.suspended_at` (additive, idempotente). NULL = accessible.
- src/core.js (middleware station) : si la station est suspendue, toutes les requêtes des comptes liés sont refusées (403 « Accès à cette station suspendu par le gérant… »). Exceptions : la levée de suspension et la lecture de l'identité station (pour que l'écran puisse la rétablir).
- src/admin.js : PATCH /stations/:id/suspension (droit user.manage, station dans le périmètre de l'utilisateur, audit). GET /stations/current renvoie `suspended_at`.
- public/ext-p12.js : carte « Accès de la station » et bouton « Suspendre l'accès (arrêt de travail) » / « Rétablir l'accès ».
- Les comptes et les données ne sont pas modifiés. Le superadmin (compte global) n'est pas concerné par la suspension.
- public/sw.js régénéré (smp-static-b9acc52f055).

## Vérifications
- PostgreSQL 16 réel (base de test) : migration 114 appliquée, rejouée sans erreur (idempotente) ; suspension puis levée vérifiées par requête.
- test/station-suspension-unit.js : 6/6 (exceptions du middleware, route, audit, migration additive).
- links-audit : OK (la route est reliée à l'écran). sw-coherence : OK.
- Suite complète : mêmes 7 échecs pré-existants qu'origin/main ; aucune régression.

## Non vérifié / limites
- Pas de test de bout en bout (middleware appelé par une vraie requête HTTP) : le middleware n'a pas pu être exécuté dans l'application.
- Affichage de l'écran station : non vérifié dans le navigateur.
- Un utilisateur dont la station est suspendue voit les écrans en erreur (403) ; seule la fiche station reste utilisable pour rétablir. À confirmer au test.
- Ce qui n'est pas couvert : désactivation d'un compte individuel (déjà possible dans Rôles & utilisateurs et via la fiche employé).

## Statut
Branche feat/fiche-client-et-sous-comptes. Fusion dans main et déploiement : non faits, en attente de votre accord.
