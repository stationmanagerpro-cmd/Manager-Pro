# Étape 16 — Fiche B5 : contrôle du contact SuperAdmin
Date : 2026-10-19

## Exigence du cahier des charges
Les utilisateurs simples d'un compte client ne doivent pas pouvoir écrire au SuperAdmin. Le bouton « Contacter le SuperAdmin » doit être masqué pour eux et la requête doit être refusée côté serveur. L'interprétation appliquée est que le rôle technique `ADMIN` est l'administrateur local du compte client. Le cahier des charges indique explicitement que cette interprétation est à confirmer.

## Modifications
- `public/ext-messaging.js` : le bouton « Contacter le SuperAdmin » est affiché uniquement si l'utilisateur est un compte client dont `ME.role === 'ADMIN'`, et si la fonctionnalité de support ou de messagerie est autorisée par le contrat.
- `src/messaging.js` : la route `POST /messaging/support/to-admin` rejette côté serveur tout compte client dont le rôle n'est pas `ADMIN`, avec HTTP 403 et le code `LOCAL_ADMIN_REQUIRED`. Ce contrôle est indépendant du masquage de l'interface.
- `test/messaging-superadmin-contact-role-static.js` : ajout de 9 contrôles statiques couvrant la règle côté interface et serveur et la préservation de l'endpoint de renouvellement.
- `package.json` : ajout du script `test:messaging-superadmin-contact-role`.

## Vérifications exécutées
- Syntaxe `src/messaging.js` et `public/ext-messaging.js` : OK.
- Test B5 : 9/9.
- Notifications non lues : 13/13.
- Recherche des destinataires : 10/10.
- Mode sombre : 9/9.
- Sécurité des pièces jointes : 7/7.
- Contrôles statiques rôles/messagerie : 10/10.
- Analyse JSON de `package.json` : OK.
- Vérification statique de présence de la route de demande de renouvellement : OK.

## Limites
Ces tests sont statiques et syntaxiques ; ils ne remplacent pas un test HTTP d'intégration avec une base PostgreSQL et des sessions utilisateur. La règle repose sur le code de rôle `ADMIN` comme identifiant de l'administrateur local, conformément à l'interprétation du cahier des charges qui reste à confirmer. L'endpoint de demande de renouvellement n'a pas été modifié.
