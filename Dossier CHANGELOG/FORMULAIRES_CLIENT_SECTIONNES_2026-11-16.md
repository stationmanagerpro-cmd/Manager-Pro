# Formulaires « Nouveau client + licence » et « Gérer client » — 16/11/2026

## Ce qui change (Superadmin)
- Les deux formulaires utilisent une mise en forme commune : en-tête, bande de licence, sections titrées en grille de 3 colonnes, pied avec Initialiser / Annuler / Enregistrer.
- **Nouveau client + licence** : sections Compte client, Administrateur local, Licence, Modules et droits du contrat, Notes.
- **Gérer client** : bande de licence (statut, jours restants, échéance, dernières opérations) avec Renouveler, Prolonger, Modifier l’échéance, Suspendre, Débloquer, Résilier le contrat ; sections Information administrative, Droits de création, Modules et droits du contrat, Signature et notes.
- La bande de licence était auparavant insérée après coup dans le DOM ; elle est maintenant rendue directement par le formulaire.
- Les champs, leurs identifiants et la logique de soumission ne changent pas.

## Fichiers
- `public/ext-sectioned-form.js` (nouveau) : `sectionedForm(titre, champs, valeurs, validation, options)`.
- `public/ext-contracts.js` : `clNew`, `clEdit`, bande `clLicenceBand`.
- `public/index.html` : chargement du nouveau script.
- `public/sw.js` : régénéré.

## Vérifications
- Rendu contrôlé sur captures (Playwright, données simulées) : formulaire de création et fiche de gestion.
- Tests statiques liés aux contrats et à la licence : OK (accounting, signature, contract-gates, set-expiry, step8, step18, step21, step66, detail-pages, links-audit, swallowed-errors).

## Non vérifié
- Rendu sur téléphone et en mode sombre.
- Enregistrement réel contre le serveur déployé.
