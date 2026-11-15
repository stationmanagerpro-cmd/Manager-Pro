# Superadmin : santé des clients, relance de licence, journal d'erreurs, comparaison — 2026-11-15

Demande utilisateur : points 1 à 4 de la liste « Superadmin ». Branche : main (fusion directe, retour arrière par revert).

## Réalisé
1. **Santé des clients (0–100)** : GET /admin/platform/health. Pondération activité 30 (jours de connexion), quarts clôturés 30 (pénalité par quart ouvert > 24 h), écarts de caisse 20 (part des quarts avec écart), licence 20. Composante sans donnée = moitié des points, marquée « incomplet ». Niveaux : bon ≥ 70, à surveiller 40–69, à risque < 40. Écran : Centre de contrôle › Pilotage › Santé des clients.
2. **Relance automatique de licence** : palier 30, 15, 7 jours (parmi les seuils configurés de la licence), une seule relance par client/échéance/palier (table license_reminders). Une notification par station du client, avec bouton « Renouveler » (ouvre la demande de renouvellement existante). Planificateur toutes les 6 h + déclenchement manuel (Pilotage › Santé). Pas d'e-mail ni WhatsApp (non demandé).
3. **Journal des erreurs** : table error_log ; erreurs serveur (500, schéma) via le gestionnaire central et erreurs d'écran (JS) des utilisateurs via POST /errors/client (10/min/utilisateur) ; regroupées, dédoublonnées à la minute, purgées après 30 jours. Écran : Pilotage › Erreurs.
4. **Comparaison des stations** : GET /admin/platform/compare ; ventes (compteurs des quarts clos + ventes produits), marge boutique uniquement, écarts de caisse, quarts clôturés. Anonymisée par défaut (« Station A… »), noms sur demande.

## Fichiers
migrations/112_platform_insights.sql ; src/client_health.js, license_reminders.js, platform_insights.js (nouveaux) ; src/server.js, core.js ; public/ext-platform-insights.js (nouveau), ext-p12.js, index.html, app.js ; test/platform-insights-unit.js (9 contrôles) ; sw.js.

## Tests
platform-insights-unit 9/9 ; swallowed-errors OK ; suites statiques/unitaires identiques à la référence.

## NON vérifié / limites
- Migration 112 et requêtes SQL jamais exécutées sur PostgreSQL ; écrans non vus.
- Marge carburant non calculée (pas de coût carburant fiable) ; la comparaison ne prétend pas à une marge totale.
- La comparaison lit des totaux de stations de clients différents : réservée à l'administrateur principal, anonymisée par défaut — à valider côté confidentialité contractuelle.
- Pondérations et seuils du score = choix de conception, à ajuster après observation réelle.
