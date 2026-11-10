# Étape 61 — Module d'alertes e-mail multi-destinataires

Cette mise à jour suit le guide « Module Alertes Email Manager-Pro ».

## Fonctionnalités
- Nouveau service `services/emailService.js` avec `sendAlertEmail`, `notifyQuartEvent` et `notifyAnomalie`.
- Destinataires multiples dans `ADMIN_EMAIL` et dans le paramètre de destinataires personnalisés (virgules, points-virgules ou espaces), avec déduplication et validation basique des adresses.
- Alertes e-mail déclenchées après ouverture/fermeture d'un quart, signalement d'un incident et détection d'un écart de caisse à la clôture.
- Un échec d'envoi e-mail est journalisé sans annuler une opération métier déjà enregistrée.
- Réutilisation de Nodemailer et du service SMTP existant (`src/mailer.js`).

## Configuration Render
Ajouter dans Environment :
- `SMTP_HOST` : hôte SMTP fourni par votre service e-mail.
- `SMTP_PORT` : généralement `587` (ou `465` si TLS implicite est requis).
- `SMTP_USER` : compte SMTP expéditeur.
- `SMTP_PASS` : mot de passe ou mot de passe d'application SMTP.
- `MAIL_FROM` (facultatif) : adresse expéditeur affichée.
- `ADMIN_EMAIL` : destinataires séparés par des virgules, par exemple `admin@example.com,gerant@example.com`.

Ne pas publier ces secrets dans le dépôt Git ni dans les journaux. `MAIL_MODE=json` sert uniquement à simuler l'envoi; il ne livre pas de vrais e-mails.

## Déploiement et vérification
1. Déployer la version mise à jour sur Render.
2. Renseigner les variables SMTP et `ADMIN_EMAIL` dans Render, puis redémarrer le service.
3. Ouvrir un quart de test, signaler un incident, puis clôturer un quart avec un écart contrôlé.
4. Vérifier la réception auprès de chaque destinataire et les logs Render en cas d'échec.
5. Exécuter `npm run test:email-alerts-static` pour les assertions statiques.

## Limites connues
Cette étape branche les e-mails sur les événements de quarts et les anomalies de caisse/incidents. Elle ne branche pas encore un envoi périodique dédié aux alertes de stock/carburant ni une notification générique des erreurs internes du serveur : ces événements nécessitent une politique anti-doublons et un seuil de criticité explicites pour éviter les rafales d'e-mails. Les tests statiques ne remplacent pas un test SMTP réel.
