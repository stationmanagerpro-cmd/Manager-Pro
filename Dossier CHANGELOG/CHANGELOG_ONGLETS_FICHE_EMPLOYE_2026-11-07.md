# CHANGELOG — Fiche employé : onglets coupés (2026-11-07, rev40)

Problème : la barre d'onglets (Vue d'ensemble … Situation financière) défilait horizontalement avec la barre masquée ; les derniers onglets étaient coupés à droite.
Correctif : `public/ext-product-profile.css` — `.emp-tabs` et `.detail-tabs.pp-tabs` passent à la ligne (`flex-wrap: wrap`, plus de défilement). `index.html` : `ext-product-profile.css?v=2`.
