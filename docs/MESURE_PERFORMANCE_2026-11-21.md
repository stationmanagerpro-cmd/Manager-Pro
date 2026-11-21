# Mesure de performance : coquille de l'application — 2026-11-21

## Périmètre et méthode
- Page mesurée : `public/index.html` (écran de connexion et coquille de l'application). **Les appels API ne sont pas inclus** : le serveur ne tourne pas dans cette session. Les chiffres sont donc une borne basse ; la page après connexion charge davantage de données.
- Outils : Chromium (Playwright), serveur de fichiers local, émulation mobile 390×844, réseau 4G simulé (4 Mbit/s en réception, 150 ms de latence), CPU du téléphone ralenti ×4. Une moyenne de 3 essais par configuration.
- Limites : pas d'appareil réel ; simulation approximative ; réseau local pour le serveur.

## 1. Poids des fichiers chargés par la page
- 124 fichiers statiques référencés, dont **101 scripts JavaScript**.
- Brut : **2 322 Ko**. Compressé gzip -9 : **755 Ko** (−67 %).
- Plus lourds (brut) : `app.js` 106 Ko, `ext-core.js` 105 Ko, `ext-contracts.js` 76 Ko, `ext-messaging.js` 71 Ko, `home-editor.js` 71 Ko.

## 2. Chargement dans Chromium
| Configuration | Requêtes | Transfert | Chargement (moyenne) |
|---|---|---|---|
| Sans limite de débit, CPU normal | 128 | 2 483 Ko | ≈ 300 ms (local) |
| 4G simulée, sans compression | 123 | 2 289 Ko | **5 787 ms** |
| 4G simulée, gzip activé | 123 | 715 Ko | **3 906 ms** (−33 %) |
| Sans limite de débit, CPU ×4 (gzip) | 123 | 715 Ko | **764 ms** |

## 3. Lecture
- Sur 4G simulée, le temps est dominé par le **transfert** : environ 3,1 s sur 3,9 s avec gzip. Le traitement JavaScript sur un téléphone lent (≈ 0,8 s) pèse moins.
- **La compression gzip** est le gain le plus rentable : −69 % d'octets transférés.
- Le nombre de requêtes (101 scripts) ajoute de la latence : chaque fichier coûte un aller-retour réseau. Regrouper les scripts réduit ce coût, mais l'ordre de chargement doit être revérifié (chantier P-01 arrêté).

## 4. Décision du propriétaire (2026-11-21)
- Compression gzip **retenue** après réflexion : implémentée dans `src/static_gzip.js` (voir `Dossier CHANGELOG/COMPRESSION_STATIQUE_2026-11-21.md`). Gain mesuré : 5,8 s → 3,9 s en 4G simulée.

## 5. Actions restantes (non appliquées)
- Vérification sur le serveur réel après déploiement (en-tête `Content-Encoding`).
1. Mettre des en-têtes de cache longs sur les fichiers versionnés (`?v=…`).
2. Revoir le regroupement des scripts (P-01) avant toute modification.

## 6. Reproduction
Scripts de mesure : `/tmp/claude-0/-home-claude/15957a5d-9bb0-5e96-ada2-c21a1e338d05/scratchpad/perf/` (`throttle.js`, `gz.js`, `load.js`). Ils ne sont pas versionnés.
