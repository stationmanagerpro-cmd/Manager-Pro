# CHANGELOG — Messages privés, bandeau unique, signalement attribué, rapports par employé, boutons d'import (2026-11-08)

## 1. « Discussion de groupe » sur les messages d'anomalie
Cause : les messages système (anomalie, écart, rejet, alerte) sont créés dans une conversation marquée `is_group = TRUE`, dont les seuls membres sont les destinataires. Elle n'est donc visible par personne d'autre, mais l'écran l'affichait « Discussion de groupe ».
- `src/messaging.js` : la liste renvoie `is_system_conv` (conversation système sans créateur).
- `public/ext-messaging.js` : libellé « Notification privée · N destinataires », icône 🔔.
- `src/employee_actions.js` : anomalie / écart → employé concerné + personne qui l'a enregistrée (clôturant) + administrateurs locaux ; rejet d'une action → employé + auteur + administrateurs locaux. Titre « Anomalie — Nom ». Autres actions : employé seul (inchangé).

## 2. En-tête (bandeau) dupliqué
Cause : `paint()` lisait `#hero` avant l'attente du chargement de l'image ; deux rendus simultanés insérant chacun un bandeau. `public/ext-banner.js` : rendu annulé s'il y en a un plus récent, `#hero` relu après l'attente, purge de tout doublon. Valable site et application (même code).

## 3. Rapports envoyés aux employés
Vérifié : PDF et message individuels ne contiennent que les pompes, ventes, écarts et anomalies de l'employé. Deux fuites corrigées (`src/finance.js`) : un rapport clôturé avant la séparation par employé partait en version complète (collègues, caisse globale) vers chaque employé par e-mail et WhatsApp. Désormais : refus (409) s'il y a plusieurs employés, message neutre côté WhatsApp ; seul employé du quart : inchangé.

## 4. Signalement d'anomalie
`src/shifts.js` : un employé du quart qui signale depuis son accès se voit attribuer l'anomalie (même en quart partagé) ; la mention « signalée par l'employé lui-même » ou « par X (rôle) » figure dans l'historique de l'employé, l'alerte, l'e-mail, l'écran du rapport, le PDF et les messages (individuel : « par vous-même »). Les écarts automatiques ne portent pas cette mention.

## 5. Boutons d'import
`public/ext-import.js` : plus de seconde barre sur Clients, Fournisseurs, Produits (qui ont déjà « Importer » et « Modèle »). Sur les autres écrans la barre reste, libellée « Modèle » / « Importer ».

Cache : `sw.js` smp-static-v103, `ext-banner.js?v=2`. Test : `test/correctifs-2026-11-08-static.js`.
Non vérifié : requêtes SQL et tests unitaires (dépendances npm absentes ici), rendu sur appareil. `shift-attribution-static` échouait déjà avant (attend `smp-static-v9x`).
