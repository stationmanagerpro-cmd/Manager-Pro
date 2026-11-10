# Module Comptabilité (plan comptable OHADA) — v28

Migration **079_comptabilite.sql** · API `/api/accounting/*` (src/accounting.js, moteur pur src/accounting_engine.js) · UI `public/ext-accounting.js` · menu **Comptabilité**.

## Autorisation par le Superadmin (contrat client)
Formulaire de contrat (création et édition) → section **⑩ Comptabilité OHADA** : accès au module + 5 options
(`accounting_entries` saisie manuelle, `accounting_assets` immobilisations, `accounting_vat` TVA, `accounting_closing` exercices/clôture, `accounting_export` export CSV).
Pack prêt à l'emploi : **« Complet + Comptabilité OHADA »**. Désactivé par défaut (comme la Fiscalité) ; une option cochée active automatiquement le module.
Contrôle côté API (`server.js`) **et** côté interface (menu + onglets). Permissions : `accounting.view` (ADMIN, COMPTABLE, GERANT), `accounting.manage` (ADMIN, COMPTABLE).

## Principe : aucune double saisie
Les écritures sont **dérivées** des modules existants, donc toujours cohérentes (modifier/annuler une opération corrige la compta) :

| Source | Écriture |
|---|---|
| Ventes boutique (`sales`), compteurs de pompes des quarts clôturés (`meter_readings`), ventes carburant des quarts ouverts | Dr 571/521/551/411 · Cr 7011/7012/7013 · Cr 4431 (TVA) |
| Règlements clients, factures hors vente + règlements, avoirs clients | Dr trésorerie · Cr 411 ; Dr 411 · Cr 706/4431 ; Dr 709 · Cr 411 |
| Achats (réception → 408, facture → 401), règlements/avoirs fournisseurs | Dr 601 · Cr 408/401 ; Dr 401 · Cr trésorerie/609 |
| Dépenses (catégorie → compte par mots-clés, défaut 638) | Dr charge · Cr trésorerie |
| Paie (bulletins validés/payés), avances | Dr 661 (+664) · Cr 422/431/4251 ; Dr 422 · Cr trésorerie |
| Trésorerie : remises en banque/virements (585), frais bancaires (631), écarts de caisse (658/758), mouvements non rattachés (471) | |
| Stocks (inventaire permanent, valeur = qté × prix d'achat) | Dr/Cr 311 · Cr/Dr 6031 aux fins de mois et à la date d'arrêté |
| Soldes initiaux (solde clients, caisses, comptes, stock initial) | Journal AN : Cr 101 « Apports et soldes d'ouverture » |
| Immobilisations (saisies ici) | Acquisition, dotations mensuelles (linéaire, prorata jours), cession/rebut |
| Écritures manuelles (OD, AN…) | Saisies ici, équilibre vérifié en API **et** par trigger PostgreSQL différé |

## Liaisons avec les fonctionnalités existantes
- **Trésorerie** : une immobilisation « payée maintenant » ou une cession encaissée appelle `settle()` → vrai mouvement de caisse / compte bancaire / Mobile Money.
- **Verrouillage de période** (`period_locks`) et **exercices clôturés** : refus de toute écriture manuelle / immobilisation sur la période.
- **Créances & dettes / Clients / Fournisseurs** : onglet *Synthèse & contrôles* compare 411, 401/408, 571, 521, 551 aux soldes réels des modules et signale tout écart (avec la marche à suivre).
- **Contrats / Superadmin**, **permissions**, **audit** (`audit()` sur chaque écriture, annulation, clôture), **journal d'ouverture** et **export CSV** (anti-injection `csv_safe`).

## Hypothèses à connaître
1. Prix de vente **TTC** : TVA = montant × taux / (100 + taux). Pas de TVA déductible automatique sur achats (écriture manuelle au débit 4452).
2. Stock valorisé au **prix d'achat courant** du produit (pas d'historique de coût).
3. Écarts ventes/encaissements → compte d'attente **471** (signalé en contrôle). Les dettes fournisseurs antérieures au module doivent être reprises par une écriture AN (Dr 101 / Cr 401) si le contrôle signale un écart.
4. Dettes envers le personnel hors bulletins (dettes employés) non comptabilisées séparément (incluses dans 431).
5. Les annulations d'exercice ne génèrent pas d'écritures de clôture : le résultat antérieur passe automatiquement en **report à nouveau**.

## Tests
`npm run test:accounting` (moteur : 319 contrôles dont équilibre de chaque écriture, bilan Actif = Passif, TVA, amortissements, stock ; câblage statique : 61 contrôles).
Aucun test d'intégration SQL n'a pu être exécuté dans l'environnement de livraison (pas de PostgreSQL) : **lancer `npm run migrate` puis `npm test` sur la base de test avant mise en production**.
