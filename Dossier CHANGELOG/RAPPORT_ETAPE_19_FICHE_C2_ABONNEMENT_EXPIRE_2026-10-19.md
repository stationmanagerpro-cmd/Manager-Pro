# Rapport — Étape 19 — Fiche C2 : écran d’abonnement expiré

Date : 19 octobre 2026

## Changements
- Ajout d’un écran plein écran dédié lorsque le statut de licence est `EXPIREE` ou `SUSPENDUE`, avec le message demandé dans le cahier des charges.
- Tous les utilisateurs du compte voient la consigne; seul le rôle local `ADMIN` dispose du formulaire « Nous contacter ».
- Formulaire : objet « Demande d’abonnement », message et durée souhaitée (1/3/6 mois, 1/2 ans ou indéfinie).
- Envoi de la demande au suivi de renouvellement (`/me/license/renewal-request`) et du message via la messagerie interne (`/messaging/support/to-admin`). Les demandes en attente existantes n’empêchent pas l’envoi du message support.
- Exception serveur strictement limitée à l’ADMIN local et à la route support dédiée pendant une licence suspendue/expirée; les autres routes métier restent bloquées.
- Numéro du SuperAdmin fourni par le paramètre global `settings.key = 'superadmin_phone'` (`station_id IS NULL`) ou par la variable d’environnement `SUPERADMIN_PHONE`; le lien `tel:` est cliquable sur mobile.
- Nettoyage de l’écran dédié lors d’une nouvelle initialisation de session et affichage aussi si un appel API reçoit `LICENSE_EXPIRED`.

## Vérifications exécutées
- `node --check src/server.js` — réussi
- `node --check src/contracts.js` — réussi
- `node --check src/messaging.js` — réussi
- `node --check public/app.js` — réussi
- `node --check public/ext-contracts.js` — réussi
- `node --check test/step18-expired-subscription-screen-static.js` — réussi
- `node test/step18-expired-subscription-screen-static.js` — 12/12 vérifications réussies

## Limites
Tests statiques/syntaxiques uniquement. Aucune connexion à PostgreSQL, aucun test navigateur et aucun envoi réel de messagerie n’ont été exécutés. Pour afficher le numéro, définir `superadmin_phone` dans les paramètres globaux ou `SUPERADMIN_PHONE` dans l’environnement serveur.
