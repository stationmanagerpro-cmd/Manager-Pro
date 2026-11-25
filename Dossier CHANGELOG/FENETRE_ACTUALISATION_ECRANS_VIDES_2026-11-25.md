# Fenêtre « Actualisation en cours » réservée aux écrans vides — 2026-11-25

Demande du propriétaire (3 captures de téléphone, 08:46 et 08:47) : la fenêtre apparaît à chaque actualisation et tarde à disparaître, même quand la page est déjà affichée derrière.

## Cause (code lu)
`public/ext-loader.js` s'affichait immédiatement et ne disparaissait qu'une fois les cartes du tableau de bord remplies (plus aucun `.skeleton`), donc après la réponse lente de `/dashboard`.

## Changement (`public/ext-loader.js`, `public/sw.js` régénéré : `smp-static-bca59a9b332`)
- Fenêtre affichée seulement si l'écran reste vide plus de 1,2 s (plus d'éclair à chaque actualisation rapide).
- Retirée dès que la page est affichée (bandeau décidé et contenu ou cases de chargement présents). Les cases de chargement et le message « Chargement en cours… » de la page (`.sk-wait`, après 6 s, avec bouton Recharger) prennent le relais.
- Si la page est affichée mais que les données dépassent 8 s sans message de chargement : fenêtre avec bouton « Recharger la page ».
- Écran vide après 8 s : bouton « Recharger la page » (inchangé).
- `test/qr-static.js` : vérifications mises à jour (29/29).

## Vérification réelle
Chrome, fichier réel, 6 situations : actualisation rapide (jamais affichée) ; écran vide 3 s puis page affichée (absente avant 1,2 s, présente à 1,9 s, retirée dès l'affichage) ; écran vide 9 s (fenêtre et bouton) ; données lentes avec `.sk-wait` (pas de fenêtre) ; données très lentes sans `.sk-wait` (fenêtre à 8 s, retirée à l'arrivée) ; bandeau en attente (fenêtre, retirée à la pose du bandeau). Suite complète : 225/247, identique.
Non vérifié : téléphone réel. Effet esthétique seulement : l'attente elle-même vient de la distance serveur-base (Oregon, Singapour), voir `docs/ETAT_ACTUEL.md`.
