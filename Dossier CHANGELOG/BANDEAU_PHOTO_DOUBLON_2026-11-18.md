# Bandeau : photo en double au rafraîchissement

**Symptôme :** après un rafraîchissement, la photo du bandeau apparaît petite dans la barre du haut, puis devient normale.

**Cause :** deux rendus indépendants de la même photo.
- `ext-skin-pro.js` créait une vignette `.skin-banner` dans la barre `#tenant-brandbar`, visible tant que `data-hero` n'était pas posé.
- `ext-banner.js` peignait le grand bandeau `#hero`, qui attend le téléchargement de l'image. Pendant ce délai (et selon l'ordre des rendus), la vignette restait visible.

**Correctif :** suppression de la vignette (JS et CSS). Le grand bandeau `#hero` est désormais le seul bandeau photo. Le slogan de la barre est conservé. `ext-skin-pro.css?v=3` et `ext-skin-pro.js?v=3`, `sw.js` régénéré.

**Vérifications :** `node --check` OK ; boucle de tests : mêmes échecs préexistants que `main`. **Non vérifié visuellement** (pas de session connectée ici).

**Statut :** branche `fix/bandeau-image-actualisation`, PR à ouvrir, non fusionnée, non déployée.
