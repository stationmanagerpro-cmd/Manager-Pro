# Profil personnel de chaque utilisateur (2026-11-02)

« Mon compte » / « Ma fiche » est remplacé par **Mon profil** (menu « Mon profil & aide »). Tous les utilisateurs l'ont : pompistes, caissiers, administrateur local, gérants, comptables, superviseurs, magasiniers, rôles personnalisés et rôles individuels. Chacun ne voit que SES données.

## Onglets
- **Vue d'ensemble** : identité (nom, matricule, poste, rôle, station, dernière connexion, photo), mes actions, mes autorisations, actions sensibles, actions faites à mon nom ; « ce que mon poste implique » ; diagrammes par module et par jour.
- **Mes indicateurs** (période 7 j / 30 j / 3 mois / 12 mois / Tout) : l'ordre des blocs dépend du poste.
  - Pompiste : mes ventes, mes quarts, mes écarts et anomalies, actions faites à mon nom.
  - Caissier : mes encaissements/décaissements, règlements clients reçus, ventes, écarts.
  - Comptable : activité par module, mouvements de caisse, dépenses saisies.
  - Superviseur / gérant / administrateur local : quarts dont je suis responsable ou que j'ai clôturés, écarts, activité, actions sensibles, heures d'activité.
- **Mes autorisations** : liste complète et recherchable des droits effectifs, groupés par domaine ; droits du rôle retirés par la station ; mention « rôle individuel » le cas échéant.
- **Mon journal** : journal unifié de trois sources (journal des écritures, audit détaillé avec anciennes/nouvelles valeurs, actions faites à mon nom) ; filtres date / source / module / recherche ; pagination ; **export PDF et Excel** avec nom, matricule, adresse IP, auteur. Une action faite à mon nom par un tiers peut être **rejetée** (jamais supprimée).
- **Mes bulletins** : reprise de l'existant (si fiche employé et module RH).
- **Sécurité & préférences** : dernières connexions (adresse, état), photo, mot de passe, thème, couleurs du menu, animations.

## Traçabilité
- Nouvelle table **`user_activity_log`** (migration 091, ajout seul comme `audit_logs`, sans clé étrangère) : chaque POST / PUT / PATCH / DELETE réussi d'un utilisateur connecté est enregistré avec **nom, matricule, rôle au moment de l'action**, route normalisée, module, libellé (« Annulation · Ventes »), identifiant visé, adresse IP. Le corps de la requête n'est **jamais** copié (ni mot de passe, ni montants saisis).
- Une erreur d'écriture du journal ne bloque jamais l'opération métier.
- Chaque export du profil est lui-même tracé dans `audit_logs`.
- Le journal des écritures démarre à la mise à jour : avant, seules les actions déjà couvertes par `audit_logs` apparaissent.

## Autres changements
- Le profil ne dépend plus du module RH du contrat (un utilisateur sans fiche employé garde son profil ; l'onglet bulletins et le rejet restent liés au module RH).
- Routes (lecture seule, personnelles) : `GET /me/profile`, `/me/profile/summary`, `/me/profile/permissions`, `/me/profile/activity`, `/me/profile/activity/modules`, `/me/profile/activity/export?format=pdf|xlsx`.
- Fichiers : `src/my_profile.js`, `src/activity_log.js`, `public/ext-my-profile.js|css`, `migrations/091_profil_personnel_journal.sql`, tests `test/my-profile-unit.js` et `test/my-profile-static.js` (`npm run test:my-profile`). Cache PWA `smp-static-v92`.

## Déploiement
1. Sauvegarde, puis `npm run migrate` (migration 091 : une table et un déclencheur, aucune donnée existante modifiée).
2. Redémarrer le serveur ; fermer/rouvrir l'application (cache PWA).

## Non validé (à faire sur le PC serveur)
- Exécution des requêtes SQL sur PostgreSQL réel (relues et testées avec une base simulée uniquement).
- Rendu visuel de l'écran (clair / sombre / téléphone) et téléchargement réel des PDF / Excel.
- Les autres tests de la suite n'ont pas pu être relancés ici (dépendances npm absentes) ; les tests statiques touchés par les libellés ont été relancés et passent.

## Points à décider
- Vue d'un autre utilisateur par l'administrateur local (profil d'un collègue en lecture seule) : non incluse, l'audit global et la fiche employé existent déjà.
- Durée de conservation du journal des écritures (il grossit à chaque écriture) : aucune purge n'est prévue.
