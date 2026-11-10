# Correctif — sécurité des exports CSV (2026-10-19)

- Ajout d'un encodeur CSV commun (`src/csv_safe.js`) qui préfixe les chaînes susceptibles d'être interprétées comme formules par Excel/LibreOffice (`=`, `+`, `-`, `@`, y compris après des espaces ou caractères de contrôle initiaux).
- Les nombres transmis comme valeurs numériques restent inchangés.
- L'encodage des guillemets, séparateurs et retours à la ligne reste conforme au format CSV.
- Application du correctif au hub d'exports et au générateur CSV partagé.
- Ajout du test unitaire `test/csv-export-safety-unit.js` et de la commande `npm run test:csv-export-safety`.

## Vérifications

Les tests unitaires CSV (10 cas), les contrôles de syntaxe des fichiers modifiés et la validation JSON de `package.json` passent. Ces vérifications ne remplacent pas un essai de bout en bout dans Excel/LibreOffice avec la base réelle.
