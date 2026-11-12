# Fonctions « marché » — 2026-11-12

Migration **105_fonctions_marche.sql** (tables loyalty_settings, loyalty_accounts, loyalty_events, client_portal_links). Elle déclenche la sauvegarde pré-migration (pg_dump client 18 déjà dans le Dockerfile).

1. **Rapprochement relevé Mobile Money ↔ ventes** : bouton « Rapprocher avec les ventes » dans la fenêtre de rapprochement ; déclarés non reçus, reçus non déclarés, par jour, par pompiste. (`GET /api/money/sales-reconcile`)
2. **Fidélité téléphone / plaque** : menu Clients → Fidélité ; points sans carte, utilisation, ajustement motivé, envoi du solde par WhatsApp. Désactivée par défaut (⚙ Réglages).
3. **Risque des quarts** : menu Exploitation → Risque des quarts ; score 0-100 expliqué (écart, annulations, anomalies, répétition).
4. **Prévision de rupture** : Stock → Prévision de rupture ; date de rupture et date de commande conseillée selon le délai de livraison.
5. **Espace client** : Clients → Espace client ; lien privé `/c/<jeton>` (jeton haché, expirant, révocable, lecture seule, sans identifiant interne).
6. **Prix du jour** : changement groupé des prix carburant, historique, marge recalculée (visible seulement avec le droit coûts).

Tests : `test/market-sql.js` (6 scénarios sur vrai PostgreSQL), `test/market-ui-dom.js` (rendu Chromium).
Non fait : alertes mobiles de rupture, champ téléphone/plaque dans le formulaire de vente (crédit depuis l'écran Fidélité).
