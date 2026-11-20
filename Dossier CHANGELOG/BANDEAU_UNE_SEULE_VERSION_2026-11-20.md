# Bandeau : une seule version, avec le nom (2026-11-20)

## Cause
- Au chargement, le bandeau était posé avant la vue de démarrage (la vue « quart », puis le tableau de bord) : il apparaissait d'abord en version compacte avec la photo par défaut encadrée (bandes sombres), puis en version complète.

## Modifications
- `public/app.js` : à la fin du démarrage, la vue de démarrage est marquée comme choisie (`window.__viewSettled`) et un événement `smp:boot-view` est émis.
- `public/ext-banner.js` : le bandeau n'est posé qu'après ce signal (pour une session connectée). Il se redessine à ce moment.
- `public/ext-banner.js` : la classe `is-default` n'est plus posée.
- `public/ext-banner.css` : règles de la photo encadrée (`contain`) et masquage du nom sur téléphone supprimés. La photo par défaut s'affiche en pleine largeur, comme la photo de la station ; le nom du compte client (ou le nom du site pour le superadmin) reste visible.
- `public/sw.js` régénéré.

## Vérifications
- `test/banner-static.js` : 15/15. `test/sw-coherence-static.js` : 8/8.
- Enregistrement à l'actualisation (390×844, photo enregistrée) : un seul bandeau.
- Enregistrement au premier chargement : un seul bandeau final ; un changement de hauteur de 40 ms de l'en-tête a été relevé (255 ms → 296 ms) dans le banc d'essai, non résolu.

## Non vérifié
- Sur appareil réel, et avec un compte dont la vue de démarrage est le tableau de bord (le banc d'essai n'a pas ces droits : il démarre sur la vue « quart »).
