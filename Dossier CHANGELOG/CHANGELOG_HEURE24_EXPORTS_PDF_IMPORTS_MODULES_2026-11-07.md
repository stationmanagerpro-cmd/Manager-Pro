# CHANGELOG — Heure 24 h, exports PDF Caisse/Employés, imports Excel dans les modules (2026-11-07, rev41)

1. **Heure en 24 h** — nouveau `public/ext-time24.js` (chargé en premier) : `Date#toLocaleTimeString` / `toLocaleString` utilisent `hourCycle: 'h23'` si le code n'impose pas déjà hour12/hourCycle. Corrige la messagerie (« Vu aujourd'hui à 19:16 », heures des bulles et de la liste) et tous les autres affichages de date/heure.
2. **Caisse et dépenses** — bouton « 📄 Export PDF » (`caissePdf()` dans `ext-p5.js`) : indicateurs, caisses, comptes MM/banques, dépenses et journal financier du jour.
3. **Imports Excel dans les modules** — `ext-import.js` : barre « ⬇ Modèle Excel / 📥 Importer (Excel) » affichée en haut des pages Produits (prod), Clients (cli), Fournisseurs (four), Employés (emp) et Ventes (ventes), seulement si le type d'import est autorisé (droits + contrat). La liste se recharge après l'import. La page « Imports Excel » reste disponible.
4. **Employés** — bouton « 📄 Export PDF » (`empPdf()` dans `ext-core.js`) : liste affichée (active ou inactive), filtre « Rechercher » respecté, salaire de base uniquement pour les profils RH/paie.
Versions de cache : `ext-core.js?v=2`, `ext-p5.js?v=2`, `ext-import.js?v=2`.
