# Étape 50 — Fiche B1 : pièces jointes directes dans la messagerie

Date : 20 octobre 2026

## Cause identifiée
Le bouton `Joindre` dans `public/ext-messaging.js` n'ouvrait pas de sélecteur de fichier : il affichait uniquement une notification demandant d'utiliser l'envoi de document depuis un autre écran. La route d'API des pièces jointes existait, mais elle n'offrait pas de voie d'envoi direct depuis la messagerie pour un fichier sélectionné dans le navigateur.

## Changements
- Ajout d'un sélecteur de fichiers multiples directement dans la conversation.
- Formats autorisés côté interface : PDF, images courantes, TXT, Word et Excel.
- Liste des fichiers choisis, taille affichée et retrait individuel avant envoi.
- Envoi direct via la route des pièces jointes de la conversation.
- Téléchargement des pièces jointes via `fetch` avec le jeton de session et l’identifiant de station, au lieu d’un lien direct sans en-têtes d’authentification.
- Contrôles serveur du type MIME déclaré et d'une taille maximale de 10 Mo par fichier.
- Écriture dans le dossier propre au client connecté ; contrôle d'appartenance à la conversation conservé.
- Limite JSON de l'API portée de 8 à 16 Mo pour permettre l'encodage base64 d'un fichier de 10 Mo.

## Vérifications effectuées
- Nouveau test statique B1 : 12/12.
- Test existant `messaging-attachment-security-static.js` : 7/7.
- Test `detail-pages-static.js` : réussi.
- `node --check` réussi sur `src/messaging.js`, `src/server.js`, `public/ext-messaging.js`.
- `package.json` analysé comme JSON valide.

## Limites connues
Les tests exécutés sont statiques et syntaxiques. Aucun test navigateur ni test d'intégration avec serveur/PostgreSQL n'a été exécuté ici. Le contrôle serveur s'appuie sur le type MIME déclaré dans la requête ; une validation approfondie par signature réelle des formats est encore à renforcer.

## Autres demandes de l'utilisateur — non traitées dans cette étape
1. Publicité en pop-up sur toutes les interfaces client avec cadence de 60 secondes si plusieurs images et 120 secondes si une seule.
2. Identifiants automatiques et rattachement cohérent des ventes, achats, factures, bons de commande, créances et dettes aux profils employés/clients/fournisseurs.
3. Nouvelle interface « Diagramme » avec statistiques et graphiques par profil.
4. Résolution du problème de la fiche fournisseur ; la capture affiche un avertissement de migration (`npm run migrate`), à diagnostiquer sur l'installation concernée.
5. Couleur bleue du nom du compte client alignée sur la barre latérale.
6. Code d'accès exécuté et activé par défaut, après vérification des garde-fous d'accès.

Ces points ne sont pas déclarés terminés dans cette archive.
