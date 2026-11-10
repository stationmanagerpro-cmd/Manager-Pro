# Station Manager Pro — Rapport étape 2 : contrôle centralisé des modules contractuels

Date : 12 octobre 2026

## Objectif


## Changements apportés

- `src/server.js` : ajout d'un contrôle centralisé des modules `sales` et `stock` pour les espaces API concernés.
- Le contrôle Finance couvre désormais explicitement les préfixes `/cash` et `/expenses`, ainsi que les routes de paiement client `/customers/:id/payments`, en plus de `/finance` et `/money`.
- Les contrôles RH et Rapports conservent leurs vérifications existantes, avec une réponse d'erreur structurée (`code: FEATURE_DISABLED`, `feature`) pour faciliter l'interface utilisateur.
- Ajout de `test/contract-module-gates-static.js` et de la commande `npm run test:contract-module-gates`.

## Périmètre des routes concernées

- Ventes : `/sales`, `/shifts`, `/customers`.
- Stocks/Achats : `/stock`, `/products`, `/pumps`, `/purchases`, `/suppliers`.
- Finance : `/finance`, `/money`, `/cash`, `/expenses`, `/customers/:id/payments`.
- RH : `/hr`.
- Rapports : `/reports`.

Le contrôle utilise `featureOn()` et les drapeaux du contrat déjà existants. Les comptes Super Admin non limités par contrat ne sont pas soumis à ces restrictions.

## Tests réellement exécutés

- `node --check` sur les fichiers JavaScript des dossiers `src`, `test` et `scripts` : réussite.
- `node test/contract-module-gates-static.js` : 8 contrôles statiques réussis.
- `node test/migration-safety-static.js` : 7 contrôles statiques réussis.
- `node test/detail-pages-static.js` : 19 contrôles statiques réussis.
- `node test/platform-unit.js` : tests unitaires affichés comme réussis.
- `package.json` analysé comme JSON valide.

## Limites connues

- Aucun test HTTP d'intégration n'a été exécuté : les dépendances npm ne sont pas installées dans l'environnement de travail (`node_modules` absent).
- Aucun test navigateur réel n'a été exécuté.
- La validation statique confirme la présence des garde-fous dans le code, pas le comportement de toutes les combinaisons de rôles, contrats et stations.
- La liste de routes est une cartographie prudente des préfixes existants. Elle doit être confirmée par des tests d'intégration avec des contrats dont les modules sont explicitement désactivés avant toute mise en production.

## Risque et recommandation

Le nouveau contrôle peut volontairement refuser des espaces API si le contrat désactive leur module, même si le rôle utilisateur détient la permission correspondante. C'est le comportement attendu pour faire respecter le contrat. Avant déploiement, vérifier en base de test les contrats anciens, notamment ceux dont `features` est partiel ou nul, et tester chaque route métier autorisée/interdite.

## Production

