# Étape 18 — Fiche C1 : « La Fiscalité » et contrôle des autorisations

Date : 19 octobre 2026

## Changements réalisés

- Création d'une rubrique de navigation indépendante nommée « La Fiscalité » ; les vues fiscales ne sont plus rangées sous « Finance & rapports ».
- Le menu et le parcours fiscal côté navigateur exigent désormais à la fois la permission de rôle `fiscal.access` et une autorisation fiscale au contrat (ou un contrat explicitement sans restriction).
- Ajout d'un contrôle côté serveur dans `requireFiscalAccess` : les appels aux routes opérationnelles fiscales sont refusés en HTTP 403 si le rôle ne possède pas `fiscal.access`, même si l'utilisateur tente une URL/API directe.
- Ajout de la migration idempotente `057_fiscal_access_permission.sql`, qui crée la permission et la donne au rôle `ADMIN`. L'administrateur du compte pourra ensuite la déléguer aux rôles voulus via la gestion des rôles. Le contrat fiscal reste un deuxième verrou indépendant.
- Ajout du test statique `test/fiscal-access-c1-static.js` et de la commande `npm run test:fiscal-access-c1`.

## Vérifications exécutées

- `node --check src/fiscal.js` : réussi.
- `node --check public/app.js` : réussi.
- `node --check public/ext-shell.js` : réussi.
- `node --check public/ext-fiscal.js` : réussi.
- `node --check test/fiscal-access-c1-static.js` : réussi.
- `node test/fiscal-access-c1-static.js` : 8 assertions réussies.
- `node test/fiscal-frontend-submodule-access-static.js` : réussi.
- `node test/fiscal-submodule-access-static.js` : réussi.
- `package.json` : JSON valide.

## Limites connues

Les vérifications sont statiques et syntaxiques. La migration 057 n'a pas été appliquée à une base PostgreSQL réelle dans cet environnement et les parcours n'ont pas été testés dans un navigateur connecté. Appliquer les migrations du projet avant de vérifier les rôles sur l'installation réelle.
