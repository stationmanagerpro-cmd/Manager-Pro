# Compteurs de pompe : produit Carburant imposé côté serveur (2026-11-20)

## Cause
- L'interface ne proposait que les produits de la catégorie CARBURANT pour les compteurs, mais le serveur acceptait n'importe quel produit de la station (appel direct à l'API).

## Modifications
- `src/catalog.js` : fonction `assertFuelProduct` (produit de la station, catégorie CARBURANT). Appelée par :
  - `POST /pumps` (chaque compteur à la création) ;
  - `PATCH /pumps/:pumpId` (uniquement si le produit d'un compteur change) ;
  - `PUT /pumps/:pumpId/counters/:n`.
- Réponse : 400 avec un message explicite si le produit n'est pas du carburant.
- Compteurs déjà reliés à un produit non carburant : inchangés tant qu'on ne modifie pas leur produit.
- `public/sw.js` : non concerné (aucun fichier front modifié).

## Vérifications
- Syntaxe : `node --check src/catalog.js` OK.
- Requête SQL vérifiée sur PostgreSQL 16 (base `smp_check`) : plan valide ; catégorie `CARBURANT` présente.
- `test/station-scope-catalog-static.js` 5/5 ; `test/tenant-isolation-static.js` 11/11.

## Non vérifié
- Exécution des routes avec le serveur complet (dépendances npm absentes : registre injoignable). Un test d'API de bout en bout reste à faire.
