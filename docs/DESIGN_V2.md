# Nouveau design (v2) — Station Manager Pro

## Ce qui change
- **Menu latéral sombre** (bleu marine), entrée active en pastille de la couleur de marque, sous-menus flottants assortis.
- **Barre supérieure** : recherche arrondie, notifications et profil alignés ; le titre de page est masqué sur l'accueil (le message de bienvenue le remplace).
- **Tableau de bord** (`Tableau de bord`, page d'accueil des comptes autorisés) : 4 indicateurs avec comparaison à la période précédente, ligne d'indicateurs financiers, graphique ventes (barres) + volume (courbe) sur 7 jours, état des cuves, carte de marque, dernières ventes, alertes, raccourcis, conseil du jour. Toutes les valeurs viennent de la base de données.
- **Tous les écrans** : cartes arrondies, tableaux, formulaires, boutons, onglets et sous-onglets, fenêtres, écran de connexion — mode jour et mode nuit.

## Lisibilité des textes (aucune superposition de couleurs)
Chaque fond coloré est associé à une couleur de texte calculée (`--on-p` pour la couleur de marque, `--p-text` / `--pl-text` pour la marque utilisée comme texte). Le calcul est refait à chaque changement de thème ou de mode jour/nuit (`ext-design.js`). Les anciennes règles CSS et styles en ligne qui employaient la couleur de marque comme texte sont corrigés automatiquement.
Contrôle effectué : 18 écrans × 6 combinaisons (clair/sombre, marque bleue, jaune, très claire, très sombre, ancien vert) → 0 texte sous le contraste WCAG AA (4,5:1 ; 3:1 pour les grands textes).

## Couleur de marque
Si la couleur de marque est l'ancienne valeur par défaut (vert `#0d7a6b`), le bleu du nouveau design est utilisé. Toute autre couleur choisie dans Paramètres > Apparence est respectée. Même règle pour le panneau gauche de la page de connexion.

## Données ajoutées côté serveur (lecture seule)
- `GET /api/dashboard/daily` : champ supplémentaire `liters` (litres vendus par jour).
- `GET /api/dashboard/overview` : niveaux des cuves (capacité si renseignée), 6 dernières ventes, nombre de transactions et de la période précédente.
Aucune migration, aucune écriture en base.

## Fichiers
`public/design-v2.css`, `public/ext-design.js` (chargés en dernier), `index.html`, `sw.js` (cache v5), `app.js` (accueil + connexion), `src/reports.js`.
