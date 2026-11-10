# Étape 28 — A6/B1 : cohérence des tests statiques

Date : 19 octobre 2026

## Changements

- Mise à jour d'une assertion obsolète dans `test/step21-report-colors-platform-pdf-static.js` : elle cherchait un ancien libellé de l'autorisation de personnalisation des couleurs des rapports.
- Le test vérifie désormais le champ réel du contrat `can_customize_report_exports` et son libellé actuel dans `public/ext-contracts.js`.
- Aucun comportement applicatif ni droit métier n'a été modifié dans cette étape.

## Contrôles exécutés

- `node test/step21-report-colors-platform-pdf-static.js` : 14/14.
- `node test/pdf-logo-columns-static.js` : 8/8.
- `node test/messaging-attachment-security-static.js` : 7/7.
- `node --check src/docs.js` et `node --check src/messaging.js` : réussis.
- `package.json` : JSON valide.

## Limites

Ces contrôles sont statiques. Aucun PDF n'a été rendu visuellement et aucun test multipart HTTP ni test PostgreSQL d'isolation de pièces jointes n'a été exécuté. Les fiches A6 et B1 ne sont donc pas certifiées de bout en bout.
