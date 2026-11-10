# Période personnalisée et profils en onglets (2026-10-27)

- Nouveau public/ext-period-range.js : raccourcis 30 j / 3 mois / 12 mois / Tout + bouton « 📅 Personnalisé » (calendrier Du … au …, raccourcis Ce mois / Mois dernier / Cette année / Année dernière). Période partagée entre toutes les fiches.
- API : `?period=custom&from=AAAA-MM-JJ&to=AAAA-MM-JJ` sur /products/:id/profile, /customers|suppliers/:id/stats, /hr/employees/:id/stats et leurs PDF. Dates validées strictement ; invalide → 12 mois ; dates inversées remises dans l'ordre ; courbe par jour jusqu'à 62 jours, sinon par mois.
- Listes client, fournisseur, employé : boutons « Fiche » / « Profil » retirés, la ligne ouvre le profil.
- Profils client, fournisseur, employé : onglets horizontaux comme le produit, onglet « Comportement » (jours forts, heures, rang, rythme, délai de livraison, meilleure journée), carte d'identité avec actions, doublons supprimés (ancien bloc d'infos fournisseur, anciennes cartes de chiffres, champs répétés de l'identité employé).
- Liens entre fiches : clic sur une barre de diagramme → produit, client, fournisseur ou employé (selon les droits).
- Cache du service worker : smp-static-v64.
- Tests : test:profile-stats-period et test:product-profile étendus. Aucune migration de base.
