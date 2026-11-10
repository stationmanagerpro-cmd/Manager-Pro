# Étape 54 — Politique par défaut du code d’accès

## Changement
Lorsque aucune politique `access_key_policy` n’a encore été enregistrée, le serveur active désormais la demande de clé si au moins une clé est au statut `disponible` et n’est pas expirée. Si aucune clé utilisable n’existe, l’accès reste ouvert afin d’éviter de bloquer tous les comptes. Une politique explicitement enregistrée par le Superadmin reste prioritaire. `ACCESS_KEY_DISABLE=1` continue de désactiver le verrouillage en secours.

## Fichiers
- `src/access_keys.js`
- `test/access-key-default-policy-static.js`
- `package.json` (script `test:access-key-default-policy`)

## Tests effectués
- `node --check src/access_keys.js` : réussi.
- `node test/access-keys-unit.js` : 8/8 réussis.
- `node test/access-key-default-policy-static.js` : 7/7 attendus.

## Limites
Aucun test d’intégration HTTP avec PostgreSQL n’a été exécuté. Le comportement de première connexion doit être validé après migration 053 et après vérification qu’une clé active existe. Le code d’accès n’est pas forcé si aucune clé n’a été créée, afin d’éviter un verrouillage général.
