# CHANGELOG — Rattachement des ventes par employé et message WhatsApp de fin de quart (2026-11-08)

## Cause du rattachement erroné
À la création d'une vente carburant (`src/fuelsales.js`), l'employé était choisi dans cet ordre : employé envoyé par l'écran, puis employé lié à l'utilisateur connecté, et seulement ensuite l'affectation de la pompe. Une vente de la pompe du 2e employé pouvait donc être enregistrée au nom du 1er (par exemple employé affecté « sans pompe » ou utilisateur connecté = 1er employé).

## Corrections
| Fichier | Changement |
|---|---|
| `src/shift_sales_check.js` (nouveau) | Règle pure : la pompe affectée à l'ouverture fait foi ; contrôle des ventes à la clôture |
| `src/fuelsales.js` | Employé = responsable de la pompe ; demande au nom d'un autre employé refusée (409, noms indiqués) ; pompe partagée : choix explicite exigé ; pompe sans responsable : comportement historique |
| `src/shifts.js` | Clôture (aperçu compris) : vérification de chaque vente carburant ; une vente au nom d'un autre employé que le responsable de sa pompe BLOQUE la clôture (409, liste des ventes). Nouvelle route `POST /shifts/:id/sales/:saleId/reassign-to-pump-owner` (permission `shift.close`, quart ouvert) : remet la vente au responsable, audit + anomalie « rattachement » |
| `public/app.js` | Aperçu de clôture : bouton « Remettre au responsable de la pompe » pour chaque vente bloquante |
| `src/shift_message.js` (nouveau) | Gabarit unique du message individuel de fin de quart |
| `src/finance.js` | `shareMessage` individuel utilise le gabarit |
| Tests | `test/shift-attribution-message-unit.js` (nouveau), `shift-close-attribution-unit.js` (+2 contrôles), `shift-attribution-share-unit.js` (libellé) |

## Message WhatsApp individuel
Identique au modèle fourni (comparaison caractère pour caractère dans le test). Variantes : excédent de caisse, caisse équilibrée, absence d'écart de stock / d'anomalie, durée en heures, ventes réattribuées citées dans les anomalies. Heures dans le fuseau `APP_TZ` (sinon `FLEET_TZ`, sinon Africa/Bamako).

## Limites
- Les ventes de produits (hors carburant) n'ont pas de pompe : elles restent au nom de l'employé saisi.
- Le message « complet » destiné à la personne qui clôture n'a pas été modifié.
- Si l'affectation des pompes à l'ouverture est elle-même fausse, la correction par bouton ne convient pas (elle suit l'affectation) : il faut alors corriger l'affectation.
- Requêtes SQL (clôture, création de vente) non exécutées sur une vraie base.

## Correctif unités : écarts de caisse (FCFA) / écarts de stock (quantités)
Un écart de stock est une quantité (litres ou unités) ; il ne doit jamais porter de devise ni être additionné à un écart de caisse. Il était pourtant stocké dans les mêmes colonnes « montant » que les FCFA et affiché avec `m()` (devise) à plusieurs endroits.
| Fichier | Correction |
|---|---|
| `src/shift_message.js` | Écarts de stock : quantité arrondie à 2 décimales, sans devise (-4,707 → -4,71) ; un écart n'est écrit qu'une fois (pas de « (-4,71 FCFA) » en double) ; noms de produits nettoyés (plus de « Essence  : ») ; le montant des autres anomalies n'est pas affiché hors de leur texte |
| `src/finance.js` | PDF individuel « Vos anomalies » : stock affiché « -4,71 (quantité) » au lieu de FCFA ; rapport « personnel en service » : l'écart par employé n'additionne plus caisse + stock (`kind <> 'stock'`) |
| `src/employee_actions.js` | Historique d'actions de l'employé : un écart de stock n'est plus enregistré dans la colonne montant (FCFA) et son libellé porte la quantité avec l'unité du produit |
| `public/ext-core.js` | RH : « Créer la dette » n'est plus pré-remplie avec une quantité de stock prise pour des FCFA |
| `test/shift-attribution-message-unit.js` | Contrôle des unités (valeur brute -4.707, aucune ligne stock avec FCFA, aucune somme caisse + stock) |
Les écarts déjà enregistrés avant ce correctif restent tels quels en base (anciennes actions affichées en FCFA dans l'historique).

## Vérification du message destiné au clôturant (mêmes règles d'unités)
Constat : le message « complet » (et le PDF complet, et l'écran du rapport) reprenaient tels quels les libellés d'anomalies enregistrés à la clôture : écart de caisse sans séparateur ni devise (« -28150 »), écart de stock en valeur brute à 3 décimales sans unité (« -4.707 »), noms de produits avec espace en trop, et ces écarts étaient répétés (situation par employé + anomalies).
| Fichier | Correction |
|---|---|
| `src/finance.js` | Message et PDF du clôturant : écarts de stock nettoyés (nom sans espace en trop, 2 décimales, sans devise) ; « Anomalies par employé » n'y répète plus les écarts de caisse/stock (déjà dans la situation par employé, chacun avec son unité) — valable aussi pour les rapports déjà enregistrés |
| `src/shifts.js` | Libellés créés à la clôture : caisse « -28 150 FCFA », stock « -4,71 » + unité du produit (ou « (quantité) »), noms nettoyés — pour tous les écrans, PDF et messages futurs |
| `public/app.js` | Écran du rapport : écarts de stock arrondis, noms nettoyés |
| Tests | `shift-attribution-share-unit.js` (+1 contrôle sur le message du clôturant), `shift-close-attribution-unit.js` (libellé caisse) |
Non modifié : les anomalies saisies à la main (texte libre) sont reprises telles quelles.

## Mode Focus (bouton « Focus »)
Constats : (1) la grande bannière d'accueil, dimensionnée en unités de fenêtre (vw), restait affichée dans la colonne étroite du mode Focus : nom coupé en plein mot (« STATIO / N DE TEST »), bouton « Accéder aux ventes » et logo énormes ; (2) la vente rapide proposait le premier employé du quart quel que soit le compteur choisi — même défaut de rattachement que celui corrigé plus haut (désormais refusé par le serveur).
| Fichier | Correction |
|---|---|
| `public/app.css` | En Focus : bannière compacte (nom ≤ 22 px, sans slogan ni bouton, logo réduit), plus de hauteur forcée sur la page et la carte de vente rapide |
| `public/ext-improvements.js` | Vente rapide : le pompiste est choisi automatiquement (et verrouillé) d'après la pompe du compteur ; pompe sans responsable → choix manuel avec message |
| `test/focus-mode-harness.js` (nouveau, `npm run test:focus-mode`) | 6 contrôles navigateur : pompiste par pompe, vente envoyée au bon employé, bannière en écran 390 px |
Non vérifié : comportement sur votre appareil réel et sur une vraie base ; l'écran « Aucun quart ouvert » de votre capture est normal (aucun quart ouvert).
