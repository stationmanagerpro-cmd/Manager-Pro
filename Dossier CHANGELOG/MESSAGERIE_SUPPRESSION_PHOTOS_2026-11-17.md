# Messagerie : suppression de discussions et photos en ligne (2026-11-17)

## Ce qui change

1. **Supprimer une discussion** : un bouton 🗑 sur chaque discussion de la liste, avec confirmation.
2. **Supprimer plusieurs discussions** : bouton « Sélectionner » dans l'en-tête de la liste ; cocher les discussions ; bouton « Supprimer (n) » ; confirmation qui indique le nombre.
3. **Photos en ligne** : les images envoyées en pièce jointe (JPEG, PNG, GIF, WebP) s'affichent en miniature dans la conversation. Un clic ouvre la photo en grand (visionneuse avec « Télécharger » et « Fermer », touche Échap acceptée). Les autres fichiers gardent le bouton de téléchargement.

## Décision : suppression « pour moi » (masquage par participant)

- La discussion disparaît uniquement pour la personne qui la supprime. Les autres participants la conservent.
- Rien n'est effacé en base : les messages et conversations restent présents (utile pour la traçabilité).
- Si un nouveau message arrive, la discussion réapparaît, mais l'utilisateur ne voit que les messages postérieurs à sa suppression (comportement type « supprimer le chat » sur les messageries grand public).
- Les anciens messages de cette discussion sont marqués comme lus pour cet utilisateur, donc ils ne gonflent plus les non-lus ni la cloche.
- Raison : le schéma n'avait ni `deleted_at` par participant ni flag par utilisateur ; `deleted_at` sur `conversations` aurait fait disparaître la discussion pour tout le monde, ce qui n'était pas voulu.

## Serveur (`src/messaging.js`)

- `DELETE /api/messaging/conversations/:id` : masque la discussion pour l'utilisateur courant. 403 si la personne n'est pas membre ou si la discussion n'appartient pas à son client.
- `POST /api/messaging/conversations/bulk-delete` avec `{ "ids": [..] }` : masque plusieurs discussions. Entre 1 et 100 identifiants (au-delà : 400). Réponse : `{ ok, requested, removed, ids }`. Seules les discussions accessibles (membre, même client) sont masquées ; les autres ids sont ignorés silencieusement et ne comptent pas dans `removed`.
- Isolation : pour un utilisateur de client, le filtre `c.client_id` est appliqué côté serveur. Pour le superadmin, seule l'appartenance à la conversation compte (même règle que la liste existante).
- La liste des conversations et l'historique d'une conversation masquée filtrent les éléments antérieurs à `hidden_at`.
- Une entrée d'audit `Suppression de discussion(s) pour soi` est écrite à chaque masquage (ids des conversations en détail).

## Migration

- `migrations/119_conversation_hidden.sql` : `ALTER TABLE conversation_members ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ`. Idempotente, non destructive.
- Numéro 119 et non 118 : au moment de la modification, un autre fichier `118_platform_alert_rules.sql` existait déjà (non créé par ce changement, non touché).

## Photos (`public/ext-messaging.js`)

- Les pièces jointes sont stockées sous `UPLOAD_DIR/messaging/<client>/` et servies par `GET /api/messaging/attachments/:id/download`, qui exige le jeton Bearer et l'appartenance à la conversation. Le front ne peut donc pas utiliser une simple `<img src>`.
- Le front récupère l'image avec `fetch` + en-têtes d'authentification (même schéma que les photos de profil), crée un `Blob` typé avec le `mime_type` du message, puis une URL blob pour `<img>`.
- Les URL blob sont révoquées (`URL.revokeObjectURL`) lors d'un changement de discussion et à la sortie de la messagerie. Un chargement encore en cours au moment de ce nettoyage ne crée pas d'URL orpheline (compteur de génération).
- En cas d'échec de chargement : texte « Photo indisponible », un clic télécharge le fichier.
- Aucune route serveur ajoutée pour les photos, aucun changement de contrôle d'accès ; le SVG n'est pas accepté à l'envoi, donc pas de risque de script dans l'image.

## Fichiers modifiés

- `src/messaging.js` (liste, historique filtré, 2 routes, helper `hideConversationsFor`)
- `public/ext-messaging.js` (liste avec sélection, suppression, miniatures, visionneuse, styles injectés)
- `migrations/119_conversation_hidden.sql` (nouveau)
- `public/sw.js` (régénéré par `npm run build:sw`)
- Ce changelog

Non touchés : `public/ext-sa-dash.js`, `public/ext-p12.js`, `src/usage_report.js`, et les fichiers modifiés par d'autres intervenants.

## Vérifications

- `node --check` : `src/messaging.js` et `public/ext-messaging.js` OK.
- Tests statiques messagerie (tous OK, identiques à la base) : messaging-attachment-security, messaging-unread-notifications, messaging-presence, messaging-dark-mode, messaging-bell-opens-unread, messaging-recipient-search, messaging-superadmin-contact-role, messaging-support-title, roles-messaging, b1-messaging-attachments-direct, tenant-isolation-static, migration-safety, dynamic-html-security.
- `migration-numbering-static` : OK après renommage de ma migration en 119. Il échouait avant ce renommage, à cause du doublon 118 (voir ci-dessus).
- Base PostgreSQL 16 jetable (`smp_scratch_msg`) : les 119 migrations s'appliquent sans erreur. Les requêtes SQL exactes ajoutées (liste filtrée, masquage avec `RETURNING`, marquage lu, historique filtré, cloche) ont donné les résultats attendus : masquage pour soi seulement, réapparition sur nouveau message, historique limité, pas de non-lus anciens, aucune suppression physique.
- `npm run -s build:sw` : OK (`sw.js` généré, 128 fichiers pré-chargés). Ce build inclut les fichiers en cours des autres intervenants présents dans `public/` au moment de l'exécution.

## Non vérifié

- **Routes HTTP réelles** : `express` et `pg` ne sont pas installés dans `node_modules` (dossiers vides dans cet environnement) et le registre npm est bloqué, donc le serveur n'a pas été démarré. Les routes elles-mêmes n'ont pas été appelées ; seules leurs requêtes SQL ont été exécutées.
- **Interface dans un navigateur** : aucun test visuel ni fonctionnel (sélection, confirmation, miniatures, visionneuse, mode sombre, téléphone).
- **Serveur déployé** : non testé.
- Le test de bout en bout de la photo (jeton, blob, révocation) n'a pas été exécuté.
