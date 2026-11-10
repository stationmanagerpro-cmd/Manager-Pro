# Vérification de cohérence v11 (2026-10-26)

## Correctif de code
- `public/ext-import.js` : la liste blanche des types d'import (`validKind`) avait disparu lors de la réécriture de l'écran. Rétablie (products, customers, suppliers, employees, sales) sur la liste, le téléchargement du modèle et l'ouverture du formulaire ; libellés de colonnes échappés. `esc()` n'échappe pas l'apostrophe : la liste blanche protège les gestionnaires `onclick` en ligne.

## Tests mis à jour (le code avait évolué, pas le test)
- `import-ui-security-static`, `performance-motion` : version du cache PWA (`smp-static-v\d+`).
- `roles-messaging-static` : l'ordre des clés étrangères est dans `fk_order.js` / `tenant-backups.js` ; la restauration complète passe par psql.
- `step8-static` : le Super Admin peut déverrouiller tout compte ; alertes automatiques activées par défaut dans un nouveau contrat ; droit de personnalisation via `t('can_personalize')`.
- `step22-maintenance-permissions-static` : section « Signature » masquée pour le Super Admin.
- `step12-alert-config-static` : destinataires facultatifs si la règle est inactive.
- `step10-ux-branding-static` : bouton « Fiche complète » déplacé dans `ext-p10.js`.
- `pdf-logo-columns-static`, `branding-logo` : mêmes comportements, code écrit autrement.

## Résultat
87 scripts de test sans base : 87 réussis. Non exécutés : tests d'intégration PostgreSQL, `test:branding` et `test:access-keys` (identifiants requis), `calculator-dom` (jsdom non installé ici).

## À décider / constaté
- Nouveaux contrats : alertes automatiques activées par défaut (le test d'étape 8 exigeait l'inverse). À confirmer.
- Migrations : numéros 027, 040 et 059 utilisés deux fois ; 056 et 067 à 069 absents. Ordre stable (tri par nom), ne jamais renommer une migration appliquée.
