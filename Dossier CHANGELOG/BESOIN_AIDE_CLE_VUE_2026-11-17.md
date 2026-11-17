# Besoin d'aide : la vue ouvrait le manuel au lieu des procédures — 17 novembre 2026

## Constat
Le centre « Besoin d'aide » (procédures et liens vidéo par module, déjà fusionné sur `main`) ne s'affichait pas :
- `public/ext-help.js` déclarait la vue sous la clé `aide`.
- `public/ext-aide-demo.js`, chargé après, redéclare la clé `aide` pour le « Manuel & aide » : c'est lui qui gagnait.
- Résultat : le bouton « Besoin d'aide ? » ouvrait le manuel, les cartes par module et le bouton « Modifier » du Super Admin étaient inaccessibles.
- Les tests statiques ne détectaient pas ce conflit (ils vérifiaient la présence du code, pas la vue ouverte).

## Correction
- La vue d'aide prend la clé `besoin_aide` (`public/ext-help.js`). La clé `aide` reste au manuel.
- Ajout de `besoin_aide` à `SUPERADMIN_VIEWS` : le Super Admin peut ouvrir la vue et modifier les procédures.
- Bouton de la bannière (`public/index.html`) et bouton de la vue : `go('besoin_aide')`.
- Test `test/besoin-aide-static.js` : vérifie la nouvelle clé et l'absence de redéfinition de `V.aide`.
- Service worker régénéré.

## Non vérifié
- Affichage réel dans le navigateur (pas de serveur disponible ici).
- Contenu : aucune procédure ni lien vidéo n'est encore saisi. Les cartes affichent « Procédure : à rédiger » et « Voir la vidéo » désactivé tant que le Super Admin ne les renseigne pas.
