# Carte Super Admin : tous les clients + comptes actifs (22/10/2026)

## Problème
La vue *Carte des stations* affichait « Administrateur Principal : les données métier des stations sont interdites » : la route `/stations/map` est bloquée par le garde-fou serveur qui isole le Super Admin des routes de station.

## Correction
- **API** : `GET /admin/platform/clients-map` (Super Admin uniquement, route sous `/admin` donc autorisée). Renvoie les stations actives avec leurs coordonnées GPS, un récapitulatif par client et la liste des comptes utilisateurs actifs. Aucune table métier de station n'est lue.
- **Comptes** : « actif » = compte actif, non supprimé, rattaché à un client (les comptes Super Admin sont exclus). « Connecté » = au moins une session ouverte (non révoquée, non expirée).
- **Carte** : marqueur vert = au moins un compte connecté sur la station, bleu = aucun. La fenêtre d'info indique comptes actifs / connectés.
- **Page** : indicateurs (clients, stations localisées, comptes actifs, comptes connectés), tableau des clients, tableau des stations, tableau filtrable des comptes (client, rôle, stations, dernière connexion, statut), bouton Actualiser.
- Cache PWA : `smp-static-v20`.

## Test
`node test/station-map-static.js`

## Correctif (23/10/2026) — carte vide chez le Super Admin
- Cause : la carte demandait le jeton Mapbox à `/config/map`, route absente de la liste autorisée du garde-fou Super Admin → message « données métier interdites » à la place de la carte.
- Correction : `/config/map` (jeton public pk.*, aucune donnée métier) ajouté à la liste autorisée. Redémarrer le serveur pour appliquer.
