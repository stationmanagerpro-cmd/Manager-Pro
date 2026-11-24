# Audit de la lenteur au démarrage : trois appels serveur — 2026-11-24

Lecture seule : aucun fichier de code modifié. Base jetable PostgreSQL 16 (125 migrations appliquées, 0 échec), supprimée après les mesures.

## Point de départ
Capture du propriétaire (fenêtre « Actualisation en cours ») : fichiers 0,4 s ; `/me/license/status-message` 4,8 s ; `/messaging/unread` 4,0 s (en attente) ; `/dashboard` 4,0 s (en attente). Les fichiers sont rapides ; l'attente vient du serveur.

## Ce que le code fait (lu dans `src/`)
Pour un compte client (non Super Admin), chaque appel `/api/...` traverse d'abord :
- `auth` (`src/core.js`) : 2 requêtes l'une après l'autre (identité et session, puis permissions du rôle) ;
- `station` (`src/core.js`) : 2 requêtes l'une après l'autre (affectation à la station, puis plafonds de permissions) ;
- contrôle du contrat (`src/server.js` ~133) : `loadContractForUser` = 1 requête (`client_id`, déjà connu de `auth`) + `loadContract` = 3 requêtes (contrat, nombre de stations, nombre d'utilisateurs), toutes séquentielles.
Soit **8 allers-retours avec la base avant même la route.**

| Appel | Avant la route | Dans la route | Total (séquentiel) |
|---|---|---|---|
| `/me/license/status-message` (`src/contracts.js:1717`) | 8 | 7 : recharge le contrat (4, alors que `req.contract` existe déjà), seuils (1), téléphone (1), moyens de paiement (1) ; +1 si licence expirante | **15** |
| `/messaging/unread` (`src/messaging.js:371`) | 8 | 2 : `clientIdOf` (1, alors que `req.user.client_id` existe), requête principale (1) | **10** |
| `/dashboard` (`src/reports.js:24`) | 8 | 14 requêtes lancées **en même temps** + 1 (utilisateurs connectés, si `user.manage`) | **23** |

La connexion à la base (`src/core.js:9`) est `new Pool({ connectionString })` : **10 connexions maximum par défaut, aucun délai ni réglage**. Le front lance au démarrage 5 lectures anticipées (`prefetchBoot`, `public/app.js:1139`) puis 3 appels `/dashboard*` (`public/app.js:391`). Un seul `/dashboard` peut occuper les 10 connexions d'un coup et faire attendre tous les autres appels.

## Mesures sur la base jetable (données générées, un seul poste)
Volumes : 600 000 ventes et paiements, 150 000 dépenses, 400 000 sessions, 40 000 clients, 30 000 quarts, 20 stations.
- Les 15 requêtes du tableau de bord : 28 ms (chaud) à 46 ms (froid) au total sur 30 jours, la plus lente 8 ms ; sur 1 an : environ 0,3 s au total, la plus lente (paiements par mode) 107 ms.
- Requêtes de la chaîne (auth, permissions, comptages) : 0,2 à 1,3 ms chacune.
**Conclusion : le SQL n'explique pas 4 s.** Le temps vient du nombre d'allers-retours, multiplié par la latence réelle entre le serveur et la base, et de la file d'attente sur 10 connexions.

## Hypothèse (non prouvée)
Entre 150 et 250 requêtes SQL au démarrage, servies par 10 connexions : chaque aller-retour de 100 à 250 ms (base éloignée, plan d'hébergement lent ou démarrage à froid) suffit à produire plusieurs secondes d'attente. Latence réelle serveur-base et plan Render : **inconnus** (production injoignable d'ici).

## Corrections possibles (aucune appliquée)
1. `/me/license/status-message` : réutiliser `req.contract` ; lire seuils, téléphone et moyens de paiement en parallèle (−6 allers-retours).
2. Chaîne commune : `loadContractForUser` sans relire `client_id` ; comptages stations et utilisateurs en parallèle ; plafonds de station en parallèle de l'affectation (−3 par appel, sur tous les appels).
3. `/messaging/unread` : utiliser `req.user.client_id` (−1).
4. `/dashboard` : limiter la simultanéité des 14 requêtes (par lots) pour ne pas bloquer le réservoir.
5. Réservoir : taille explicite (variable d'environnement) et délai d'attente de connexion, après vérification du plafond de connexions du plan de base de données.
Risque : 1 à 3 touchent l'authentification, le contrat et les permissions. **Non vérifiables ici** : `express`, `pg` et `jsonwebtoken` ne sont pas installés (npm bloqué), donc le serveur ne démarre pas. Ne pas livrer sans exécution réelle.

## Pour trancher
Mesure en production : durée de chaque appel côté serveur et nombre de requêtes par appel, ou un test local du serveur complet une fois npm débloqué.
