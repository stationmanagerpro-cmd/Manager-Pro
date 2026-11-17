# Nettoyage : lien APK de « À propos de Manager Pro » — 2026-11-17

- Lien Android par défaut : `/downloads/Manager_Pro-debug-2026-11-17.apk` (APK Manager Pro).
- Validation : seuls les fichiers de `/downloads/` sont acceptés en lien interne (`src/about_logic.js`, `public/ext-about.js`).
- Suppression de `public/telechargements/Ika-So.apk` : fichier d'un autre projet (Ika Sô), sans rapport avec Manager Pro.
- Tests : `test/about-page-static.js` et `test/about-page-ui.test.js` alignés. `about-page-static` passe ; `about-page-http` ne tourne pas ici (module express absent), il échoue aussi sur `main`.
- Point d'attention : si le lien Android a été saisi à la main dans les paramètres « À propos », il faut y mettre `/downloads/Manager_Pro-debug-2026-11-17.apk`.
- Retour arrière : revert du commit de cette branche.
