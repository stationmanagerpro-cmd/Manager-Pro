# Calculatrice : cause réelle du défaut de couleurs (23/10/2026)

**Cause trouvée par lecture du code** : `public/design-v2.css` (ligne 153) impose `button:not(.b2):not(.bd):not(.bg) { color: var(--on-p) !important; }` à tous les boutons. Cette règle `!important` écrasait la couleur de texte des touches de la calculatrice (fond clair) : texte clair sur fond clair, ou couleurs qui ne s'accordent pas selon le thème. La palette précédente ne pouvait pas l'emporter car elle n'utilisait pas `!important`.

**Correction** (`public/ext-calc.css`) : couleurs de texte des touches, opérations, « = », actions, historique et bouton flottant déclarées avec `!important` + sélecteur à identifiant (qui l'emporte sur la règle globale) ; ombre et marges parasites des boutons globaux neutralisées. Cache `smp-static-v31`.

**Non testé dans un navigateur** : correction établie par analyse des règles CSS, rendu à confirmer en mode jour et nuit (Ctrl+F5).
