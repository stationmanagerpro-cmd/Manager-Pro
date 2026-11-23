# Correctif — formulaire de vente non affiché après scan caméra (2026-11-23)
- Tâche : après un scan caméra depuis ⚡ « Vente par scan », la pompe était identifiée (toast) mais le formulaire restait invisible ; libellé « Quart N° » à mettre en blanc.
- Cause (reproduite dans Chrome avec stubs API) : `closeM()` ne fait que `display:none`, le formulaire restait dans le DOM ; `openScanSale` croyait donc le formulaire ouvert (`#fs_pump` présent) et ne rappelait pas `addFuel()`. Le formulaire était prérempli mais caché.
- Changements : `public/ext-qr-scan.js` (`formVisible()` : existence + `#m` affiché + élément visible, utilisé avant la caméra et au retour du scan) ; `public/ext-quart-view.css` (`.qv .qv-id h2{color:#fff !important}`) ; `index.html` (?v=2 css et ext-qr-scan) ; `public/sw.js` régénéré ; `test/qr-static.js` (+1 contrôle).
- Vérifié : harness Chrome — après scan, `#m` flex, formulaire visible, pompe/compteur verrouillés, employé et bandeau affichés ; `node test/qr-static.js`, `build-sw --check`.
- Non vérifié : appareil réel/caméra Android, site de production, `npm test` complet.
- Branche : fix/scan-ouvre-formulaire.
