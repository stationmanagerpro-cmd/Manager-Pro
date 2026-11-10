# Rapport — Étape 15 : centre de suivi des alertes

Date : 2026-10-12

## Objectif

Permettre aux responsables autorisés du compte client de consulter les alertes automatiques qui leur sont destinées, de les prendre en charge, puis de les marquer comme résolues avec une note facultative.

## Modifications

- Ajout de `migrations/035_alert_lifecycle.sql` (migration additive) : statut `open` / `acknowledged` / `resolved`, horodatages et utilisateurs de prise en charge/résolution, note de résolution, index de consultation.
- Ajout de `GET /api/messaging/system-alerts` : liste des alertes du compte courant auxquelles l'utilisateur est membre destinataire; filtre facultatif par statut et limite bornée.
- Ajout de `PATCH /api/messaging/system-alerts/:id` : prise en charge ou résolution; validation du corps, vérification du client, du statut, de l'appartenance à la conversation et journalisation.
- Le centre est refusé aux comptes Super Admin globaux via cette route client. L'accès nécessite une permission `settings.edit` ou `user.manage`, le contrat actif et le module `can_use_auto_alerts` / `module:auto_alerts`.
- Exception explicite dans le contrôle contractuel central pour que le centre des alertes reste disponible lorsque la messagerie générale n'est pas incluse, sans ouvrir les autres routes de messagerie.
- Ajout dans `public/ext-messaging.js` d'un bouton « Centre des alertes », d'une liste des alertes et d'actions de prise en charge/résolution.
- Ajout du script `npm run test:step15-alert-lifecycle-static`.

## Tests réellement exécutés

- `node --check` sur les fichiers JavaScript/CJS : **101/101 valides**.
- Contrôles statiques étapes 11 à 15 : **50/50**.
- Contrôles migration : **7/7**.
- Contrôles modules contractuels : **8/8**.
- Contrôles isolation client/station : **11/11**.
- Total des assertions statiques dans les suites exécutées ici : **76/76 réussies**.
- Archive vérifiée avec `unzip -t`.

## Limites et précautions

- Les tests sont statiques. Aucun test d'intégration HTTP avec PostgreSQL réel n'a été exécuté.
- Le centre liste uniquement les alertes dont l'utilisateur est membre destinataire de la conversation système. Les permissions requises sont `settings.edit` ou `user.manage`.
- Les notifications par e-mail, SMS et WhatsApp, l'escalade automatique et les accusés de réception techniques restent à réaliser dans les étapes suivantes.
