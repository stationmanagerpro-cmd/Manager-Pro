# Changelog — D1 couverture des cartes KPI — 2026-10-19

- Ajout de `.dir-kpi` au sélecteur de décoration des cartes KPI et au sélecteur utilisé pour les nœuds ajoutés dynamiquement. Les indicateurs du tableau de bord direction qui utilisent cette classe reçoivent désormais la même pastille SVG que les autres cartes compatibles.
- Correction de la frontière de mot `\b` dans la correspondance « CA » : le fichier contenait un caractère de contrôle (backspace) à cet emplacement, ce qui empêchait la correspondance attendue.
- Renforcement du test statique D1 pour couvrir la classe `.dir-kpi` et l'expression régulière corrigée.

Validation effectuée : contrôles statiques et syntaxe JavaScript. Aucun essai visuel navigateur, ni comparaison réelle clair/sombre, n'a été exécuté dans cette étape.
