# Quart en cours, vente par scan et scan Android — 2026-11-21

## 1. Quart en cours (mise en page tableau de bord)
- `GET /shifts/current` renvoie `pumps[]` : par pompe, recette, volume, nombre de ventes, recette et volume **par produit** (Gasoil, Super…), et employés affectés.
- Affichage dans `public/ext-quart-view.js` / `.css` (appelé par `vQuart`, repli sur l'ancien bloc si le script est absent).
- Plus de deux pompes ou employés : grille adaptative et cadres compacts. Sur téléphone, les tuiles restent visibles.
- Avatars : initiales (l'application n'a pas de photos d'employés). Montants FCFA sans décimales.
- Total général du quart = ventes de produits + recettes carburant.

## 2. Vente par scan : point d'entrée unique
- `openScanSale()` (`public/ext-qr-scan.js`) : ouvre le formulaire carburant si besoin, puis la caméra directement. La pompe lue préremplit pompe, compteur et employé ; la validation reste côté serveur (`qr_scan_id`).
- Entrées : barre **Ventes** (« 📷 Vente par scan »), **vue du quart**, et menu ⚡ en bas à droite (`ext-calc.js`).
- Bouton couleur de marque (`--p` / `--on-p`), conforme à l'audit de contraste.

## 3. Scan dans l'application Android (Samsung)
- Le scanner natif Google (ML Kit, `AndroidBridge.scan`) faisait quitter l'application sur certains Samsung.
- Le scan passe désormais par la caméra web, autorisée par la WebView (`MainActivity`, même hôte). Le natif reste disponible par `window.SMP_NATIVE_SCAN = true`.
- Limite : le bouton « Scanner » natif (affiché quand un champ a le focus) utilise encore le scanner natif. À traiter côté Kotlin si le problème persiste.

## Fichiers
- `src/shifts.js`, `public/ext-quart-view.js`, `public/ext-quart-view.css`, `public/index.html`, `public/app.js`
- `public/ext-qr-scan.js`, `public/ext-calc.js`, `public/sw.js`
- `test/qr-scan-entrees-static.js` (5/5)

## Vérifications
- Rendu du quart contrôlé dans Chromium sur page isolée (bureau 1230 px, téléphone 390 px), sans débordement.
- Non testé dans l'application réelle : serveur et base non lancés dans la session. Sur le téléphone : vérifier le scan, la vente préremplie et l'affichage du quart après déploiement.
