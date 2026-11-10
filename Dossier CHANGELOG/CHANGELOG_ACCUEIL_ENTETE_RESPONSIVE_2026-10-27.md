# Accueil publique : en-tête responsive (2026-10-27)

- Problème : sur tablette (≤ 1000 px) le menu était masqué sans alternative, et sur mobile (≤ 600 px) le bouton « Se connecter » était masqué.
- Modèle par défaut (`public/home-core.js`) : plus rien n'est masqué. La barre d'en-tête passe à la ligne :
  - tablette : logo + boutons « Se connecter » / « Essayer gratuitement » sur la 1re ligne, menu sur une 2e ligne (défilement horizontal si besoin) ;
  - mobile : logo, puis les deux boutons côte à côte (texte autorisé à passer à la ligne), puis le menu défilable.
  - sur ordinateur la barre peut aussi passer à la ligne si l'espace manque (les boutons ne sont plus coupés).
- Marge haute du héro augmentée sur tablette (150) et mobile (175) pour la hauteur de l'en-tête empilé ; pied de page : retour à la ligne dès la tablette.
- Nouveau réglage « Ordre d'affichage » (`ord`, CSS `order`) dans Position (éditeur) : permet de réordonner les blocs selon l'appareil.
- Pages déjà enregistrées : à l'ouverture/enregistrement, l'ancien en-tête (menu et connexion masqués par le modèle d'origine) est corrigé automatiquement (`upgradeLegacyHeader`). Un en-tête déjà retouché n'est pas modifié.
- Cache du service worker : `smp-static-v71`. Aucune migration SQL.
- Test : `npm run test:home-header-responsive` ; vérifié dans Chromium à 320, 360, 768, 1024 et 1280 px (pas de défilement horizontal).
