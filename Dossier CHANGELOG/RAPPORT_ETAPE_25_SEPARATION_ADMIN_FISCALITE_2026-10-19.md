# Étape 25 — Séparation stricte ADMIN / Fiscalité

## Règle métier confirmée
- L'ADMIN de plateforme gère les contrats, licences et autorisations.
- Il peut autoriser la fonctionnalité Fiscalité au contrat du client, mais ne doit pas utiliser le parcours fiscal opérationnel.
- Le client et les rôles opérationnels explicitement habilités utilisent les fonctions fiscales dans le périmètre de leur contrat et de leur station.

## Modifications
- `migrations/057_fiscal_access_permission.sql` crée la permission sans la donner automatiquement au rôle `ADMIN`.
- `migrations/058_fiscalite_admin_platform_only.sql` retire la permission `fiscal.access` du rôle `ADMIN` si elle lui avait déjà été attribuée.
- `scripts/diagnose-fiscal.js` vérifie maintenant que le rôle `ADMIN` n'a pas d'accès opérationnel et considère cette attribution comme une anomalie.
- `src/server.js` inclut la migration 058 dans la vérification de préparation du module fiscal.
- Tests statiques mis à jour pour protéger la règle.

## Tests exécutés
- `node test/fiscal-access-c1-static.js` — 11 assertions OK.
- `node test/fiscal-diagnostic-script-static.js` — 10 assertions OK.
- `node test/fiscal-schema-readiness-static.js` — 14 assertions OK.
- `node --check` sur `src/fiscal.js`, `scripts/diagnose-fiscal.js`, `public/app.js` et `public/ext-fiscal.js` — OK.

## Important
Les tests ci-dessus sont des tests statiques locaux ; ils ne prouvent pas que la migration 058 a été appliquée à la base réelle. Après sauvegarde, appliquer les migrations selon la procédure habituelle, puis relancer `npm.cmd run diagnose:fiscal`. Le diagnostic doit afficher `Rôle ADMIN sans accès opérationnel Fiscalité : OK` et l'historique doit inclure `058_fiscalite_admin_platform_only.sql`.
