# Rapprochement à la clôture et alertes — 2026-11-17

Branche : feat/rapprochement-cloture-alertes (locale, base fix/tests-perimes-2026-11-16 @ c38f068). **Non poussée, non fusionnée, non déployée.**

## Décision retenue (gérant)
Option A « statu quo renforcé » : les écarts individuels restent calculés sur les compteurs, sans blocage. Le renforcement porte sur la visibilité :
1. rapport de clôture : rapprochement par jaugeage par produit, drapeau « vérifié par jaugeage » par employé ;
2. alerte à la clôture si la cuve n'est pas vérifiée (jauge manquante ou hors tolérance) ;
3. continuité des index : écart entre l'index de départ du quart et l'index de fin du quart précédent, affiché au rapport et alerté.
Le résiduel non attribuable reste affiché (employé = aucun), jamais imputé.

## Réalisé
- `src/shifts.js` (clôture) :
  - le rapprochement cuve est toujours calculé ; `tank_close_block` (défaut `off`) n'active que le blocage ;
  - `report.tank_check` = { mode, tolerance_pct, products (tous statuts), dip_verified } ;
  - chaque employé reçoit `gap_verified_by_dip` ;
  - `report.counter_continuity` : compteurs dont l'index de départ ≠ fin du quart précédent (tolérance 0,0005) ;
  - alertes après clôture, try/catch : `tank_variance` (cuve non vérifiée) et `counter_anomaly` (continuité, métrique en litres). Ces types sont déjà configurables dans l'écran Alertes ; ils ne sont envoyés que si le gérant a activé la configuration correspondante.
- `test/shift-close-attribution-unit.js` : mocks des requêtes ajoutées ; assertions du résiduel alignées sur la décision (Moussa −2 500 ; résiduel non attribué −10 000 ; global −12 500 = somme) ; l'assertion « anomalie déclarée avec son employé » remise sur le motif réel de la requête.

## Tests
- Syntaxe `node --check src/shifts.js` : OK.
- Suite statique + unitaire complète : 193 réussis, 4 échecs (inchangés en nombre) :
  - employee-actions-unit, stock-movement-validation-unit : limite d'environnement (stub zod ignore min/max).
  - shift-report-share-unit : refus de confidentialité voulu, test à arbitrer.
  - shift-close-attribution-unit : s'arrête au contrôle « refus des paiements non espèces globaux sans pompe libre » (voir ci-dessous).
- Non vérifié : aucun test HTTP réel (dépendances non installables ici), aucun affichage navigateur, aucun envoi d'alerte réel.

## Point ouvert (à arbitrer)
Dans le scénario de test (3 employés, toutes pompes attribuées), un paiement mobile global de 99 FCFA est accepté au lieu d'être refusé par « Aucune pompe sans employé » ; il apparaît en résiduel (cash_gap 99). Cause non identifiée : la garde dépend de `empCl.unowned`. Comparaison avec la version commitée non concluante (le script de diagnostic n'a pas produit de sortie). À investiguer avant toute conclusion.

## Non encore fait
- Écran « Rapport de clôture » : affichage du rapprochement, du drapeau par employé et de la continuité (côté front, non modifié).
- Règle « jaugeage obligatoire à la clôture » et fenêtre de référence : décisions du gérant en attente (options B/C écartées pour l'instant).
- Déploiement : aucun. Fusion dans main : aucune. Décision de feu vert en attente.

## Procédure de retour arrière (si fusion ultérieure)
Revert du commit sur main, sans force-push. La modification est sans migration : aucune donnée à restaurer.
