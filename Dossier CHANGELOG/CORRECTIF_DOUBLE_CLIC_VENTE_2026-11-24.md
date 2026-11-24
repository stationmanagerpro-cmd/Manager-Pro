# Correctif — double clic sur « Enregistrer la vente » (2026-11-24)
- Problème (capture utilisateur) : deux clics rapides envoyaient deux requêtes ; la seconde affichait « Ce scan a déjà servi pour une vente » (le serveur protégeait le scan, mais aucune protection côté écran).
- Changements : `public/ext-sale-shift.js` (verrou `fBusy` + bouton désactivé pendant l'envoi, libéré en `finally` ; couvre aussi la confirmation d'avertissements) ; `public/ext-improvements.js` (verrou `focusBusy` sur la vente rapide) ; `index.html` (?v=3 / ?v=2) ; `public/sw.js` régénéré ; `test/qr-static.js` (+1 contrôle, 23/23). La vente produit avait déjà son verrou.
- Vérifié : Chrome + API simulée (réponse lente 0,5 s), double clic : 2 POST /sales/fuel avant, 1 après ; `build-sw --check`.
- Non vérifié : production, appareil réel. Idempotence côté serveur des ventes hors scan non ajoutée (hors périmètre, à décider).
- Branche : fix/double-clic-vente.
