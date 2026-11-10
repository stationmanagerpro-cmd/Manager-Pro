# Étape 23 — Diagnostic de disponibilité du module Fiscalité

**Date :** 19 octobre 2026

## Constat du code

- Le module possède un routeur API monté dans `src/server.js`, une interface chargée par `public/index.html`, et des migrations dédiées (`046`, `047`, `048`, `049`, `050`, `057`).
- L'accès opérationnel dépend simultanément de l'appartenance à un compte client, de la permission `fiscal.access`, des autorisations de contrat et de la présence des tables fiscales.
- Les vérifications précédentes sur le code ne prouvaient pas que ces migrations avaient été appliquées à la base réellement utilisée.
- Une connexion PostgreSQL réelle et un parcours authentifié ne peuvent pas être certifiés dans cet environnement. Le dernier diagnostic local rapporté précédemment échouait sur `client password must be a string`; aucune migration n'est donc déclarée appliquée à la base de l'utilisateur sur la seule base de tests statiques.

## Modification de cette étape

Au démarrage, le serveur vérifie désormais la présence des tables essentielles du module Fiscalité, l'historique `schema_migrations` pour les migrations `046`, `050`, `057`, ainsi que la permission `fiscal.access`. Les problèmes détectés produisent des avertissements ciblés dans la console du serveur au lieu de rester invisibles derrière des erreurs API génériques.

Le mécanisme de migration existant conserve son arrêt de sécurité lorsqu'une base contient déjà des stations mais aucun historique de migrations. Le diagnostic n'applique aucune migration automatiquement et ne modifie aucune donnée métier.

## Tests effectués

- `node --check src/server.js` : OK
- `node --check src/fiscal.js` : OK
- `node test/fiscal-schema-readiness-static.js` : 14 assertions OK
- `node test/fiscal-submodule-access-static.js` : OK
- `node test/fiscal-frontend-submodule-access-static.js` : OK
- `node test/fiscal-access-c1-static.js` : 8 assertions OK
- `package.json` : JSON valide

## Limite / prochaine action nécessaire

Cette étape améliore le diagnostic, mais **ne prétend pas prouver que la Fiscalité fonctionne sur la base réelle**. Il faut corriger la connexion `DATABASE_URL` (le mot de passe doit être une chaîne non vide), vérifier la base cible, effectuer une sauvegarde, puis lancer `npm.cmd run migrate` depuis `C:\StationManagerPro`. Les avertissements au démarrage permettront ensuite d'identifier précisément les tables/migrations/permissions manquantes. Après cela, il faudra tester les parcours avec un compte client réel et un contrat qui autorise le module.
