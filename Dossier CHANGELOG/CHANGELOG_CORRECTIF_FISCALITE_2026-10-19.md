# Correctif — accès au module Fiscalité

**Date :** 19 octobre 2026

## Cause identifiée dans le code

La sauvegarde des autorisations fiscales pouvait activer un ou plusieurs sous-modules (`fiscal_tva`, `fiscal_is`, etc.) sans activer le drapeau global `can_access_fiscal` / `modules.fiscal`. Le contrôle d'accès de l'interface et celui de l'API vérifient d'abord cet accès global ; l'utilisateur pouvait donc être refusé malgré l'activation d'autorisations fiscales détaillées.

## Correctif appliqué

- `src/contracts.js` : normalisation des contrats existants ; si au moins un sous-module `fiscal_*` est actif, les indicateurs globaux `can_access_fiscal` et `modules.fiscal` sont synchronisés à `true`.
- `src/fiscal.js` : lors de l'enregistrement des autorisations par le Superadmin, l'activation d'un sous-module active aussi l'accès global.
- `test/fiscal-submodule-access-static.js` : test statique de non-régression.
- `package.json` : ajout de `npm run test:fiscal-access`.

## Vérifications effectuées

- `node --check src/contracts.js` : OK
- `node --check src/fiscal.js` : OK
- `node test/fiscal-submodule-access-static.js` : OK

## Limites

Le correctif est validé statiquement. Le test d'intégration avec PostgreSQL et une session réelle Superadmin/client reste à effectuer dans l'environnement de l'application. Les autres fiches du cahier des charges n'ont pas été présentées comme corrigées par ce correctif ciblé.
