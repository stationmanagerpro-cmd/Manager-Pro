# Dépense + Vente depuis les pages Quart et Ventes — 2026-10-27

## Ce qui change
**Page Ventes** (`public/app.js`, `vVentes`)
- Nouveau bouton **Dépense** : ouvre le MÊME formulaire que « Nouvelle dépense » de la caisse (`addX` : catégorie, montant, mode, bénéficiaire, commentaire ; mêmes droits `expense.create`).
- Libellé **Quart N° X (En cours…)** en rouge, ou « Aucun quart ouvert ».

**Page Quart** (`public/app.js`, `vQuart`)
- **Minuterie** (HH:MM:SS) du temps écoulé depuis l'ouverture du quart.
- Lignes **Crédit**, **Dépense** (total + nombre) et **Chef de quart**.
- Boutons **＋ Vente** (même formulaire que la page Ventes) et **Dépense** (même formulaire que la caisse).

**Serveur** (`src/shifts.js`, `GET /shifts/current`) : renvoie en plus `expenses {n,total}`, `credit {n,total}`, `chief`.
- Dépenses : même requête que la fiche complète du quart (`expenses` du quart, non supprimées).
- Crédit : paiements `credit` du quart, ventes valides uniquement (même règle que `finance.js`).
- Chef de quart : employé au rôle « Responsable » du quart, sinon le gérant qui a ouvert le quart.

## Liaisons conservées / renforcées
- Une dépense enregistrée est automatiquement rattachée au quart ouvert (`/expenses`), débite la caisse ou le compte choisi, alimente le journal financier, l'audit, la fiche complète et le rapport de clôture, et le calcul de caisse théorique.
- `addX` rafraîchit désormais la page d'où il a été ouvert (Quart, Ventes, Caisse, Finance) au lieu de renvoyer toujours vers Caisse.
- Une vente (produit ou carburant) saisie depuis le Quart ramène sur le Quart : totaux, crédit et dépenses à jour.
- Cache PWA : `smp-static-v62`.

## Fichiers modifiés
public/app.js, public/ext-core.js, public/sw.js, src/shifts.js
