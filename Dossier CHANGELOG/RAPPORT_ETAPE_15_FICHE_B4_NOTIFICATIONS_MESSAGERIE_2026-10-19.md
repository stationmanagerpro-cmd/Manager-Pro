# Rapport d’avancement — Étape 15 / Fiche B4

Date : 19 octobre 2026
Projet : Station Manager Pro V1
Source fonctionnelle : Cahier des charges, fiche B4 « Notifications : messages non lus déclenchés par la cloche ».

## Résultat attendu de la fiche
- Les messages reçus non lus sont signalés par la cloche.
- Ils s’affichent en notifications flottantes non bloquantes, du plus ancien au plus récent.
- Deux affichages successifs sont espacés d’au moins cinq minutes.
- Un clic ouvre la conversation concernée.
- Les messages lus sont retirés de la file de notifications.

## Modifications
- `src/messaging.js` : ajout de `GET /messaging/unread`. La route exige la messagerie autorisée, ne renvoie que les conversations dont l’utilisateur est membre, filtre par `client_id` pour les comptes clients et limite le Superadmin aux conversations de support dont il est membre. Les messages sont triés par date puis identifiant croissants et les messages lus sont exclus.
- `public/ext-shell.js` : ajout d’une file de notifications flottantes; intervalle minimal de cinq minutes entre deux affichages; aperçu de l’expéditeur et du message; clic ouvrant la vue Messagerie puis la conversation; purge des messages lus lors du rafraîchissement. La pastille de la cloche additionne les notifications existantes et les messages non lus retournés par la route.
- `public/ext-shell.css` : styles adaptés aux variables du thème clair/sombre, contrôle de fermeture, focus clavier et respect de `prefers-reduced-motion`.
- `test/messaging-unread-notifications-static.js` : 13 contrôles statiques.
- `package.json` : ajout de `npm run test:messaging-unread-notifications`.

## Vérifications réellement exécutées
- `node --check src/messaging.js` : réussi.
- `node --check public/ext-shell.js` : réussi.
- `node --check public/ext-messaging.js` : réussi.
- `node test/messaging-unread-notifications-static.js` : 13/13.
- `node test/messaging-recipient-search-static.js` : 10/10.
- `node test/messaging-dark-mode-static.js` : 9/9.
- `node test/messaging-attachment-security-static.js` : 7/7.
- `node test/roles-messaging-static.js` : 10/10.
- Lecture JSON de `package.json` : réussie.

## Limites et suite
Ces vérifications sont statiques et de syntaxe. La file n’a pas été testée dans un navigateur avec plusieurs utilisateurs et une base PostgreSQL réelle. Il reste à valider en intégration les délais réels, la fermeture des toasts, la mise à jour après lecture dans un autre onglet et le comportement du Superadmin avec plusieurs conversations de support. L’endpoint renvoie jusqu’à 100 messages non lus par appel; il peut être nécessaire d’ajouter une pagination si des comptes accumulent un volume supérieur.
