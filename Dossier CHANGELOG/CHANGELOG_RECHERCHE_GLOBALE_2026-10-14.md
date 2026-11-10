# Recherche globale — 14 octobre 2026

## Fonctionnalités
- **API** `GET /api/search?q=` : produits, clients, fournisseurs, employés, factures, quarts (station active)
- Superadmin : recherche des **clients plateforme**
- **UI** : champ existant `#gs` branché sur l’API + menus locaux
- Raccourcis : **Ctrl+K** / **⌘K**, **/**, flèches ↑↓, **Entrée**, **Échap**
- Navigation directe : fiche client/fournisseur, profil employé, facture (`billShow`), fiche quart (`showShiftFull`)

## Fichiers
- `src/search.js` (nouveau)
- `src/server.js` (montage)
- `public/app.js` (palette + raccourcis)
- `public/app.css` (styles résultats)

## Utilisation
1. Ctrl+K (ou /) → taper au moins 2 caractères
2. Choisir un résultat (souris ou clavier)
