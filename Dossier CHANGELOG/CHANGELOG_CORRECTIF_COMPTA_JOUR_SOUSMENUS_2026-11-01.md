# Correctifs 2026-11-01 — Comptabilité (mode jour) et sous-menus masqués par l'en-tête

## 1. Comptabilité illisible en mode jour
- Cause : les cartes de synthèse (`.tr-card`, texte blanc imposé) étaient créées avec les classes `ok`, `bad` ou vide, qui n'ont aucun fond (seules les classes `c-green`, `c-blue`… en ont un). Texte blanc sur fond clair en mode jour ; invisible seulement en jour car le mode nuit a un fond sombre.
- `public/ext-accounting.js` : chaque carte reçoit une vraie couleur (Produits vert, Charges orange, Résultat vert/rouge selon le signe, Trésorerie turquoise, Clients indigo, Fournisseurs violet, TVA due ardoise ; idem onglets TVA et Immobilisations). L'ancienne notation `''`/`ok`/`bad` est convertie automatiquement.
- `public/ext-accounting.css` : filet de sécurité (fond garanti si une carte est créée sans couleur).

## 2. Sous-menus du menu latéral cachés par l'en-tête fixe
- Cause : `#app-header` (sticky, z-index 100) passait au-dessus du menu latéral (z-index 80), qui contient les sous-menus flottants → la partie du sous-menu située sous l'en-tête (titre + premières lignes) était masquée.
- `public/responsive-v3.css` : sur écran > 860 px, `#app-header { z-index: 79 }` (sous le menu, au-dessus du contenu). Modales (100) et calculatrice inchangées. Mobile (tiroir) inchangé.

## Technique
- Cache du service worker : `smp-static-v83` ; `ext-accounting.js?v=2`, `ext-accounting.css?v=2`. Aucune migration SQL.
- Après déploiement : Ctrl+F5 (ou fermer/rouvrir l'onglet) pour purger l'ancien cache.

## 3. « Erreur interne » en changeant le thème / les couleurs du menu (diagnostic)
- Routes concernées : `PUT /me/preferences/theme`, `PUT|DELETE /me/preferences/nav-colors`, `PUT /me/preferences/motion` (`src/auth.js`).
- Cause exacte non reproductible sans la base : le code, le schéma `user_preferences` et `audit_logs` sont cohérents. 
- `src/auth.js` : l'écriture au journal d'audit ne bloque plus l'enregistrement de la préférence (erreur seulement journalisée : `[prefs] audit non enregistré`).
- `src/core.js` : toute erreur 500 est maintenant journalisée avec la route et le code Postgres (`[500] PUT /api/... — [code]`), pour identifier la vraie cause dans le terminal du serveur.
- `check-db-write.js` (racine) : script de diagnostic — teste les écritures (préférences, audit, conversations, séquences, base en lecture seule) puis annule tout. `node check-db-write.js`.
