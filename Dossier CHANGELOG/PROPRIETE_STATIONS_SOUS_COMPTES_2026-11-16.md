# Propriété des stations et sous-comptes : archivage, suspension, auteur — 2026-11-16

## Demandé
- Une station archivée doit disparaître du sélecteur, comme les clients archivés, avec un moyen de la réactiver.
- Seul l'administrateur local qui a créé une station ou un sous-compte peut le suspendre, l'archiver ou le désactiver. Le superadmin ne gère ni les sous-comptes ni les stations d'un client.

## Réalisé
- migrations/115_creator_archive.sql : colonnes `created_by` sur `users` et `stations` (additives, idempotentes). Renseignées à chaque création : admin local créé par le superadmin (contrats), station par défaut du client (propriétaire local), station créée par un admin local, sous-compte créé par un admin local.
- src/ownership.js (nouveau) : règles d'appartenance.
  - Station : son auteur ; si aucun auteur ou créée par le superadmin, tout administrateur local lié à la station.
  - Sous-compte client : son auteur uniquement ; historique sans auteur : tout administrateur local du même client. Le superadmin est exclu.
- Archivage (src/auth.js, routes placées avant le contrôle de station pour qu'une station archivée puisse être réactivée) :
  - PATCH /stations/:id/archive, réservé à l'auteur. Passe `stations.active` à false ; `/me` ne retient que les stations actives, donc la station sort du sélecteur.
  - GET /stations/archived : stations archivées que l'utilisateur peut réactiver.
- Suspension (src/admin.js) : réservée à l'auteur de la station (ownership). GET /stations/current renvoie `can_manage_access`.
- Sous-comptes (src/auth.js, PATCH /users/:id/active) : réservé à l'auteur ; le superadmin reçoit un refus.
- Écran station (public/ext-p12.js) : boutons Suspendre / Rétablir et Archiver, visibles seulement si `can_manage_access` ; liste « Stations archivées » avec Réactiver. Après archivage, rechargement pour recalculer le sélecteur.
- public/sw.js régénéré (smp-static-bbab62f1a9e).

## Vérifications
- PostgreSQL 16 réel (base de test) : migration 115 appliquée et rejouée ; requêtes de propriété testées (auteur oui, autre utilisateur non) ; archivage puis disparition de la liste des stations archivées, puis réactivation.
- test/ownership-unit.js : 9/9 (auteur, autre admin, superadmin, station sans auteur, sous-compte d'un autre client, historique).
- test/station-suspension-unit.js : 6/6 ; test/detail-pages-static.js : assertion mise à jour (insertion avec created_by).
- links-audit : OK (962 appels, 819 routes). Suite complète : 190 suites, mêmes 7 échecs préexistants qu'origin/main.

## Non vérifié / limites
- Le middleware de station et les nouvelles routes n'ont pas été appelés par de vraies requêtes HTTP dans l'application.
- Écrans (archivage, liste archivées, sélecteur) : non vus dans un navigateur.
- Le bouton « Désactiver » reste visible pour le superadmin dans Rôles & utilisateurs ; le serveur le refuse (message clair), mais l'interface n'est pas masquée.
- Un admin local créé par le superadmin n'a pas d'auteur local : personne d'autre que le superadmin ne peut le désactiver. Conséquence directe de la règle demandée ; à valider.
- Une station créée par le superadmin n'est gérable que par les administrateurs locaux du client, sans auteur précis.

## Déploiement
Voir la section « Fusion et déploiement » ci-dessous.

## Fusion et déploiement — 2026-11-16 02:33 UTC
- Fusion : origin/main 35d656c → 4dce57a (fast-forward, sans force-push). Les commits de la branche : 4f4025e (affichage mobile), 7ae33e0 (suspension de station), 4dce57a (propriété, archivage).
- Déploiement Render : lancé à la main (auto-déploiement désactivé). dep-dbt6mdoae00c739r11ig, commit 4dce57a, statut live (02:33:50 UTC).
- Migrations 114 et 115 appliquées en production après sauvegarde vérifiée (smp-2026-11-16T02-32-49-766Z.sql.gz, 78 851 octets). Journal : « Base à jour. » Aucune erreur (niveau error/fatal).
- Vérification HTTP du site : impossible depuis l'environnement (proxy 403). Écrans et routes sur le site : non vérifiés.

## Procédure de retour arrière
1. Code : redéployer le déploiement précédent dep-dbt5t16c6qcc73aqrtqg (commit 11ff351, Outils du gérant), ou annuler les commits par `git revert` sur main puis redéployer. Pas de force-push.
2. Base : les migrations 114 et 115 sont additives (colonnes suspended_at, created_by). Le code précédent les ignore. Ne pas les supprimer sans sauvegarde.
3. Effet d'un retour arrière : les stations archivées restent inactives et les auteurs enregistrés restent renseignés ; la gestion revient à l'ancien comportement (tout administrateur du client).
