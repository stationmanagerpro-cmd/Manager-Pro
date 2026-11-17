# Fil d'Ariane : le nom de rubrique ouvre sa propre page (2026-11-17)

## Problème constaté
- Dans le fil d'Ariane (Accueil › Administration › Rôles), cliquer « Administration » ouvrait la première page de la rubrique (« Rôles »). Le nom cliqué ne correspondait donc pas à la page ouverte.

## Ce qui change
- Nouvelle page **« Rubrique »** (hub) : elle porte le nom de la rubrique cliquée (ex. « Administration ») et présente une carte par page accessible de cette rubrique.
- Le clic sur « Administration » dans le fil d'Ariane ouvre cette page hub.
- Le bouton « ← » revient à la page précédente (pile d'historique existante).
- Chaque carte ouvre la page correspondante. Seules les pages auxquelles le compte a droit sont listées ; chaque page garde ses propres contrôles.

## Fichiers modifiés
- `public/ext-shell.js` : vue `secthub`, liste des pages de la rubrique (`navSectionPages`).
- `public/ext-skin-pro.js` : le nom de rubrique du fil d'Ariane envoie vers la vue hub avec le nom de la rubrique.
- `public/sw.js` : régénéré.

## Vérifications
- Chromium avec navigation simulée : le clic sur « Administration » appelle bien la vue hub avec le nom « Administration », sans erreur JavaScript.
- Test « ui-shell » : échoue déjà avant ce changement (délai d'attente sur le toast, à l'étape de connexion) ; non corrigé ici.

## Non testé
- Affichage du hub avec un vrai compte client et un vrai compte superadmin sur le serveur déployé.
