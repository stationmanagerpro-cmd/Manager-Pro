# Étape 48 — Nom du compte client plus visible sur toutes les interfaces
Date : 2026-10-19

## Demande
Afficher tout en haut des interfaces du compte client le nom de l'entreprise, en grands caractères et de manière cohérente sur ordinateur et mobile.

## Modifications
- La barre d'identité `#tenant-brandbar`, déjà présente dans `public/index.html`, est désormais affichée aussi sur les écrans larges (elle était masquée à partir de 861 px).
- Le nom utilise une taille adaptative : 21–28 px sur ordinateur et 19–23 px sur petit écran, avec un poids renforcé et retour à la ligne pour les noms longs.
- Le nom reste alimenté par l'identité de la station/du compte actif (`client_name`, puis `name`) dans `public/ext-shell.js`.
- La barre est masquée pour les comptes Superadmin globaux afin de ne pas afficher une identité client dans l'espace multi-clients.
- Aucun endpoint, droit d'accès ou règle métier n'a été modifié.

## Contrôles
- `node test/client-company-name-header-static.js` : 7/7 contrôles réussis.
- `node --check public/ext-shell.js` : réussi.
- Parsing de `package.json` : réussi.

## Limites
Le test visuel dans un navigateur réel n'a pas été exécuté dans cet environnement. Vérifier après installation avec un compte client sur ordinateur et téléphone, en mode clair et sombre, ainsi qu'avec un nom d'entreprise long.
