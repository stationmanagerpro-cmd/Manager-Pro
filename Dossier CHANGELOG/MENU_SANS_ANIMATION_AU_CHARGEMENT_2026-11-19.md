# Menu latéral : plus de sortie/rentrée au chargement (2026-11-19)

## Cause
- Au chargement, le menu s'affichait d'abord sans son style (pleine largeur sur téléphone, 220 px sur ordinateur), puis le style arrivait et les transitions CSS (largeur, transformation 0,18–0,22 s) animaient le passage : il sortait puis se replaçait.

## Modifications
- `public/index.html` : règle de démarrage dans `<head>` : le menu non posé est masqué, et ses transitions sont coupées.
- `public/ext-shell.js` : après le premier rendu du menu, la règle de démarrage est retirée (deux images d'attente). Les animations reviennent pour les clics de l'utilisateur.
- `public/sw.js` régénéré.

## Vérifications
- Enregistrement image par image au chargement, 1280×800 et 390×844 : le menu apparaît directement à sa position finale, sans déplacement. Après le chargement, les transitions sont de nouveau actives.
- `test/banner-static.js` : 15/15. `test/sw-coherence-static.js` : 8/8.

## Non vérifié
- Sur appareil réel et avec un compte qui a des sous-menus ouverts par défaut.
