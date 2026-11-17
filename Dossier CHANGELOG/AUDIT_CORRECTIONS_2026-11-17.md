# Corrections issues de l'audit — 17 novembre 2026

## Anomalies corrigées

### 1. Bouton « Versions et restauration » illisible (page À propos)
- Constat sur rendu réel (Chromium) : texte sombre sur bandeau bleu marine, contraste quasi nul.
- Correction (`public/ext-about.css`) : dans le bandeau, les deux boutons ont un texte blanc forcé, y compris la variante `b2`.
- Vérifié : texte blanc sur les deux boutons ; l'outil de contraste ne signale plus aucun échec.

### 2. Test de la fil d'Ariane désaligné (`test/banner-static.js`)
- Le code appelle `go(k, arg)` depuis le fil d'Ariane avec argument ; le test cherchait `go(k)`.
- Correction du test : il attend désormais `go(k, `. Le code n'a pas changé.

### 3. Test du logo PDF désaligné (`test/pdf-logo-columns-static.js`)
- Le code ajoute `.catch(swallow('docs:logo', null))` à la lecture du logo ; le test cherchait l'ancienne forme.
- Correction du test. Le comportement reste : logo de la station seulement, sans repli sur le logo de l'application.

### 4. Tests de la fiche produit (`test/product-profile-unit.js`, `test/product-profile-ui-unit.js`)
- Le faux module `core` du test ne fournissait pas `canCost` : ajouté, avec la même règle que `src/core.js` (permission `cost.view`).
- Les scénarios qui attendent des montants de coût reçoivent désormais `cost.view`. Le scénario « sans droit sur les coûts » garde volontairement ses permissions réduites.
- La fixture d'interface reçoit `can_cost: true`, comme le serveur le renvoie.
- Le code de production n'a pas été modifié : la route refuse bien le prix d'achat sans `cost.view`.

### 5. Service worker : contrôle de syntaxe (`test/sw-coherence-static.js`)
- Ajout de deux contrôles : absence de marqueurs de conflit Git, et compilation valide de `sw.js`.
- Vérifié : sur l'ancien `sw.js` cassé (commit `39c522a`), les deux contrôles échouent comme il faut.
- `public/sw.js` régénéré (le contenu public a changé avec le CSS).

## Non corrigé (hors de portée ici)
- Tests qui demandent des modules absents de cet environnement : `zod`, `jsdom`, `exceljs`, `dotenv`, `express`, `pg`. Ils doivent tourner dans l'environnement de développement.
- Tests qui demandent un serveur lancé et des identifiants (`smoke`, `security`, `contracts`, `licenses`, `superadmin`, `tenant-isolation-integration`, etc.).
- `about-page-ui.test.js` : serveur d'application et navigateur requis.
- `ui-shell.test.js` : échec préexistant (délai sur `#toast.show`).

## Tests
- `product-profile-unit` : 8/8.
- `product-profile-ui-unit` : OK.
- `banner-static` : OK.
- `pdf-logo-columns-static` : OK.
- `sw-coherence-static` : 8/8.
- `contrast-audit` : 0 échec.

## Non vérifié
- Affichage de la page À propos dans l'application réelle (test sur page isolée).
