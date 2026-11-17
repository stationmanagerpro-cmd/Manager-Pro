# Besoin d'aide : raccourci stable, entrée de menu, accès superadmin — 17 novembre 2026

## 1. Le bouton disparaissait après le chargement
- Cause : `public/ext-banner.js` insère le grand bandeau `#hero` au-dessus de l'en-tête. Une fois ce bandeau affiché, la barre `#tenant-brandbar` (qui portait le bouton) n'est plus visible.
- Correction : le raccourci « Besoin d'aide ? » est placé dans la barre d'outils `#topbar-ctx`, présente en permanence (aucun script ne la réécrit), juste après le bouton ←.
- `public/ext-help.js` : la présence du bouton est vérifiée et rétablie dans `#topbar-ctx`.

## 2. Entrée dans « Mon profil & aide »
- Comptes clients : « Besoin d'aide » ajouté au groupe « Mon profil & aide » (`public/ext-shell.js`). Le raccourci de la barre d'outils reste en place.

## 3. Superadmin : accès à la configuration
- Le superadmin n'avait aucune entrée de menu vers la vue (son menu est un arbre séparé, `SA_TREE`).
- « Besoin d'aide » ajouté au groupe « Administration » du superadmin.
- Dans la vue, le bouton « Modifier » de chaque carte (procédure et lien vidéo) reste réservé au superadmin.

## Tests
- `test/besoin-aide-static.js` : OK (bouton dans `#topbar-ctx`, vue `besoin_aide`).
- `test/help-guides-unit.js` : 4/4.
- `test/sw-coherence-static.js` : 8/8 (service worker régénéré).

## Non vérifié
- Affichage réel dans le navigateur et dans l'APK : la disparition a été identifiée par lecture du code, pas reproduite. Vérifier après déploiement.
- L'APK charge le site : la correction s'applique après déploiement. Le service worker mis en cache doit être mis à jour (rechargement ou réinstallation) pour que les anciens fichiers soient remplacés.
