# Accueil publique : nouveau modèle + éditeur visuel (2026-10-26)

- Nouveau modèle d'accueil = copie du fichier `station-manager-pro-accueil.html` (public/home-core.js, `defaultDoc()`), image du héro en `public/home-default-hero.png`.
- Éditeur plein écran (Super Admin > « Personnalisation de l'accueil ») : gauche = Ajouter / Calques / Images, centre = page en direct (Ordinateur / Tablette / Mobile), droite = propriétés (contenu, lien, disposition, taille, position, espacement, typographie, remplissage, bordure, effets, visibilité).
- Tout est modifiable : textes (double-clic), couleurs (thème + libres), tailles, polices, dégradés, images de fond, calques, ombres, transformations ; réglages propres à la tablette (≤1000 px) et au mobile (≤600 px).
- Images illimitées (300 max en bibliothèque, réduites automatiquement si > 2 Mo).
- « À propos » : contenu centré. Brouillon enregistré automatiquement ; publication explicite. Annuler/Rétablir, glisser-déposer des calques, export/import JSON, retour au modèle d'origine.
- Serveur : src/home_page.js réécrit (API /admin/home, /admin/home/media, /admin/home/reset). Aucune migration SQL. L'ancien contenu v1 est remplacé par le nouveau modèle ; ses images restent dans la bibliothèque.
- Sécurité : tout est validé (couleurs, nombres, listes fermées, liens http(s)/mailto/tel/#ancre/connexion) et échappé ; aucun HTML libre.
- Tests : `npm run test:homepage-centering`, `npm run test:home-core-security`.
