# SUIVI — Bandeau défilant d'expiration de licence (2026-11-08)

## Demande
À moins de 15 jours de la fin de licence : message flottant qui quitte de droite à gauche, sur une ligne horizontale tout en haut du site. Action automatique.

## FAIT
- [x] `public/ext-license-ticker.js` : lit `/me/license/status-message`, affiche le bandeau si 0 ≤ jours restants ≤ 15 (hors licence illimitée, expirée/suspendue). Réservé aux rôles ADMIN (admin local du client) et GERANT : rien pour le Super Admin ni pour les autres rôles. Relecture toutes les 10 min, surveillance connexion/déconnexion toutes les 4 s : aucune action utilisateur.
- [x] `public/ext-license-ticker.css` : ligne fixe en haut (36 px), texte défilant droite → gauche à vitesse constante (~90 px/s), pause au survol, orange (4 à 15 j) puis rouge (≤ 3 j). Le site est décalé sous la ligne (menu latéral et en-tête inclus). Mode « mouvement réduit » : texte fixe.
- [x] Branché dans `public/index.html` et précache `public/sw.js` (cache v106 → v107).
- [x] Suppression automatique d'un ancien bandeau fixe « Votre licence expire dans… » s'il existe (pas de doublon).
- [x] Test statique `test/license-ticker-static.js` (4/4) + test navigateur simulé : 2 j, 15 j → affiché ; 16 j, illimité, Super Admin → absent ; mobile 375 px OK ; défilement mesuré.

## RESTE À FAIRE / À VÉRIFIER
- [ ] Contrôle visuel sur le site réel (Render) avec une vraie licence à ≤ 15 jours, après redéploiement.
- [ ] Le texte vient du serveur (`license_expiring_message` si défini dans les paramètres, sinon texte par défaut). À adapter si vous voulez un autre texte.
- [ ] Le code qui affichait l'ancien bandeau statique de la capture n'a pas été trouvé dans cette archive ; il est purgé à l'exécution s'il est du même texte.
- [ ] Anciens tests `test/offline-sales-unit.js` (cache v102) et `shift-attribution-static.js` (v9x) déjà périmés avant ce changement ; non modifiés.
