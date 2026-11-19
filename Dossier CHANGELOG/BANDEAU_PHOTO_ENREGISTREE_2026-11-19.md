# Bandeau : photo enregistrée posée directement à l'actualisation (2026-11-19)

## Modifications
- `public/ext-banner.js` : à l'actualisation, si la photo de la station est déjà enregistrée dans le navigateur, elle est posée directement. La photo par défaut n'est affichée que s'il n'y a pas de photo enregistrée. Toute photo est chargée avant d'être posée.
- `public/sw.js` régénéré.

## Vérifications
- Enregistrement de chaque état du bandeau, de la première image à la fin, à l'actualisation avec photo enregistrée (390×844) : un seul état, la photo de la station, posée à 209 ms. Aucune apparition de la photo par défaut.
- `test/banner-static.js` : 15/15. `test/sw-coherence-static.js` : 8/8.

## Non vérifié
- Sur appareil réel. Premier chargement sans photo enregistrée : la photo par défaut est posée, puis remplacée par la photo de la station une fois téléchargée.
