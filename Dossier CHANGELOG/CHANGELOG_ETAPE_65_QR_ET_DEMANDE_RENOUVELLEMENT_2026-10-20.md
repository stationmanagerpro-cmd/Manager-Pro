# Étape 65 — QR de paiement et demande de renouvellement

- Correction du stockage des QR et détails de paiement : utilisation de `app_settings`, table prévue pour les réglages globaux avec clé primaire `key` et valeur JSONB.
- Lecture uniforme de la configuration dans l'écran Abonnement et l'écran plein écran d'abonnement expiré.
- Le compte administrateur local d'un client peut envoyer sa demande de renouvellement au Superadmin même si le module Messagerie n'est pas inclus, et même lorsque la licence est expirée/suspendue.
- Cette exception est limitée à la route de contact support pour renouvellement. Les employés ne peuvent pas initier ce contact ; leurs droits de messagerie métier restent soumis aux modules et autorisations du Superadmin.
- Validation statique uniquement ; aucun test de bout en bout avec Neon/Render n'a été réalisé.
