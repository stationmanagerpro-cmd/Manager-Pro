# CHANGELOG — Comptabilité : export PDF sur tous les onglets + rapport lisible (2026-11-07, rev39)

## Problème
« 🖨 Imprimer / exporter » (Bilan, Balance, Compte de résultat) produisait un PDF illisible :
- le DOM était converti à l'aveugle (`brandedPdfFromHtml`) : le Bilan, bâti en `div`, devenait **un seul paragraphe** de texte ;
- les lignes de total avec `colspan` décalaient les colonnes ;
- la police PDF (Helvetica) remplaçait les emojis (✅ ❌ 🔒) et le signe « − » par « ? ».

## Correctif
- `public/ext-accounting.js` : le rapport est maintenant construit **à partir des données de l'API** (tableaux, totaux, KPI, notes), un constructeur par onglet.
- Nouveau bouton **« 📄 Export PDF »** dans l'en-tête, commun aux 10 onglets : Synthèse & contrôles, Journaux (respecte journal + recherche, toutes les pages), Grand livre (compte saisi, ou tous les comptes détaillés), Balance, Compte de résultat, Bilan, TVA, Plan comptable (respecte classe + recherche), Immobilisations, Exercices.
- Les anciens boutons « Imprimer » des onglets Balance / Résultat / Bilan sont retirés ; `accPrint()` reste en alias de `accPdf()`.
- `src/docs.js` : `latin()` convertit « − » en « - », « œ » en « oe » et supprime les emojis au lieu d'écrire « ? » (profite à tous les rapports).
- `src/accounting.js` : `/accounting/ledger` accepte `max` (défaut 40, plafond 400) pour le grand livre complet.
- `public/index.html` : `ext-accounting.js?v=3` (cache navigateur).

## À vérifier après déploiement
Ouvrir chaque onglet, cliquer « 📄 Export PDF » et contrôler le rendu (PDF non rendu visuellement dans l'environnement de développement : charge utile validée contre le schéma de `/api/docs/render`).
