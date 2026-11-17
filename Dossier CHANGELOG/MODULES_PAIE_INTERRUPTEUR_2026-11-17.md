# Modules de paie : interrupteur Actif / Inactif et activation globale (2026-11-17)

## Ce qui change
- Page « Modules de paie (AMO, INPS, ITS) » : chaque carte de module a maintenant, dans son en-tête, un interrupteur **Actif / Inactif**.
  - **Actif** (module inactif) : ouvre la saisie des taux et du motif, puis active le module (activation manuelle, comme avant).
  - **Inactif** (module actif) : désactive le module après motif.
  - Le bouton non utilisable est estompé ; le module non autorisé par le SuperAdmin affiche les deux côtés grisés, avec une info-bulle.
- Barre « Activation globale » en haut de la liste : compteur « X sur Y module(s) autorisé(s) actif(s) » et bouton **Tout activer** (désactivé si tout est déjà actif). Il appelle l'activation groupée existante (taux par défaut CLEISS / DGI).
- Retrait des anciens boutons « Activer… » et « Désactiver » dans le corps des cartes ; « Reconfigurer les taux » reste pour les modules actifs.
- Le bouton « Activer tous les modules autorisés » du bas de page est remonté en haut ; le bas ne garde que la navigation (Retour RH, Rapports paie).

## Ce qui ne change pas
- Aucun changement côté serveur : routes `/hr/payroll-modules/...` (activate, config, deactivate, activate-all) inchangées.
- Les règles de sécurité restent : seul un module autorisé par le SuperAdmin peut être activé, et le motif reste obligatoire.

## Fichiers modifiés
- `public/ext-core.js` : fonction `pmSwitchHtml`, rendu de `vAct` (barre globale, cartes, style).
- `public/sw.js` : régénéré (`npm run build:sw`).

## Vérifications
- `node --check public/ext-core.js` : OK.
- Tests statiques : sw-coherence, payroll-zero-amount-guidance, contract-module-gates, detail-pages, dynamic-html-security : OK.
- Rendu visuel de l'interrupteur (3 états, capture Playwright) : OK.

## Non testé
- Clic réel sur un serveur déployé (activation, désactivation, activation groupée).
- Affichage sur téléphone et en mode sombre dans l'application complète.
