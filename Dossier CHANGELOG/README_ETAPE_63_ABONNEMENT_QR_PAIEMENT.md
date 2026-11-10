# Étape 63 — Abonnement client et QR de paiement

## Changements
- Ajout d'une page **Abonnement** dans les vues de l'application : état, date d'échéance, jours restants, détails et formulaire de demande de renouvellement.
- Écran plein écran d'abonnement expiré/suspendu : affichage des QR marchand SARALI ORANGE et Malitel et des détails configurés.
- Configuration sous **Autres** dans le menu Superadmin : QR Orange, QR Malitel et texte détaillé.
- Configuration stockée dans `settings` de PostgreSQL/Neon, sans nouvelle migration SQL.
- Les QR peuvent être fournis par URL HTTPS ou importés en PNG/JPEG/WebP (1 Mo maximum par image). Le texte est limité à 5 000 caractères.
- Les routes d'administration sont protégées par `needPrincipal`; les comptes clients ne peuvent que consulter les informations et soumettre une demande de renouvellement.

## Déploiement
1. Sauvegarder la base Neon.
2. Déployer le code de cette archive sur Render. Aucune migration supplémentaire n'est nécessaire.
3. Se connecter en Superadmin, ouvrir **Autres → Abonnement**, configurer les deux QR et les détails, puis enregistrer.
4. Tester avec un compte client actif (page Abonnement) et un compte de test expiré (écran plein écran).
5. Vérifier que le client peut soumettre une demande avant expiration et que l'écran expiré continue à permettre le contact / renouvellement.

## Contrôles et limites
Les contrôles statiques vérifient les routes, les contrôles d'accès et la présence des interfaces. Ils ne remplacent pas un test réel sur Neon/Render. Aucun paiement n'est confirmé automatiquement par un scan QR : la demande reste une demande de renouvellement qui doit être traitée par le Superadmin. Les QR importés sont stockés dans la valeur de configuration en base ; garder les images sous 1 Mo chacune.
