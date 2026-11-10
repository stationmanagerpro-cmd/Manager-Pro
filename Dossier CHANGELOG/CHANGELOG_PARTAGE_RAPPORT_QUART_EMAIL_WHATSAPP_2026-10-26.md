# Rapport de quart clôturé : envoi par e-mail et partage WhatsApp (2026-10-26)

Fonctionnalité décrite dans le rapport du 24/10/2026, absente de la v11 : développée ici.

## Serveur (src/finance.js)
- Le PDF du quart est produit par une seule fonction (`shiftReport`), utilisée par le téléchargement `GET /shifts/:id/report.pdf` (inchangé) et par l'envoi e-mail.
- `GET /shifts/:id/report-contacts` : coordonnées des employés concernés (affectés au quart OU ayant des ventes valides sur ce quart, station courante uniquement, sans limite de 200 ventes), de la personne qui a clôturé (fiche employé liée au compte), de la station, et message WhatsApp prêt (dates, carburant, autres ventes, compteurs, paiements, caisse théorique/comptée/écart, justification, observations).
- `POST /shifts/:id/report-email` `{ mode: 'employees' | 'closer' }` : un e-mail par destinataire avec le PDF en pièce jointe (`application/pdf`).
  - Adresses invalides ignorées, doublons supprimés.
  - Repli sur l'e-mail de la station (Paramètres > Station) seulement si aucune adresse individuelle n'est disponible ; sinon erreur 422 explicite.
  - SMTP non configuré : erreur 501 explicite ; échec partiel : succès et échecs listés.
  - Chaque envoi est inscrit dans le journal d'audit.
- Permissions : `shift.close` ou `report.view`.

## Interface (public/app.js, page « Rapport de quart »)
- Boutons : « PDF par e-mail aux employés », « PDF par e-mail au clôturant » (avec confirmation), « WhatsApp employés », « WhatsApp clôturant ».
- WhatsApp : fenêtre listant chaque personne avec un lien `wa.me` au message prérempli. L'utilisateur confirme l'envoi dans WhatsApp ; aucun envoi automatique. Numéros attendus avec indicatif pays (≥ 10 chiffres) ; sinon « numéro sans indicatif pays » ou « pas de numéro ». Pour le clôturant sans numéro valide : numéro de l'entreprise.

## Tests
- `npm run test:shift-report-share` : 11 contrôles d'exécution (base, Express et e-mail simulés ; le vrai code de finance.js est exécuté) + 9 contrôles statiques.
- Suite sans base : 89 scripts, tous réussis. Cache PWA `smp-static-v55`. Aucune migration.

## Non validé (à faire sur le PC)
- Envoi SMTP réel (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM dans .env) et réception du PDF.
- Exécution sur PostgreSQL (les requêtes sont relues, pas exécutées) et test des liens WhatsApp sur Android.
- Renseigner l'e-mail et le téléphone de la station, et l'e-mail / le numéro WhatsApp (avec indicatif) de chaque employé.
