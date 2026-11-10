# Étape 62 — Anti-doublons des alertes e-mail sur 24 heures

## Comportement
- Une même ouverture/fermeture de quart (station, type, numéro de quart) n'est envoyée qu'une fois par fenêtre glissante de 24 h.
- Une anomalie identique pour la même station est envoyée au plus une fois sur 24 h.
- L'empreinte est stockée dans PostgreSQL/Neon : elle survit aux redémarrages et fonctionne entre instances Render.
- La réservation anti-doublon est atomique en base, ce qui limite les doublons en cas d'appels simultanés.
- Si l'envoi SMTP échoue, l'empreinte est libérée pour permettre une nouvelle tentative.
- Une alerte différente (autre quart ou autre description d'anomalie) conserve sa propre empreinte.

## Déploiement
1. Faire une sauvegarde de Neon.
2. Déployer cette version de l'application.
3. Exécuter `npm run migrate` avec `DATABASE_URL` pointant vers la base Neon de production.
4. Vérifier que `email_alert_dedupe` existe dans Neon.
5. Tester deux fois la même alerte : la première doit être envoyée, la seconde doit retourner `duplicate_within_24h`. Après 24 h, une nouvelle occurrence peut être envoyée.

Aucun accès à la base Neon de production ni envoi SMTP réel n'a été effectué dans la préparation de cette archive. Le test livré est statique; le test de bout en bout doit être fait après déploiement.
