# Bandeau d'accueil — démarrage sans attente (2026-11-19)

## Modifications
- `public/ext-banner.js` : téléchargement de la photo limité à 5 s. Au-delà, le bandeau s'affiche sans photo au lieu de rester en attente.
- `public/ext-skin-pro.css` : la marque de l'en-tête reste masquée pendant le calcul du bandeau, puis redevient visible après 10 s si le bandeau n'a pas été posé (repli en CSS pur). Le commentaire est corrigé : seule la marque est masquée, pas toute la barre.
- `public/sw.js` régénéré.

## Comportement à l'actualisation
- La photo enregistrée dans le navigateur (IndexedDB) est affichée dès que la session est connue, sans nouveau téléchargement.

## Vérifications
- `test/banner-static.js` : 15/15.
- `test/sw-coherence-static.js` : 8/8.
- Simulation 390×844 avec photo et sans réponse de l'image : un seul bandeau, pas de chevauchement, aucune erreur console.

## Non vérifié
- Comportement sur un vrai appareil et sur le serveur de production.
- Skins autres que « pro ».
