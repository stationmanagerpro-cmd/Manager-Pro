# Bouton « Besoin d'aide » : plus de saut d'en-tête au chargement (2026-11-20)

## Cause
- Le bouton « Besoin d'aide » était placé dans la barre d'en-tête avant que la bannière soit posée. La barre était donc plus haute (148 px au lieu de 108 px), puis le bouton était déplacé dans la bannière. D'où le deuxième en-tête, plus petit ou plus grand, à l'actualisation.
- La bannière est insérée hors de `<main>` : la surveillance du bouton ne se déclenchait donc pas à sa pose.

## Modifications
- `public/ext-help.js` : tant que la bannière est en attente, le bouton n'est pas placé dans la barre d'en-tête. Il est placé dans la bannière dès sa pose.
- `public/ext-help.js` : la surveillance porte sur l'application entière (`#app`), pour détecter la pose de la bannière.
- `public/sw.js` régénéré.

## Vérifications
- Enregistrement image par image, 390×844, sans réponse de l'image : un seul état d'en-tête (108 px), sans passage par 148 px.
- Enregistrement avec photo enregistrée : un seul état, 108 px.
- `test/banner-static.js` : 15/15. `test/sw-coherence-static.js` : 8/8.

## Non vérifié
- Sur appareil réel, et sur ordinateur avec la vue du tableau de bord.
