# Nom du site, messagerie (2026-11-01)
- Menu latéral : le nom du site tient toujours sur UNE ligne, droit et aligné à gauche à côté du logo ; taille de départ 17 px réduite automatiquement (jusqu'à 10 px) selon la longueur (public/ext-shell.js `fitNavName`, public/ext-polish.css). Slogan : 11 px, 2 lignes maximum.
- Messagerie : textes agrandis (messages 17 px, noms 18 px, aperçus 15,5 px) et bouton « Aa » (liste et en-tête de conversation) pour régler la taille de 80 % à 180 % (A−, curseur, A+, taille par défaut). Réglage mémorisé par utilisateur sur l'appareil.
- Messagerie : photo de profil de chaque utilisateur (si ajoutée) affichée dans la liste des discussions, l'en-tête de conversation et à côté des messages reçus ; initiales sinon.
- Serveur (src/messaging.js) : nouvelle route `GET /messaging/users/:id/photo` (soi-même ou personne partageant une conversation) ; `has_photo` ajouté aux membres des conversations et `sender_has_photo` aux messages.
- Service worker : cache v85, feuille public/ext-polish.css ajoutée.
