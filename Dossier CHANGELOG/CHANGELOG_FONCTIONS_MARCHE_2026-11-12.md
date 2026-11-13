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

## Audit des liens sources → fonctions (2026-11-12, suite)
- **Fidélité reliée à la vente** : les formulaires « Vente de carburant » (et « Vente de produit » si les points ne sont pas limités au carburant) proposent téléphone / plaque quand le programme est actif ; les points sont crédités automatiquement dans `POST /sales/fuel` et `POST /sales` (champ `loyalty`, jamais bloquant). « Créditer une vente » reste pour corriger après coup.
- **Rapprochement** : par défaut tous les modes de paiement de type Mobile Money de la station (Orange, Moov, Wave…), plus seulement le code `mobile_money`.
- **Prix du jour** : exige maintenant le module licence « Historique des prix », comme l'écran existant.
- **Alerte mobile** : produits en risque de rupture avant livraison (même calcul que l'écran de prévision).
- Test SQL : scénario G (vente → fidélité, mode Orange personnalisé, programme désactivé).

## Branchement des écrans manquants (2026-11-13)
Chaque route ou table du serveur qui n'avait aucun écran en a maintenant un (`public/ext-gaps.js`, `src/gaps.js`). Les écrans RH ne fonctionnent que si leur module est activé dans « Modules RH » : sinon un message explique comment l'activer.
- **RH** : Équipes, Compétences (+ catalogue), Formations (+ participants et résultats), Évaluations (modèles), Sanctions & récompenses, Mon espace RH ; dans les écrans existants : demande de congé + types, correction de présence, heures approuvées, réouverture de période, envoi des bulletins par e-mail + journal, modèle d'e-mail, test SMTP (table `smtp_diagnostics`).
- **Règles de paie** (ITS, INPS, AMO, charges patronales) : confirmation juridique, activation, désactivation, activation dans les bulletins.
- **Transferts de stock entre stations** (`stock_transfers`) : envoi, réception, annulation avec restitution.
- **Historique des compteurs** : changements de produit (`pump_counter_history`) + corrections d'index (`counter_events`, écrites par la correction d'index).
- **Prêts** : historique des remboursements (`personal_loan_payments`) depuis la Caisse.
- **Licence & modules** : quotas, catalogue des modules, journal des avertissements d'échéance (`license_warning_log`, alimenté par le planificateur d'alertes).
- **Mon tableau de bord** : masquer des cartes à titre personnel (`dashboard_widget_prefs`).
- **Estimation fiscale** et **historique des prix** (bouton dans Prix du jour).
Tests : `test/market-sql.js` (scénarios H et I), `test/gaps-ui-dom.js`.
