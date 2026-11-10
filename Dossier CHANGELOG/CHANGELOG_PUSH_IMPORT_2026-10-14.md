# Notifications push + Import Excel enrichi — 14/10/2026

## Notifications navigateur
- Menu utilisateur → **Activer les notifications** (permission navigateur)
- Polling `/alerts/center` ~60 s : stock bas, écarts, alertes critical/warning
- Affichage via `Notification` API + service worker (`smp-notify`)
- Déduplication locale (localStorage) pour éviter le spam
- Clic sur notif → focus app / centre d'alertes

## Import Excel
- **POST `/imports/:kind/preview`** : parse + validation ligne par ligne, sans écriture
- UI en 2 étapes : **Prévisualiser** → tableau + liste d'erreurs → **Importer définitivement**
- Rapport final (ok / ignorés / erreurs) inchangé côté POST import réel
- Modèles Excel toujours téléchargeables

## Fichiers
- `src/imports.js`, `public/ext-import.js`
- `public/ext-push.js` (nouveau), `public/sw.js`, `public/index.html`
