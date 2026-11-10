# Carte Mapbox des stations (22/10/2026)

## Ce qui change
- **Base** : migration `066_station_geolocation.sql` → colonnes `stations.latitude` / `stations.longitude` (facultatives, bornées −90..90 / −180..180, renseignées ensemble ou pas du tout).
- **Saisie** : l'administrateur local renseigne Latitude et Longitude dans *Paramètres → Général*, dans *Administration → Station* et à la création d'une station. Virgule ou point acceptés ; champs vides = station non localisée.
- **API** : `PATCH /stations/current` et `POST /stations` acceptent les coordonnées ; `GET /stations/map` (stations du compte client, ou toutes pour le Super Admin) ; `GET /config/map` (jeton public Mapbox).
- **Carte** : nouvelle vue *Carte des stations* (menu Administration / Clients & licences) + carte intégrée à *Mes stations*. Marqueur bleu = station, vert = station active ; popup nom / client / adresse / téléphone.
- **Sécurité** : CSP ouverte uniquement vers `api.mapbox.com`, `events.mapbox.com`, `*.tiles.mapbox.com` ; popup construit en DOM (pas d'injection HTML) ; jeton secret `sk.` refusé.

## Déploiement
1. `npm run migrate`
2. (recommandé) définir `MAPBOX_TOKEN=pk.…` ; à défaut le jeton public du fichier fourni est utilisé. Restreignez-le par URL dans votre compte Mapbox.
3. Redémarrer l'API (le cache PWA passe en `smp-static-v17`).

## Test
`node test/station-map-static.js`
