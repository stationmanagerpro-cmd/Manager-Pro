# Étape 30 — Partie 3 (13 oct. 2026)

## Point 3 / 13 — Multistation compte client
- Nouveau module `public/ext-multistation.js` : vue **Mes stations**
  - Liste des stations accessibles (`ME.stations`)
  - Quota contrat (max / création autorisée / limite atteinte)
  - Création via `POST /stations` (limites serveur respectées)
  - Bascule de station active (`chSt`)
  - Isolation rappelée (données non mélangées)
- Menu Administration client : entrée **Mes stations**
- `newStation` redirige vers le parcours unifié `msCreateStation` (rafraîchit `/me`)

## Point 10 — Identité / écran de connexion (Super Admin)
- Onglet Identité déjà présent dans le centre admin (non masqué pour `is_global`)
- Carte **Identité / login** ajoutée sur le hub Super Admin → `goAdminTab('identity')`
- Configuration : logo, fond login, couleurs, panneau pub (`ext-brand-admin.js` + `/admin/branding`)

## Point 8 — PDF situation client (Super Admin)
- API : `GET /admin/clients/:id/situation.pdf` (`needPrincipal`)
- Contenu : identité, contrat, stations, utilisateurs, modules/flags, preuves backup_logs, renouvellements, synthèse d’alertes
- Pas d’affirmation de « sauvegarde réussie » sans entrée journalisée
- Bouton **Exporter PDF situation** sur la fiche client (`clientdetail`)

## Point 7 — Menus horizontaux
- **Non traité** dans cette partie (refonte large). Reporté.

## Fichiers
- public/ext-multistation.js (nouveau)
- public/index.html
- public/ext-shell.js
- public/ext-p12.js
- public/ext-detail-pages.js
- src/contracts.js
