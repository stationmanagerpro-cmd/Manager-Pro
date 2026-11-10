# Intégration de la messagerie interne

## Fichiers livrés

| Fichier | Rôle |
|---------|------|
| `migrations/029_messaging.sql` | Tables conversations, messages, attachments, alert config, broadcast roles |
| `src/messaging.js` | API complète + `sendSystemAlert()` pour les modules métier |
| `public/ext-messaging.js` | Interface utilisateur + badges Infos |

## 1. Migration

```bash
# Copier la migration dans le projet
cp migrations/029_messaging.sql /chemin/vers/station-manager-pro/migrations/
npm run migrate
```

## 2. Monter les routes (server.js)

Dans `src/server.js`, après les autres `app.use` (et après le middleware contrat) :

```js
app.use('/api', require('./messaging').r);
```

Ajouter aussi le contrôle de feature dans le middleware contrat existant (optionnel, déjà géré dans messaging.js) :

```js
if (path.startsWith('/messaging') && !featureOn(contract, 'can_use_messaging') && !featureOn(contract, 'module:messaging')) {
  return res.status(403).json({ error: 'Messagerie non incluse dans votre contrat.' });
}
```

## 3. Frontend

Dans `public/index.html`, ajouter avant `ext-shell.js` :

```html
<script src="ext-messaging.js"></script>
```

Dans `public/ext-shell.js` (TREE), ajouter dans le groupe adapté, par ex. « Mon compte & aide » ou un nouveau groupe :

```js
{ label: 'Messagerie', icon: '💬', keys: ['msg'] }
```

## 4. Feature flags contrat (Super Admin)

Dans `client_contracts.features` (JSONB), clés à gérer :

```json
{
  "can_use_messaging": false,
  "messaging_attachments": false,
  "messaging_groups": false,
  "messaging_broadcast": false,
  "can_use_auto_alerts": false
}
```

Toutes **false par défaut**. Activation uniquement par l’Administrateur Principal via le centre de gestion des fonctionnalités / édition du contrat.

## 5. Appels depuis les modules métier

### Envoyer un bulletin / document

```js
const { sendSystemAlert } = require('./messaging'); // côté serveur non
// Côté route RH après génération PDF :
// appeler l'endpoint POST /api/messaging/send-document
// ou depuis le front : sendDocByMessaging(userId, pdfPath, fileName, 'application/pdf', 'Votre bulletin')
```

### Alerte automatique (écart de caisse, stock…)

```js
const { sendSystemAlert } = require('./messaging');

await sendSystemAlert({
  clientId: station.client_id,
  employeeUserId: employee.user_id,  // utilisateur lié à l'employé
  kind: 'cash_variance',
  body: `Écart de caisse de ${amount} FCFA détecté sur le quart #${shiftId}.`,
  refTable: 'shifts',
  refId: shiftId,
  stationId: station.id
});
```

## 6. Permissions UI

- Si `can_use_messaging` = false → écran avec bloc **Infos** (pourquoi / qui / comment).
- Si messagerie OK mais `messaging_attachments` = false → texte OK, pas de jointure.
- Broadcast : flag contrat + rôle autorisé par admin local (`messaging_broadcast_roles`).

## 7. Sécurité

- Toutes les requêtes filtrent `client_id`.
- Pas d’accès inter-clients.
- Super Admin plateforme n’utilise pas la messagerie métier.
- Téléchargement pièce jointe : membership conversation + même client.

## 8. Tests manuels recommandés

1. Contrat sans flag → écran verrouillé + Infos.
2. Activer `can_use_messaging` → conversations OK.
3. Sans `messaging_attachments` → envoi texte OK, jointure 403.
4. Deux clients différents → isolation totale.
5. Broadcast sans rôle → 403 ; avec rôle GERANT → OK.
6. `sendSystemAlert` avec flag off → no-op ; avec flag on → message système reçu.
