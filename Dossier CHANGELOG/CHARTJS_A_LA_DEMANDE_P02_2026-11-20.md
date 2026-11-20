# Chart.js chargé à la demande (P-02, approuvé)

Date : 2026-11-20
Branche : `perf/chartjs-a-la-demande` (depuis `main`), restauration : tag `point-restauration-p02`

## Modifications
- `public/index.html` : la balise `<script src="/vendor/chart.umd.min.js">` (201 Ko) est remplacée par un petit chargeur inline :
  - `whenChart(fn, onFail)` : exécute `fn` immédiatement si Chart est présent, sinon charge le fichier une seule fois puis exécute `fn`.
  - `chartTask(fn, delay)` : équivalent de `setTimeout` qui attend Chart avant d'exécuter `fn`.
- Points d'appel adaptés (le garde `typeof Chart === 'undefined' → return` ne rend plus le graphique absent) :
  - `app.js` (tableau de bord), `ext-core.js` (performance employé), `ext-p10.js` (2 graphiques), `ext-ux-v2.js` (2 graphiques), `ext-profit.js` (message de repli conservé si le chargement échoue).
  - Fonctions synchrones relancées après chargement : `ext-design.js`, `ext-direction.js`, `ext-my-profile.js`, `ext-product-profile.js`, `ext-profile-stats.js`, `ext-sa-dash.js` (2 points).
- `public/sw.js` régénéré (`npm run build:sw`, cache `smp-static-b8d7830e0c2`). Le fichier Chart.js reste pré-chargé par le service worker, donc disponible hors ligne après une première visite.

## Vérifications
- Syntaxe `node --check` : OK pour les 11 fichiers modifiés et le script inline d'`index.html`.
- Tests statiques : `sw-coherence` 8/8, `banner-static` 15/15, `repo-hygiene` 7/7, `pump-fuel-rule` 7/7, `dynamic-html-security` 10/10.
- Test navigateur (Playwright Chromium, serveur statique, API non simulée) :
  - au chargement de la page : 0 requête vers `chart.umd.min.js`, `typeof Chart` = `undefined` ;
  - premier appel à `whenChart` : 1 requête, `Chart` disponible ;
  - appel suivant : pas de nouvelle requête ; 0 erreur JavaScript.

## Non vérifié
- Affichage réel des graphiques dans chaque vue (données API absentes du test) : à contrôler sur l'application, vue par vue.
- `npm test` non exécuté (registre npm inaccessible depuis la session).
- Mesure Lighthouse avant/après non effectuée (pas d'accès npm).
