# Messagerie : « Vu » (accusés de lecture) et « En ligne » (présence) — 2026-11-01

## « En ligne »
- Une personne est **en ligne** tant que son application garde le flux temps réel ouvert (connexion à ManagePro, quelle que soit la page affichée).
- Liste des discussions et en-tête : **pastille verte** sur l'avatar ; en-tête : « En ligne » (vert) ou « Vu aujourd'hui à 14:32 / hier à … / le … » ; groupes : « N en ligne ».
- Mise à jour instantanée (évènement `presence`) à la connexion / déconnexion, et filet de sécurité toutes les 20 s.
- Confidentialité : la présence n'est visible que pour les personnes avec qui l'on partage au moins une conversation (`GET /messaging/presence`). Pas d'annonce pour les « Messages à tous ».
- Migration **087_messaging_presence.sql** (table `user_presence` : dernière activité). Sans elle, « En ligne » fonctionne mais « Vu à… » reste « Hors ligne ».

## « Vu »
- Sous chacun de **vos** messages : ✓ envoyé · **✓✓ Vu** (heure de lecture) · en groupe **✓✓ Vu par 2/5** (survol : qui et à quelle heure) · **✓✓ Vu par tous**.
- Les accusés ne concernent que vos propres messages ; vous ne voyez jamais qui a lu les messages des autres. Détail nominatif limité aux discussions de 20 destinataires au plus.
- En direct : quand le destinataire ouvre la discussion, le serveur envoie un évènement `read` et le ✓✓ apparaît sans recharger.

## Technique
- `src/realtime.js` (présence, `notifyRead`), `src/messaging.js` (accusés dans `GET .../messages`, `GET /messaging/presence`), `public/ext-messaging.js`, `public/design-v2.css`.
- Cache : `smp-static-v84`, `ext-messaging.js?v=2`.
- Test : `npm run test:messaging-presence` (5 contrôles, dont le module temps réel avec base simulée).
- **Déploiement : `npm run migrate`** puis redémarrage du serveur, puis Ctrl+F5.
- Limite : la présence est en mémoire (un seul processus serveur, comme le temps réel existant).
