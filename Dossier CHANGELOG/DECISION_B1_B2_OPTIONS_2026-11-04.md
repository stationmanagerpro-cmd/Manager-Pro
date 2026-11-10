# Décisions requises — B1 (écarts de caisse) et B2 (réconciliation) — 2026-11-04

Mise à jour : B1 (option B) et B2 (comparaison pompé/vendu, 0,5 %, ventes annulées exclues) ont été appliqués par défaut (CORR-036 et CORR-037) ; à confirmer.

## B1 — La table `cash_gaps` n'existe dans aucune migration
**Constat.** 5 requêtes la lisent (operations.js:331, ops_plus.js:25, treasury.js:57, reports.js:459, plus l'affichage public/ext-treasury.js). Leur erreur est journalisée (`[safe]`) et le résultat vaut toujours 0 : le tableau de bord n'a jamais signalé un écart de caisse non clôturé.

**Ce qui existe déjà.** `employee_gaps` (migration 003) a la même forme que ce que ces requêtes attendent : `station_id`, `amount`, `status` (en_attente, accepte, conteste, regularise, cloture), et `kind` ('caisse' ou 'stock'). Chaque clôture de quart peut y créer un écart. `shifts.cash_gap` contient l'écart brut du quart.

| | Option A — créer `cash_gaps` | Option B — lire `employee_gaps` (recommandée) |
|---|---|---|
| Travail | Nouvelle migration + alimentation à la clôture de quart + reprise de l'historique | Remplacer 4 requêtes : `FROM employee_gaps WHERE station_id=$1 AND kind='caisse' AND status NOT IN ('cloture','regularise')` |
| Risque | Deux sources pour un même écart (doublons, incohérences) | Faible : table déjà alimentée et déjà isolée par station |
| Effet visible | Compteur à 0 au départ, puis alimenté | Les écarts existants apparaissent dès le déploiement (chiffre possiblement élevé la première fois) |
| À trancher | Qui clôture l'écart, et où | Les statuts « en_attente / accepte / conteste » comptent-ils comme « non clôturés » ? (proposé : oui) |

**Question pour vous :** option B, avec « non clôturé » = tout statut sauf `cloture` et `regularise` ?

## B2 — Réconciliation `POST /reconcile/run` (src/premium.js)
**Constat.** Le calcul interroge `sale_items`, `sa.deleted_at`, `shift_counters`, `products.quantity` et `products.status`, qui n'existent pas dans le schéma (les ventes sont dans `sale_details`, `sales` n'a pas de `deleted_at`, les index sont dans `pump_counters` / `meter_readings`, les quantités dans la table stock). Les erreurs étant avalées, le résultat est toujours « ok » : la réconciliation ne détecte rien.

**Décision métier à prendre : comment compter les litres de carburant vendus ?**
1. **Compteurs de pompe (`meter_readings`)** : litres = index final − index initial. C'est la valeur de référence physique ; elle est déjà utilisée à la clôture du quart.
2. **Lignes de vente (`sale_details`)** : litres facturés au client.
3. **Les deux, avec un écart toléré** (recommandé) : la réconciliation compare 1 et 2 par quart et signale l'écart au-delà d'un seuil (à fixer, par exemple 0,5 % ou X litres).

**Questions pour vous :** (a) option 3 ? (b) quel seuil de tolérance ? (c) les ventes annulées (`sales.status`) sont-elles exclues ? (proposé : oui, seules les ventes `valide` comptent).

**Livraison une fois tranché :** réécriture des requêtes, test statique des colonnes contre les migrations, et scénario de recette sur base réelle. Sans PostgreSQL ici, la logique ne pourra être confirmée que sur votre recette.
