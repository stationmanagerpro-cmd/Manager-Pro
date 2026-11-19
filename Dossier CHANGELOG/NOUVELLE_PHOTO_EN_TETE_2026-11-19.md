# Nouvelle photo par défaut et en-tête sans double affichage (2026-11-19)

## Modifications
- `public/banner-defaut.webp` : nouvelle photo par défaut (1600×674).
- `public/index.html` : en-tête masqué dès le premier rendu (attribut `data-hero-pending` posé dans `<head>`). Retiré après 10 s si le bandeau n'a pas été posé.
- `public/ext-skin-pro.css` : `#app-header` est masqué (`display: none`) tant que l'attribut est présent, pour toutes les skins. Avant, seule la marque était masquée, d'où deux en-têtes successifs de hauteurs différentes.
- `public/sw.js` régénéré.

## Vérifications
- Enregistrement image par image au chargement (1280×800 et 390×844, sans réponse de l'image) : un seul état d'en-tête, celui défini par le bandeau. Plus de hauteur intermédiaire.
- `test/banner-static.js` : 15/15. `test/sw-coherence-static.js` : 8/8.

## Non vérifié
- Sur téléphone réel, la photo est recadrée (cover) : le logo du haut est partiellement coupé. À trancher (voir livraison).
