# Signature personnalisée du compte client (2026-10-24)

- Super Admin : fiche contrat > ⑧ « Signature personnalisée du client » = Non autorisée / Manuscrite / Image / Les deux (défaut : non autorisée).
- Client : Paramètres > onglet « Signature » (tracé manuscrit et/ou image importée, nom du signataire, bouton Activer/Désactiver).
- Documents : une fois activée, la signature est apposée sur les cases « Signature » des PDF non encore validées par un intervenant (cases Employé / Client / Fournisseur exclues).
- Si le contrat est suspendu ou le mode retiré par le Super Admin, la signature n'est plus apposée.
- La « Signature imposée » (texte du contrat, en pied de page) reste inchangée.
- Migration à appliquer : 071_client_signatures.sql (npm run migrate).
