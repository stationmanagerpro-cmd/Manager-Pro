# Brouillons de formulaires, bouton « Initialiser », index initial verrouillé — 2026-11-12

## Brouillons automatiques (`public/ext-form-drafts.js`)
- Tout formulaire ouvert en fenêtre garde ce qui est saisi (appareil local, 3 jours). Si on le quitte par erreur, la saisie est rétablie à la réouverture avec un bandeau d'information.
- Le brouillon est effacé quand l'enregistrement réussit (requête d'écriture acceptée par le serveur) ; hors ligne il est conservé.
- Jamais sauvegardés : mots de passe, codes PIN, fichiers, champs en lecture seule ; ni les écrans « Modifier… » (pour ne pas mélanger deux fiches).
- Bouton **↺ Initialiser** dans chaque formulaire de 2 champs ou plus : remet les valeurs de départ et supprime le brouillon.
- Écran de clôture de quart : bouton **↺ Initialiser la saisie** (vide index finaux, montants, justification ; efface le brouillon de clôture existant).

## Index initial non modifiable
- Ouverture de quart : l'index initial de chaque compteur est en lecture seule dès qu'un dernier index est connu.
- Vente carburant (« Ancien index ») : en lecture seule, repris automatiquement ; seul le nouvel index est saisi (écrans `ext-sale-shift.js` et `ext-core.js`).
- Clôture de quart : l'index initial était déjà affiché sans saisie ; seul l'index final est saisi.

## Tests
- Chromium : rétablissement, Initialiser, effacement après enregistrement, exclusion des mots de passe et des écrans « Modifier », réinitialisation de la clôture.
- `sw.js` régénéré (`npm run build:sw`) ; tests statiques inchangés (2 échecs préexistants : `.env` présent, `pdf-logo-columns`).
