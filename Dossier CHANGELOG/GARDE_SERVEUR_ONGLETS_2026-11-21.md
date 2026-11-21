# Garde serveur des onglets du compte client — 2026-11-21

## Problème
Les options `view_<onglet>` ajoutées par les commits distants (1b572b3 → origin/main) n'étaient contrôlées que par l'interface : un compte dont un onglet était coupé ne le voyait plus, mais pouvait appeler l'API directement.

## Changement
- `src/server.js` : table `VIEW_GUARDS` dans le contrôle de contrat existant. Chaque route propre à un onglet renvoie 403 `FEATURE_DISABLED` (avec `feature: view_<onglet>`) si l'option est à faux pour le compte client. Une clé absente reste autorisée, comme dans le front.
- Routes gardées (20 motifs, 18 onglets) : risque, verrouillage de période, règles de notification, espace client (liens portail), flotte (cartes), commissions Mobile Money, contrôles financiers (historique commissions, événements résumé, intégrité caisse), événements financiers, résultat et marge, rapprochement, archivage mensuel, imports, historique compteurs, prévisions, transferts de stock, bons de commande, rôles de diffusion, carte des stations.
- `test/contract-onglets-static.js` : contrôle statique de la table (7/7).

## Non gardé volontairement (routes partagées)
Ces routes servent aussi la caisse ou d'autres écrans. Les garder casserait l'application pour les clients qui gardent l'onglet :
- `/money/accounts`, `/money/recent`, `/money/movements` (trésorerie et caisse)
- `/treasury/*` (utilisé aussi par les écrans de direction)
- `/prices/*` (fiche produit)
- `/invoices/*` (dettes fournisseurs)
- `/seller-commissions/*` (saisies d'entrées de commission)
- `/messaging/alert-config` (modal aussi ouvert depuis la messagerie)
- `/loyalty/*` (fidélité au point de vente)
- `/stations/*`, `/dashboard/*`, `/aggregates`, `/pumps`, `/products`, `/customers`
Décision à prendre : traiter ces routes avec un contrôle de module ou accepter le risque résiduel.

## Vérification
- Syntaxe `node --check src/server.js` : OK.
- Motifs de la table : 18 cas de chemins testés (corrects).
- Test statique `test/contract-onglets-static.js` : 7/7.
- Non vérifié : exécution avec un compte client réel (serveur non démarrable dans cette session).
- Aucune modification du front : service worker non régénéré.
