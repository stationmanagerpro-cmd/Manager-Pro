# Profils station : identité puis agrégats statistiques (2026-10-25)

- Nouvelles routes (src/profile_stats.js, lecture seule, isolées par station) :
  - GET /customers/:id/stats  — achats sur 12 mois, remboursements, panier moyen, répartition des paiements, top produits, factures par état, solde et utilisation du crédit.
  - GET /suppliers/:id/stats  — achats et paiements sur 12 mois, commandes par statut, top produits, dette, taux de règlement, échéances dépassées.
  - GET /hr/employees/:id/stats — CA attribué et quarts sur 12 mois, écarts par statut, ventes par produit, dettes/avances, 6 derniers bulletins.
- Montants sensibles masqués selon les permissions existantes (receivable.view, debt.view/purchase.pay/finance.view, hr.payroll/hr.debts ou fiche personnelle).
- Interface (public/ext-profile-stats.js, styles dans ext-sa-dash.css) : carte d'identité en premier, puis indicateurs, courbes et carte « Situation face à l'entreprise ».

## Filtre de période et export PDF (2026-10-25)

- `GET /customers/:id/stats`, `/suppliers/:id/stats`, `/hr/employees/:id/stats` acceptent `?period=30d | 3m | 12m | all` (défaut `12m`, toute autre valeur retombe sur `12m`). 30 jours : courbe par jour ; 3 mois / 12 mois : par mois ; « Tout » : par mois, limité aux 60 derniers mois (mois vides du début retirés).
- La période pilote : la courbe, les ventes/achats, le panier ou la commande moyens, les modes de paiement, les produits, les factures (client), les commandes par statut (fournisseur), le CA attribué, les quarts et les écarts (employé), les remboursements et paiements « de période ».
- Restent indépendants de la période (situation actuelle ou cumul, libellés « cumul / total ») : solde dû, limite et utilisation du crédit, dette fournisseur, total facturé / payé / taux de règlement, échéances dépassées, dettes et avances d'employé, 6 derniers bulletins, première et dernière date.
- Réponses : nouveau bloc `meta` ({ period, label, gran, from, to }) et noms du client / fournisseur / employé. Employé : `revenue_12m`, `shifts_12m`, `operations_12m` deviennent `revenue`, `shifts`, `operations` (valeurs de la période choisie) ; la variation « mois en cours vs précédent » reste calculée sur les deux derniers mois quelle que soit la période.
- Export PDF de la vue globale : `GET /customers/:id/stats.pdf`, `/suppliers/:id/stats.pdf`, `/hr/employees/:id/stats.pdf` (même période, mêmes permissions que l'écran ; un montant masqué à l'écran l'est aussi dans le PDF). Mise en page et en-tête de la station via `docs.buildPdf`.
- Les erreurs SQL de ces routes sont désormais journalisées (`[profile_stats]`) au lieu d'être avalées ; la section concernée reste vide comme avant.
- Interface : sélecteur « 30 j · 3 mois · 12 mois · Tout » et bouton PDF en tête de la vue globale ; le bloc se recharge sans quitter la fiche ; la période choisie est conservée d'une fiche à l'autre pendant la session. Cache du service worker passé à `smp-static-v51`.
- Tests : `npm run test:profile-stats-period` (période, paramètres SQL, masquage des montants, calculs, PDF, interface ; sans base de données).
