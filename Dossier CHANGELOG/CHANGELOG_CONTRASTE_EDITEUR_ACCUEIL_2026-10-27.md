# Correctif lisibilité — « Personnalisation de l'accueil » (2026-10-27)

- Cause : `design-v2.css` force `button:not(.b2):not(.bd):not(.bg){color:var(--on-p)!important}` (texte blanc) et `label{color:var(--m)}`. Dans l'éditeur, les boutons / onglets / cartes à fond clair devenaient blanc sur blanc.
- Correction : `public/home-editor.css` — bloc d'isolation entièrement préfixé `#hbe` (priorité supérieure), couleurs explicites pour chaque composant (barre du haut, onglets, segments, cartes, calques, images, propriétés, champs, menus, dialogues, survols, désactivés, focus).
- `public/sw.js` : cache `smp-static-v69` → `v70` pour forcer le rechargement du CSS.
- Aucune migration SQL.
- Note : la couleur de thème « Texte discret » enregistrée est #ff0000 (défaut : #526581) ; elle colore le titre du héro en rouge sur fond marine. À remettre à #526581 ou à un blanc/bleu clair si ce n'est pas voulu.
