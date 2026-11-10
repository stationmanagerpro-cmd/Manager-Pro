# Étape 47 — Icônes modernes du menu latéral Superadmin

Date : 19 octobre 2026

## Modifications
- Remplacement des icônes emoji du menu latéral Superadmin par des icônes SVG locales : tableau de bord, clients/licences, finance, rôles, accueil d’administration, clés d’accès et packs.
- Icônes monochromes qui héritent de `currentColor`, donc adaptées aux thèmes clair/sombre et à l’état actif du menu.
- Aucun chargement d’icônes externe, aucune modification des permissions, routes ou vues métier.
- Le menu des comptes clients conserve son comportement et ses icônes existantes.
- Ajout d’un test statique reproductible et de la commande `npm run test:superadmin-sidebar-icons-static`.

## Validation exécutée
- `node --check public/ext-shell.js` : réussi.
- Analyse JSON de `package.json` : réussie.
- Test statique Superadmin : résultat enregistré séparément à l’exécution.
- Le test navigateur `test/ui-shell/ui-shell.test.js` n’a pas pu démarrer dans cet environnement car le paquet `playwright` n’est pas installé dans l’environnement de travail.
- Aucun test visuel dans un navigateur réel n’a été effectué.
- Aucun test PostgreSQL n’a été effectué et aucune base de données n’a été modifiée.
