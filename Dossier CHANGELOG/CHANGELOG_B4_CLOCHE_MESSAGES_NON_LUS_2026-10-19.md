# Étape 30 — Fiche B4 : ouvrir les messages non lus depuis la cloche

## Constat

La cloche comptait les messages non lus et des toasts étaient affichés périodiquement, mais un clic sur la cloche côté client redirigeait directement vers le centre d'alertes. La cloche ne permettait donc pas de consulter directement la file de messages non lus demandée par le cahier des charges.

## Correction

- Le clic sur la cloche demande maintenant `/messaging/unread` pour les rôles autorisés.
- Une liste affiche expéditeur, conversation, aperçu et date ; l'action « Ouvrir » va dans la messagerie et ouvre la conversation correspondante.
- Le Superadmin conserve une section distincte pour les demandes de renouvellement de licence.
- Les contenus affichés issus des messages sont échappés côté interface.
- L'API existante conserve l'appartenance à la conversation et le filtrage par client ; le Superadmin reste limité aux conversations de support.

## Tests réalisés

- `node --check public/ext-shell.js` : OK.
- `node test/messaging-bell-opens-unread-static.js` : 8/8.
- `node test/messaging-unread-notifications-static.js` : 13/13.
- `node test/messaging-support-title-static.js` : 10/10.

## Limites

Tests statiques seulement. Le clic réel dans le navigateur, les droits de deux clients distincts et la navigation vers une conversation doivent encore être validés sur une instance de test connectée à PostgreSQL.
