# Modernisation — Phase C (13 oct. 2026)

## Digests & rapports automatiques

1. **Digest e-mail enrichi** (`POST /notifications/email-digest`)
   - KPI du jour (ventes, carburant, litres, dépenses, quarts ouverts)
   - + liste d’alertes (ou message « aucune alerte »)
   - Envoi même sans alerte (utile pour le suivi direction)

2. **Fréquence `daily`** dans le planificateur de rapports
   - `nextRun` + validation schéma

3. **Preset one-click** `POST /messaging/report-schedules/preset-direction`
   - Digest direction quotidien à 20:00
   - Canal app et/ou e-mail selon destinataires fournis
   - Nécessite feature contrat `can_use_auto_alerts`

4. **UI Pilotage direction**
   - « Envoyer digest e-mail »
   - « Programmer digest 20h »

## Prérequis serveur
- SMTP configuré (`SMTP_HOST` / `MAIL_MODE`) pour l’e-mail
- Planificateur : `startScheduler` dans scheduled_reports (déjà branché si `ALERTS_AUTO` ≠ 0)
