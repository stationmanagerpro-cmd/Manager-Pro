# Modernisation — Phase A (13 oct. 2026)

## Livré

### Onboarding « Premiers pas » (5 étapes gérant)
- Station → Pompes → Produits/seuils → Employés → Premier quart
- Barre de progression + détection auto (pompes/produits/employés/quarts existants)
- Bouton « J’ai terminé le guide » (mémorisé par utilisateur)
- Employés : parcours 3 étapes simplifié

### Pilotage direction (`direction`)
- KPI jour : ventes, carburant, litres, dépenses
- Totaux multi-stations (quarts ouverts, stock bas, employés, ventes)
- Alertes non lues + stock bas + tableau par station
- Entrée de menu + redirection login pour profils autorisés

### Rapport fin de journée (`eod`)
- Synthèse du jour, quarts clôturés, stock bas
- Impression navigateur (CSS print)

### Centre d’alertes enrichi
- Conserve la liste notifications + raccourcis Scanner / Messagerie / Direction

### États vides
- Helper global `emptyState()` utilisé dans direction, eod, alertes

### Mobile / PWA
- CSS scroll tableaux + 1re colonne sticky
- PWA déjà présente (manifest, sw.js, pwa.js) — meta theme-color ajoutée

## Fichiers
- public/ext-modern-pack.js (nouveau)
- public/app.css, public/index.html, public/ext-shell.js, public/app.js

## Phases suivantes (à enchaîner)
- B : raffinements PWA offline file + install banner UX
- C : rapports auto quotidiens (scheduler e-mail) unifiés
- D : exports comptables standard + fiche fin de journée PDF serveur
