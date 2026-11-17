# Modes de paiement : seuls les moyens rattachés à un compte actif, partout — 17 novembre 2026

## Problème
- Dans Finance › Moyens de paiement, le menu « Compte rattaché » filtrait par nature et pouvait masquer un compte déjà rattaché et actif.
- Les autres écrans (Dépense, paiements fournisseur, avances, paie, dettes, facture client, filtre finance) listaient tous les moyens actifs, y compris ceux sans compte.

## Correction
- `public/ext-core.js` — `pmOpts` (liste commune à tous les écrans) :
  - ne propose que les moyens **liés à un compte actif**, ou la caisse (espèces) ;
  - affiche le libellé « Moyen — Compte » (ex. « Carte bancaire — Compte Carte bancaire ») ;
  - les écrans qui excluent le crédit continuent de l'exclure.
- `public/ext-fin.js` — menu « Compte rattaché » : tous les comptes **actifs** sont proposés, sans filtre par nature. Un compte déjà rattaché reste affiché même s'il est inactif.

## Écrans concernés (via `pmOpts`)
Dépense, paiement fournisseur, encaissement de dette / avance / paie, facture client, dette, filtre « Moyen de paiement » de Finance.

## Non modifié
- Côté serveur, la règle de validation des paiements (`src/core.js`) existait déjà : un moyen sans compte actif est refusé.
- La liste affichée dépend de `/appearance`, rechargé après chaque rattachement. Un écran ouvert avant un changement doit être rafraîchi.

## Tests
- `test/finance-liaisons-static.js`, `test/fleet-flow-unit.js`, `test/fleet-invoice-unit.js`, `test/gaps-ui-dom.js`, `test/links-audit-static.js`, `test/ownership-unit.js`, `test/employees-unlinked-route-static.js` : OK.
- `test/sw-coherence-static.js` : 7/7 (service worker régénéré).
- `test/employee-actions-unit.js` : non exécutable dans cet environnement (module express absent).
- `test/about-page-ui.test.js` : non exécutable ici (serveur d'application et navigateur requis).

## Non vérifié
- Affichage réel dans le navigateur sur chaque écran listé.
