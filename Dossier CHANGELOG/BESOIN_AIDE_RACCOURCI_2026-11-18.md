# Besoin d'aide — raccourci en haut à droite

**Demande :** un raccourci « Besoin d'aide » en haut à droite, comme sur la capture (bannière).

**Changement :** `public/ext-help.js` — bouton `.help-top-btn` placé dans la bannière (`#hero`) quand elle est affichée, sinon dans la barre `#tenant-brandbar`, à côté du profil. Réinséré à chaque rendu (MutationObserver), retiré à la déconnexion. `public/responsive-v3.css` : style pilule sombre, bannière en position relative. `index.html` : `ext-help.js?v=3`, `sw.js` régénéré.

**Vérifications :** test navigateur simulé : barre d'en-tête, puis bannière, puis retour à la barre, puis suppression à la déconnexion (1, 1, 1, 0). `besoin-aide-static` 14/14, `help-guides-unit` 6/6, `station-map-static` 11/11.

**Non vérifié :** rendu réel sur le site (dépend du déploiement).
**Statut :** branche `feat/besoin-aide-raccourci`, PR à ouvrir, non fusionnée, non déployée.
