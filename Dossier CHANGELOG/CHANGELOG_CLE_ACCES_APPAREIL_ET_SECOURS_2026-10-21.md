# Clé d'accès : appareil de confiance + recours Superadmin (2026-10-21)

> Reporté sur la **V8 (MAJ 21/10/2026)** : les fichiers de la clé étaient identiques entre V4 et V8, report sans conflit. Cache du service worker : `smp-static-v17` → `v18`. Non repris ici : la correction des tableaux coupés (voir CHANGELOG_CORRECTIF_TABLEAUX_COUPES) n'est pas dans cette V8.

## Problème signalé
Le Superadmin s'est retrouvé bloqué : sa clé avait expiré, il ne pouvait plus atteindre la connexion, donc plus générer de nouvelle clé (impasse).

## Causes
1. Le « laissez-passer » d'un appareil ne durait que `pass_minutes` (60 min par défaut). Ensuite l'appareil devait ressaisir une clé… déjà utilisée par lui (`ALREADY_USED`) ou expirée (`EXPIRED`) → blocage.
2. Aucun recours si plus aucune clé valable n'existait alors que l'exigence de clé était activée.

## Corrections
- **Une clé = une utilisation par appareil, puis appareil de confiance** : un appareil qui a saisi une clé valide n'a plus à la ressaisir ; son laissez-passer est renouvelé silencieusement. L'**expiration** d'une clé ne ferme que l'enrôlement de *nouveaux* appareils. La **révocation** d'une clé retire la confiance des appareils enrôlés avec elle (action volontaire de sécurité).
- **Code de secours Superadmin** (menu « Clé d'accès » → « 🛟 Code de secours ») : 16 caractères, **usage unique**, affiché une seule fois, stocké uniquement haché, généré après confirmation du mot de passe du Superadmin. Il s'utilise depuis l'écran de clé (« Clé expirée ou perdue ? Code de secours Superadmin ») et n'ouvre que l'écran de connexion : **le mot de passe reste obligatoire**. Compteur d'essais propre (n'interfère pas avec la saisie de clé). Journalisé (`recovery`, `recovery_generate`, `recovery_revoke`).
- **Commande serveur** (sans connexion à l'application) : `npm run access:rescue -- status | open | new-key [heures] | new-recovery`, ou `scripts\windows\SECOURS_CLE_ACCES.bat <commande>`. Journalisée (`rescue_cli`).
- Bandeaux d'alerte dans « Clé d'accès » : aucune clé active / aucun code de secours défini.

## Pour vous débloquer maintenant
- **Sans rien installer** : dans `.env` du PC serveur ajoutez `ACCESS_KEY_DISABLE=1`, redémarrez le serveur, connectez-vous (mot de passe requis), activez une nouvelle clé, générez le code de secours, puis retirez la ligne du `.env` et redémarrez.
- **Après installation de cette version** : l'appareil qui avait déjà saisi une clé est reconnu automatiquement. Sinon, sur le PC serveur : `SECOURS_CLE_ACCES.bat new-key 24` puis saisissez la clé affichée, ou `open`.
- Pas de migration de base à exécuter. Redémarrer le serveur, puis Ctrl+F5 sur chaque poste.

## Fichiers
`src/access_keys.js`, `src/access_keys_logic.js`, `src/home_page.js`, `public/ext-home.js`, `public/sw.js` (cache v16), `scripts/access-key-rescue.js`, `scripts/windows/SECOURS_CLE_ACCES.bat`, `package.json`, tests.

## Tests
- `node test/access-keys-unit.js` : 10/10 réussis (exécuté).
- `node test/access-keys-gate-sim.js` : 9/9 scénarios (exécuté) avec **base factice** (flux : clé expirée + appareil enrôlé, nouvel appareil refusé, révocation, code de secours à usage unique, verrou). Un test de mutation confirme que le scénario « appareil de confiance » échoue si la correction est retirée.
- Tests statiques existants liés à la clé (`access-key-default-policy-static`, `home-login-key-static`, `step35…`) : réussis.
- Suite complète statique + unitaire de la V8 : 83 réussis / 12 en échec **avant et après** ce report (mêmes 12 fichiers : l'échec préexiste dans la V8 livrée, il n'est pas lié à la clé).

## Limites (à valider chez vous)
- **Aucun test avec une vraie base PostgreSQL** n'a été exécuté ici : les requêtes SQL nouvelles (consommation atomique du code de secours, appareil de confiance, script de secours) ont été relues mais pas exécutées. `test/access-keys.js` (HTTP + base de test) a été mis à jour (ancien attendu `409 ALREADY_USED` → `200 trusted`, ajout du scénario de secours) mais **n'a pas pu être lancé** : à exécuter sur la base de test avant déploiement.
- L'interface (écran de clé, section de secours) n'a pas été testée dans un navigateur avec le serveur réel.
- Le code de secours n'est affiché qu'une fois : s'il est perdu et qu'aucun appareil de confiance n'est disponible, il faut la commande serveur.
