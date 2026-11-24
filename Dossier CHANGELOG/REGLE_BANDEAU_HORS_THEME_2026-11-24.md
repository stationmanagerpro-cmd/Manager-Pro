# Règle « en-tête masqué en attente du bandeau » déplacée — 2026-11-24

Choix du propriétaire (option 1). Aucun changement d'affichage.

## Pourquoi
`test/skin-pro-static.js` échouait : la règle `html[data-hero-pending] #app-header { display: none; }` se trouvait dans `public/ext-skin-pro.css` sans être limitée au thème Pro (`data-skin`).

## Changements
- `public/ext-skin-pro.css` : règle retirée (un commentaire indique où elle est).
- `public/ext-banner.css` : règle ajoutée, avec son commentaire (décision du 19 novembre, pas de repli temporisé).
- `public/sw.js` : régénéré (`node scripts/build-sw.js`, `smp-static-b3fe80e5678`).
- `test/banner-pending-static.js` : la vérification suit la règle dans `ext-banner.css` ; ajout d'une assertion qu'elle n'est plus dans `ext-skin-pro.css`. Aucune vérification retirée.
- Numéros `?v=` inchangés : fichiers statiques revalidés à chaque visite et service worker renouvelé par empreinte du contenu.

## Vérification réelle
- Rendu avec les 22 feuilles réelles, design Pro et classique, avant et après : en-tête masqué en attente, affiché ensuite ; identique avant et après.
- Suite complète (247 fichiers) : 225 passent (224 avant) ; `skin-pro-static` 20 contrôles, `banner-pending-static` 5/5, `banner-static` 15, `sw-coherence` 8/8, `repo-hygiene` 7/7.
- Non vérifié : appareil réel ; `npm test` complet (npm indisponible, serveur et base absents).
