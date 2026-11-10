# Rapport — Étape 31 — C2 : message d’expiration configurable

Date : 19 octobre 2026

## Correction
L’API `/me/license/status-message` renvoyait déjà un message d’expiration configurable, mais l’écran C2 n’affichait que son texte fixe. L’écran conserve maintenant le texte obligatoire du cahier des charges et affiche également le message configuré par le serveur lorsqu’il existe. Ce contenu passe par `esc()` avant son insertion dans le HTML.

## Vérifications exécutées
- `node --check public/ext-contracts.js` — réussi
- `node --check test/step18-expired-subscription-screen-static.js` — réussi
- `node --check src/contracts.js` — réussi
- `node --check src/messaging.js` — réussi
- `node --check src/server.js` — réussi
- `node --check public/app.js` — réussi
- Test C2 — 13/13 contrôles statiques réussis
- Rôle contact Superadmin — 9/9
- Titre support — 10/10
- Notifications non lues — 13/13
- Clic de cloche — 8/8

## Limites
Ces vérifications sont statiques et syntaxiques. Aucun test navigateur, aucune demande réelle de renouvellement, aucun envoi réel de message et aucune validation d’intégration PostgreSQL n’ont été effectués. Cette étape ne modifie pas la base de données et n’applique aucune migration.
