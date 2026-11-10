# Étape 33 — Revue statique des permissions et des préférences visuelles

Date : 19 octobre 2026
Base de travail : archive de l'étape 32.

## Contrôles exécutés

- `test/roles-messaging-static.js` : 10/10 contrôles.
- `test/fiscal-submodule-access-static.js` : réussi.
- `test/fiscal-frontend-submodule-access-static.js` : réussi.
- `test/fiscal-access-c1-static.js` : 11 assertions réussies.
- `test/step22-maintenance-permissions-static.js` : réussi.
- `test/access-keys-unit.js` : 8/8 tests.
- `test/performance-motion-static.js` : 12/12 contrôles.

## Limite de test

`test/branding-permissions.js` a été identifié comme test nécessitant des arguments `admin` et `password`; il n'a pas été exécuté sans identifiants de test appropriés. Aucun test d'API authentifié, navigateur réel ou intégration PostgreSQL n'a été exécuté lors de cette étape. Les résultats ci-dessus sont des vérifications statiques/unitaires locales et ne constituent pas une certification de sécurité en production.

## Conclusion

Les contrôles existants couvrent statiquement la séparation SUPERADMIN/ADMIN, la restriction des rôles personnalisés au client propriétaire, les accès frontend/backend des sous-modules fiscaux, certaines permissions de maintenance, le mécanisme de clés d'accès et la réduction des animations. Les parcours directs non autorisés, l'isolation entre deux clients en base, ainsi que les vues clair/sombre et la caisse en navigateur restent à tester en environnement de recette.
