# Étape 49 — Identité du compte client : nom et logo

## Changement
- Le bandeau d'identité en haut des interfaces client affiche le nom du compte actif.
- Si la station associée possède un logo enregistré (`has_logo`), le bandeau charge l'image via l'API authentifiée `/api/images/stations/:id`.
- Le logo est rendu plus visible : 60 × 60 px sur grand écran et 46 × 46 px sur mobile.
- Si aucun logo n'est disponible ou si son chargement échoue, l'icône de marque existante reste utilisée comme solution de repli.
- Le bandeau reste masqué dans l'espace Superadmin global multi-clients.

## Validation
- `node test/client-company-name-header-static.js` : 10/10 contrôles statiques réussis.
- La suite navigateur et la vérification sur les données réelles d'un compte n'ont pas été exécutées ici.
- Pour afficher le logo de l'entreprise, il faut qu'un logo soit effectivement enregistré sur la station associée au compte client. Ce changement n'invente pas de logo et ne migre pas les logos stockés ailleurs.

## Limites
Aucun test PostgreSQL ou test visuel navigateur n'a été effectué pour cette étape.
