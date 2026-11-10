# Étape 64 — Formules d’abonnement personnalisables

## Changements
- Chaque ligne de la page « Offres d'abonnement (packs) » propose un bouton **Modifier**.
- Le formulaire permet de modifier le nom, la description, la durée, le nombre maximal d’utilisateurs/stations, le prix indicatif, l’ordre d’affichage et les modules actifs.
- Le bouton **Ajouter une formule** permet de créer une offre avec un code unique.
- Les offres sont enregistrées dans `subscription_packs` ; aucune migration n'est requise si la migration `020_subscription_modules.sql` a déjà été appliquée.
- Lorsqu’un pack est appliqué à un client, les modules standard sont définis selon le pack. Les modules spécifiques du client qui ne font pas partie de la liste standard sont conservés, pour permettre des exceptions individuelles.

## À savoir
- Les modules dans le formulaire sont saisis sous forme de codes séparés par des virgules (ex. `sales, stock, reports`).
- Le code d’une offre existante est volontairement non modifiable afin de préserver les références `client_contracts.pack_code`.
- Le prix est indicatif : ce changement n'ajoute pas de paiement automatique.
- Tests exécutés : contrôles syntaxiques Node.js et tests statiques. Aucune connexion réelle à Neon/Render ni test visuel dans navigateur n'a été exécuté.
