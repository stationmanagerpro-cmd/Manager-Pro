# Confort visible — A5, A4, A6, A9 (23/10/2026)

Affichage uniquement : aucun calcul, aucune migration, aucune valeur modifiée en base.

- **A5 Chiffres, dates, statuts** : fonctions communes `f()` (montants « 2 845 000 FCFA », « −2 500 FCFA »), `fq()` (quantités « 1 840,5 L »), `dt()` (« 21/10/2026 16:53 ») et `dts()` (avec secondes, journal d'audit seulement), table `STATUS_FR` (Clôturé, Ouvert, Annulé, Facturé, Reçu, Commandé). Appliquées aux Quarts (statut, écart de caisse, litres) et à l'audit ; un filet d'affichage (`ext-confort.js`) corrige les statuts bruts, les litres à point décimal et les secondes sur les autres pages.
- **A4 Barre du haut** : une seule ligne dès 1280 px (titre et recherche se rétrécissent). Style homogène des en-têtes, tableaux et boutons des pages principales.
- **A6 Pompes** : un seul tableau, une ligne par compteur (pompe, emplacement, statut, compteur, produit, index courant, dernier clôturé, clôture, actions) ; « Ajouter une pompe », « Corriger index » (motif ≥ 3 caractères, audité), « Produit », liens Stock et Quarts conservés.
- **A9 Alertes** : un seul élément de menu « Alertes » avec onglets À traiter, Configuration, Règles de notification, Historique. Les anciens liens (`alertcfg`, `notifrules`) ouvrent le bon onglet. Message clair si l'e-mail n'est pas configuré (`GET /messaging/email-status`, sans valeur secrète).
- Cache PWA : `smp-static-v22`.

Test : `node test/confort-static.js`
Non vérifié : rendu visuel réel en 1280 / 1600 / 1920 px, tablette, téléphone et mode nuit.

## Correctif : tableaux coupés sur petit écran (23/10/2026)
- Cause : une règle `overflow: hidden` sur `.tw` (app.css d'origine, et une règle ajoutée avec A4) masquait les colonnes en trop.
- Correction : barre de défilement horizontale visible en bas de tous les tableaux (`.tw`, `.tw-auto`, `.dv2-tw`, tableaux sans enveloppe dans les pages et fenêtres), sur tous les écrans. Cache PWA : `smp-static-v23`.

## Zone PUB en bas du menu de gauche (23/10/2026)
- Les images publicitaires du client (jusqu'à 5, réglées par le Super Admin dans la fiche client) s'affichent tout en bas du menu de gauche, en ordre aléatoire, et défilent toutes les 60 s par défaut (délai réglable de 10 à 3600 s par le Super Admin). Clic : agrandissement dans un petit pop-up.
- Rien n'apparaît si le panneau n'est pas activé et publié, ou sans image. Zone masquée quand le menu est replié ou l'écran très bas.
- Les images ne s'affichent plus sur le tableau de bord (le texte reste en bandeau). Aucune migration. Cache PWA : `smp-static-v24`.
- Test : `node test/sidebar-pub-static.js`

## A8 — Aide intégrée, manuel et mode démonstration (23/10/2026)
- **Manuel** : le PDF est servi par l'application (`/manuel/Manuel_Utilisation_Manager_Pro.pdf`). Menu *Mon compte & aide → Manuel & aide* : bouton d'ouverture + liste des chapitres (ouverture à la bonne page).
- **Boutons « ? »** : à côté du titre des pages Quarts, Clôture, Ventes, Pompes, Produits/Stock, Fournisseurs/Achats, Clients, Caisse, Employés, Rapports, Alertes, Rôles ; et dans les fenêtres « Ouverture de quart », « Vente de carburant », « Corriger index », « Commande ». Ils ouvrent le chapitre correspondant.
- **Mode démonstration** (administrateurs de station uniquement) : station fictive « Badialan 3 » (3 pompes, 8 produits, 4 clients, 3 fournisseurs et commandes, 5 employés, 5 quarts, 6 ventes, caisses). Bandeau orange fixe + cadre orange. Aucune lecture ni écriture réelle : `api()` renvoie l'échantillon local, les écritures sont simulées, et `fetch()` refuse toute écriture vers `/api` (seule la déconnexion passe). Recharger la page quitte la démonstration.
- Écrans disponibles en démonstration : Quarts, Ventes, Pompes, Produits, Clients, Fournisseurs/Achats, Employés, Caisse. Les autres affichent « Cet écran n'est pas disponible dans le mode démonstration ».
- Aucune migration. Cache PWA : `smp-static-v25`. Test : `node test/demo-mode-static.js`.
- Non vérifié : rendu visuel du bandeau/cadre, et preuve sur une vraie base PostgreSQL (aucune base ici ; la preuve repose sur l'absence de tout appel réseau d'écriture).
