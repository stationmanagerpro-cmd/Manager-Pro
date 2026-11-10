# SUIVI — Export PDF des écrans « Quarts de service » et « Ventes » (2026-11-08)

## FAIT
- [x] Barre commune des rapports (Date de début / Date de fin / Filtrer / Réinitialiser / 📄 Exporter en PDF) ajoutée sur Exploitation → Quarts de service et Exploitation → Ventes (`public/app.js`, via `RT.bar`).
- [x] Nouveau `public/ext-shifts-sales-pdf.js` : rapports PDF via le moteur commun (logo, couleurs, pied de page, A4) — Quarts : N°, Type, Début, Fin, Statut, Écart caisse + total écart ; Ventes : N°, Facture, Quart, Type, Date, Total, Statut + total des ventes valides (annulées exclues).
- [x] Serveur : `GET /shifts` et `GET /sales` acceptent `from`/`to` (jours inclus, début ≤ fin, sinon erreur 400). Sans période : comportement inchangé (60 quarts / 50 ventes). Avec période : jusqu'à 1000 lignes.
- [x] Droit d'export identique aux autres rapports (le bouton PDF n'apparaît que si l'utilisateur a un droit accepté par le moteur).
- [x] `index.html`, `sw.js` (cache v108). Tests : `test/shifts-sales-pdf-static.js` (5/5) ; charges PDF validées contre le schéma zod réel de `src/docs_render.js` ; `test/pdf-engine-stub.js` OK.

## RESTE À FAIRE / À VÉRIFIER
- [ ] Contrôle visuel du PDF généré sur le site réel (le moteur PDF serveur n'a pas été exécuté ici, uniquement la charge validée).
- [ ] Les requêtes SQL avec période n'ont pas été exécutées sur PostgreSQL (pas de base ici) : à tester avec de vraies données.
- [ ] `test/report-ui-harness.js` nécessite playwright + zod dans node_modules du projet : non lancé.
