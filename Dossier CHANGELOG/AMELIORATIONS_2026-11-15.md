# Améliorations du 15 novembre 2026

- **Modules vendables** : « Marges et rentabilité » (module_profit) et « Alertes application mobile » (module_mobile) s'activent/désactivent par contrat ; actifs par défaut pour les contrats existants. Blocage côté serveur (/reports/client-profit, /mobile) et menu masqué. Ajoutés au groupe « Clients, flottes et trésorerie ».
- **État du système** (Superadmin, menu utilisateur) : version, base de données (latence), migrations, abonnements push, messages et actions des dernières 24 h.
- **Mode pompiste** (menu ⚡) : trois gros boutons — ouvrir mon quart, enregistrer une vente (si quart ouvert), enregistrer une dépense.
- **Son de la cloche** (menu utilisateur, par appareil, désactivé par défaut).
- **Push avec texte réel** : contenu chiffré (RFC 8291, vecteur officiel testé). Alertes automatiques : texte affiché ; messages privés : texte générique. Migration 107 (clés de l'appareil). Les appareils déjà abonnés reçoivent le texte générique jusqu'à leur prochaine ouverture de l'application.
- **Manuel** : Sommaire (page 2) rempli avec liens cliquables ; version 10.
