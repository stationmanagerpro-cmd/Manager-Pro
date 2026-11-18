# Besoin d'aide — affichage des cartes

**Problèmes :** les procédures sans espace débordaient des cartes ; les liens « ▶ Voir la vidéo » prenaient la couleur de lien du système (bleu).

**Changement :** `public/responsive-v3.css` — retour à la ligne forcé pour les mots longs, couleur explicite des titres (`--t`) et des liens vidéo (`--p`), soulignement seulement au survol.

**Vérification :** rendu headless avec un mot de 70 caractères : largeur de carte 418/418 px, pas de défilement horizontal à 420 px.

**Non vérifié :** rendu réel sur le site (dépend du déploiement).
**Statut :** branche `fix/besoin-aide-affichage`, PR à ouvrir, non fusionnée, non déployée.
