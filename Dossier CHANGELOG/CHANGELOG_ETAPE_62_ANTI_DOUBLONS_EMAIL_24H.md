# Étape 62 — Anti-doublons e-mail 24 h

- Ajout d'une table PostgreSQL persistante `email_alert_dedupe`.
- Blocage atomique des empreintes identiques pendant 24 heures.
- Clés stables pour les événements d'ouverture/fermeture de quart et les anomalies.
- Libération de l'empreinte si l'envoi SMTP échoue, pour ne pas bloquer les nouvelles tentatives.
- Documentation de migration et de vérification post-déploiement.
