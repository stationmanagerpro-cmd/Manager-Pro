# Icône d'actualisation avant la reprise des écrans (2026-11-24)
- Demande : afficher une icône d'actualisation au lieu du grand bloc gris vide pendant l'actualisation (capture 03:15, un autre déploiement venait de redémarrer le service à 03:13).
- Changements : nouveau `public/ext-loader.js` (chargé avant app.js) : icône ↻ qui tourne + « Actualisation en cours… », visible tant que la page n'est pas affichée (bandeau décidé, contenu hors squelette) ; retirée aussitôt ; bouton « Recharger la page » après 8 s ; rien si pas de session (écran de connexion). `public/app.css` (style), `index.html`, `sw.js` régénéré, `test/qr-static.js` 25/25.
- Vérifié : Chrome (API simulée lente) : chargeur présent pendant l'attente, absent une fois la page affichée.
- Non vérifié : production ; la cause de la lenteur (redémarrages de déploiements successifs par plusieurs intervenants) n'est pas traitée.
- Branche : fix/icone-actualisation.

## Mise à jour — logo de la plateforme (2026-11-24, 03:50)
- Demande : l'écran « Actualisation en cours » doit montrer le logo actif du site (plateforme), pas celui du client.
- Changement : `public/ext-loader.js` lit `/api/branding` (public, identité plateforme administrée par le Super Admin) et affiche `/api/branding/logo` ; à défaut, `/icons/icon-192.png`. Le logo est mémorisé (`smp-ld-logo`) pour s'afficher aussitôt au chargement suivant. Anneau qui tourne autour du logo (`public/app.css`). `sw.js` régénéré ; `test/qr-static.js` 26/26.
- Vérifié : Chrome (simulation) : logo dans l'anneau. Non vérifié : logo réel en production (le serveur simulé ne renvoie pas d'image).
- Branche : feat/logo-chargeur.
