# Formulaires client : interrupteurs Actif / Inactif des modules (2026-11-17)

## Ce qui change
- **Nouveau client + licence** et **Gérer client** : chaque module Oui / Non est maintenant un interrupteur **Actif / Inactif**, comme sur la page des modules de paie.
- Les modules sont rangés en 9 familles : Paramètres et administration, Exploitation station, Clients, flottes et trésorerie, RH et paie, Finance et rapports, Messagerie, Alertes et personnalisation, Comptabilité OHADA, Fiscalité.
- **Interrupteur d'en-tête** sur chaque famille : Actif ou Inactif applique l'état à toute la famille. Si la famille est mixte, les deux boutons restent cliquables.
- **Barre « Activation globale des modules »** en haut du formulaire : un clic applique l'état à tous les modules.
- **Réglage manuel** : chaque module garde son propre interrupteur.
- Les anciens boutons « Tout activer / Tout couper » par famille sont remplacés par ces interrupteurs.
- « Initialiser » remet les interrupteurs à leurs valeurs d'origine. Les packs d'autorisations mettent aussi les interrupteurs à jour.

## Ce qui ne change pas
- Les clés des champs (`f_<clé>`), les valeurs enregistrées (`'true'` / `'false'`) et la requête d'enregistrement sont identiques.
- Les champs non Oui / Non (paramètres numériques, options de signature) restent des champs classiques.
- Les champs « Oui / Non » de la rubrique Licence (création d'employés, création de stations) restent des listes déroulantes.

## Fichiers modifiés
- `public/ext-sectioned-form.js` : type de champ `sw`, interrupteurs d'en-tête, synchronisation, clic délégué, réinitialisation.
- `public/ext-contracts.js` : familles de modules (`MODULE_GROUPS`), barre globale, conversion des cases Oui / Non.
- `test/contract-module-switches-static.js` (nouveau) : vérifie que chaque module Oui / Non appartient à exactement une famille.
- `package.json` : script `test:contract-module-switches`.
- `public/sw.js` : régénéré.

## Vérifications
- Test statique : 73 modules Oui / Non répartis en 9 familles, sans doublon ni oubli.
- Tests existants (contrats, passerelles de modules, licence, pages de détail, sidebar, sw) : OK.
- Chromium sur le moteur réel : interrupteur d'en-tête, barre globale, bouton manuel, « Initialiser » fonctionnent ; aucune erreur JavaScript.

## Non testé
- Enregistrement réel sur le serveur déployé.
- Affichage sur téléphone et en mode sombre dans l'application complète.
