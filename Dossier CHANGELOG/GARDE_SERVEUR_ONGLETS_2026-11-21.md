# Garde serveur des onglets du compte client — 2026-11-21

## Problème
Les options `view_<onglet>` ajoutées par les commits distants (1b572b3 → origin/main) n'étaient contrôlées que par l'interface : un compte dont un onglet était coupé ne le voyait plus, mais pouvait appeler l'API directement.

## Changement
- `src/server.js` : table `VIEW_GUARDS` dans le contrôle de contrat existant. Chaque route propre à un onglet renvoie 403 `FEATURE_DISABLED` (avec `feature: view_<onglet>`) si l'option est à faux pour le compte client. Une clé absente reste autorisée, comme dans le front.
- Routes gardées (28 motifs, 23 onglets) : risque, verrouillage de période, règles de notification, espace client (liens portail), flotte (cartes), commissions Mobile Money, contrôles financiers (historique commissions, événements résumé, intégrité caisse), événements financiers, résultat et marge, rapprochement, archivage mensuel, imports, historique compteurs, prévisions, transferts de stock, bons de commande, rôles de diffusion, carte des stations ; vue consolidée et vue par station (routes propres) ; prix du jour (`/prices/board`) ; vendeurs et commissions (`/seller-commissions/*`) ; fidélité (gestion : `/loyalty/accounts`, `/loyalty/lookup`, `/loyalty/earn`).
- `test/contract-onglets-static.js` : contrôle statique de la table (7/7).

## Non gardé volontairement (routes partagées avec des écrans de base)
Ces routes servent aussi la caisse, le portail client ou des tableaux de bord. Les garder casserait l'application pour les clients qui gardent l'onglet :
- `/money/accounts` (caisse, `app.js`), `/money/recent`, `/money/movements` (`ext-fin.js`)
- `/treasury/*` (synthèse de direction)
- `/invoices/*` (portail client `espace-client.js`, facturation)
- `/stations/overview` (magasins, multistation)
- `/dashboard/config`, `/dashboard/jour`, `/aggregates` (tableaux de bord)
- `/messaging/alert-config` (modal aussi ouvert depuis la messagerie)
- `/loyalty/settings` (lu à chaque vente en caisse)
- `/products/*/prices`, `/pumps`, `/products`, `/customers` (fiche produit, caisse)
Décision à prendre : contrôle de module dédié ou risque accepté.

## Vérification
- Syntaxe `node --check src/server.js` : OK.
- Motifs de la table : 18 cas de chemins testés (corrects).
- Test statique `test/contract-onglets-static.js` : 7/7.
- Non vérifié : exécution avec un compte client réel (serveur non démarrable dans cette session).
- Aucune modification du front : service worker non régénéré.
