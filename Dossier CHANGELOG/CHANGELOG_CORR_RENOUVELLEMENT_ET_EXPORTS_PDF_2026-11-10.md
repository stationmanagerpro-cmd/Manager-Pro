# Correctifs V1.11.32 — 2026-11-10

## 1. Demandes de renouvellement : bouton « Accepter » / « Traiter » (« Erreur interne »)
- `src/contracts.js`, route `POST /admin/license-renewal-requests/:id/process` :
  - `UPDATE client_contracts` : tous les paramètres sont typés explicitement (`$2::timestamptz`, `$4::boolean`, …) ; dates envoyées en ISO ; `suspended_by` remis à NULL.
  - Écriture du journal d'audit déplacée dans la transaction (atomique).

## 2. Exports PDF (« Rapport invalide »)
- `public/ext-branded-pdf.js` : le rapport est mis aux limites du serveur avant envoi (textes tronqués, sections invalides écartées, images trop lourdes remplacées) ; le message d'erreur affiche le détail renvoyé par le serveur.
- `src/docs.js` : logo illisible, réglage de pied de page ou devise absents n'empêchent plus la génération du PDF.
- `src/docs_render.js` : les refus de validation sont journalisés (`[docs/render] Rapport invalide — …`).

## Déploiement
Redéployer, puis Ctrl+F5 côté navigateur. Si une erreur persiste : relever le message affiché et la ligne `[500]` / `[docs/render]` des journaux Render.

## 3. Cache du service worker
- `public/index.html` : `ext-branded-pdf.js?v=2` ; `public/sw.js` régénéré (`npm run build:sw`, cache `smp-static-b984b2a1bf1`). Sans cela, les navigateurs continuaient de servir l'ancien `ext-branded-pdf.js` depuis le cache (cache-first).

## 4. Facturation clients : mêmes filtres que Bon de commande + export PDF (Bon de commande et Facturation)
- `public/ext-billing.js` : barre de filtres Recherche (n° / client), Client, Statut, Règlement (non réglée / partielle / soldée), Du / Au, Filtrer, Réinitialiser ; bouton « Exporter en PDF » (filtres appliqués, totaux, tableau) ; dates affichées en JJ/MM/AAAA.
- `src/billing.js` : `GET /invoices` accepte `q` et `payment` (en plus de `status`, `customer_id`, `from`, `to`) ; limite portée à 1000.
- `public/ext-purchase-orders.js` : bouton « Exporter en PDF » (filtres appliqués, totaux engagé / payé / reste).
- `public/index.html` + `public/sw.js` régénéré (`?v=2`, cache `npm run build:sw`).

## 5. Animations des onglets plus fluides
- Nouveau `public/ext-tabs-motion.css` (chargé en dernier, `?v=1`) : transitions de 320 ms à courbe douce sur tous les onglets (horizontaux, verticaux, sous-onglets, fiches produit/employé), léger flottement au survol et sur l'onglet actif, appui réduit au clic ; fondu + glissement doux du contenu à chaque changement d'onglet/vue (`#pg`) ; ouverture plus douce des fenêtres modales.
- Respecte le réglage « animations désactivées » (`data-motion="off"`) et `prefers-reduced-motion`.
- `public/index.html` et `public/sw.js` régénéré (cache `smp-static-ba46707cab8`).

## 6. Mon profil : photo cliquable
- `public/ext-my-profile.js` / `.css` : un clic (ou Entrée / Espace au clavier) sur la photo de la fiche « Mon profil » ouvre « Changer ma photo » ; infobulle et pastille « 📷 Changer » au survol (toujours visible sur écran tactile). `?v=2` + `sw.js` régénéré.
