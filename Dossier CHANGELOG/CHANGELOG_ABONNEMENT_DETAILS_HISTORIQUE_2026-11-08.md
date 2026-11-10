# Espace Abonnement — nouvelle présentation (2026-11-08)

- « Détails de votre abonnement » : titre à gauche, bouton **Envoyer la demande** à droite (ouvre la fenêtre de demande : durée souhaitée + détails), tableau INFORMATION / DÉTAIL à en-tête de la couleur de marque (État, Date de fin, Jours restants, Renouvellement), message d'expiration dessous.
- Nouveau bloc **Historique des abonnements** : opérations de licence du client (création, renouvellement, prolongation…) avec statut, début, fin, durée, puis liste de ses **demandes de renouvellement** (en attente / acceptée / refusée). Message « Aucun historique… » si vide.
- Nouvelle route `GET /me/license/history` (lecture seule, client courant uniquement ; ni auteur ni notes d'administration exposés).
- Après l'envoi d'une demande, l'écran se rafraîchit : la demande apparaît dans l'historique.
- Fichiers : public/ext-contracts.js, src/contracts.js, public/sw.js (cache v106), test/subscription-payment-ui-static.js.
