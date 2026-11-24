# Icône d'actualisation avant la reprise des écrans (2026-11-24)
- Demande : afficher une icône d'actualisation au lieu du grand bloc gris vide pendant l'actualisation (capture 03:15, un autre déploiement venait de redémarrer le service à 03:13).
- Changements : nouveau `public/ext-loader.js` (chargé avant app.js) : icône ↻ qui tourne + « Actualisation en cours… », visible tant que la page n'est pas affichée (bandeau décidé, contenu hors squelette) ; retirée aussitôt ; bouton « Recharger la page » après 8 s ; rien si pas de session (écran de connexion). `public/app.css` (style), `index.html`, `sw.js` régénéré, `test/qr-static.js` 25/25.
- Vérifié : Chrome (API simulée lente) : chargeur présent pendant l'attente, absent une fois la page affichée.
- Non vérifié : production ; la cause de la lenteur (redémarrages de déploiements successifs par plusieurs intervenants) n'est pas traitée.
- Branche : fix/icone-actualisation.
