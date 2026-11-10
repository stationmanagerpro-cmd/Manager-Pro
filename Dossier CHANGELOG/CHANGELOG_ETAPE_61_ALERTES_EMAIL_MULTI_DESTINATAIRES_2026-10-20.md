# Étape 61 — Alertes e-mail multi-destinataires

- Ajout de `services/emailService.js` conforme à l'architecture du guide fourni.
- Réutilisation du transport Nodemailer déjà présent dans `src/mailer.js` et de sa configuration SMTP.
- Envoi best-effort après ouverture/fermeture de quart, signalement d'incident et écart de caisse.
- Ajout d'un test statique dédié et d'une documentation Render.
- Tests exécutés : syntaxe JavaScript de `src/shifts.js` et du service; test alertes e-mail (7 contrôles); test catégories (9 contrôles); test stockage Neon (9 contrôles).
- Pas de test SMTP réel effectué; les variables d'environnement et la réception doivent être vérifiées après déploiement.
