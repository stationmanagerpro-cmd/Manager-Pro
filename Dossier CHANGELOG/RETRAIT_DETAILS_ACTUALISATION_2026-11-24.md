# Retrait des détails de la fenêtre « Actualisation en cours » — 2026-11-24

Demande du propriétaire (capture : ligne « Fichiers : … /dashboard … (attente) »).

## Changements
- `public/ext-loader.js` : suppression de la ligne `.smp-ld-diag` et de la fonction `diag()` ; le bouton « Recharger la page » après 8 s est conservé.
- `public/app.css` : deux règles `.smp-ld-diag` supprimées.
- `public/sw.js` régénéré (`smp-static-b987bce74c3`).
- `test/qr-static.js` : le test de diagnostic vérifie désormais l'absence d'affichage, la mesure silencieuse `window.__apiLog` et le bouton Recharger.
- Mesure `window.__apiLog` (`public/app.js`) conservée, rien d'affiché.

## Vérification réelle
- Rendu Chrome après 8 s avec des appels lents simulés : texte « Actualisation en cours… Recharger la page », aucun nom de route ni durée ; bouton visible.
- Suite complète : 225/247 passent, identique à l'exécution précédente (`qr-static` 28/28). Non vérifié : téléphone réel ; `npm test` complet.
