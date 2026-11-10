# Correctif lisibilité — texte blanc sur fond clair (boutons) — 2026-11-01

- Symptôme : sur la fiche employé (et beaucoup d'autres écrans), les sélecteurs de période « 30 j / 12 mois / Tout / Personnalisé », certains onglets, puces et boutons-icônes (ex. ✎ des comptes de trésorerie) s'affichaient en blanc sur fond clair.
- Cause : `design-v2.css` forçait `button:not(.b2):not(.bd):not(.bg){ color: var(--on-p) !important }` ; toute règle de classe (`.ps-seg button`, `.tr-edit`, `.ac-chip`…) était écrasée. En mode nuit, `app.css` contenait aussi `:root[data-theme=dark] button{color:#06231e}` de forte spécificité.
- Correction : `design-v2.css` → règle passée en `:where(...)` sans `!important` (spécificité 0) + filet de sécurité pour les boutons à fond transparent défini en ligne ; `app.css` ligne 207 → `:where(...)`. Les boutons pleins gardent le texte `--on-p` ; tout bouton qui définit sa propre couleur la conserve.
- `public/sw.js` : cache `smp-static-v86` → `v87`.
- Vérification : `node test/contrast-audit.js` → 0 bouton illisible (avant : 32 échecs, `.tr-edit`) ; tests statiques UI relancés OK. Aucune migration SQL.

## Complément (cause réelle côté exécution)
- `public/ext-core.js` (`paint()`) injectait au démarrage `<style id="thm">button:not(.b2):not(.bd){color:#fff!important}`, placée après toutes les feuilles : c'est ce qui rendait blancs les onglets Trésorerie / Créances & dettes / Comptabilité et les sélecteurs de période des profils (employé, client…). Passée en `:where(...)` sans `!important`.
- `public/sw.js` : cache `v87` → `v88`.
