# Scan QR des pompes — 20/11/2026

**Nouveau** : un pompiste scanne le QR de la pompe depuis le formulaire de vente carburant ; la pompe, le produit, l'employé (compte connecté) et le quart sont identifiés par le serveur et le formulaire est prérempli. Le scan n'enregistre jamais de vente ; le serveur refait tous les contrôles à la validation.

* Administration : « Gestion des QR Codes » (génération, planche A4, étiquette A5, révocation, régénération, historique).
* Migration `124_qr_codes_scan_pompes.sql` (additive, rejouable) ; retour arrière manuel `docs/qr-tests/rollback_124_qr_codes.sql`.
* Nouvelles routes : voir `docs/SCAN_QR_POMPES_TECHNIQUE.md`. `POST /sales/fuel` accepte `qr_scan_id` (optionnel : la vente classique est inchangée).
* Hors ligne : une vente par scan n'est jamais mise en file.
* Fichiers modifiés : `src/fuelsales.js`, `src/server.js`, `public/index.html`, `public/ext-shell.js`, `public/app.js`, `public/ext-offline-sales.js`, `public/sw.js`, `package.json` (scripts de test), `docs/MIGRATIONS_INDEX.md`.
* Documentation : audit, technique, utilisateur, limites, rapport de tests (`docs/`).
* **Statut : livré pour validation, non déployé.** Tests Android, impression papier et `/sales/fuel` de bout en bout : non exécutés (voir limites).
