# Étape 45 — Cohérence de la configuration A5

## Modifications
- Mise à jour du guide de livraison et de la procédure d’exploitation pour exiger simultanément `RESTORE_ENABLED=1` et `RESTORE_TARGET_ISOLATED=1`.
- Ajout d’un exemple `.env.pc.example` avec restauration complète, verrou d’isolation, réinitialisation globale et restaurations spécialisées désactivés par défaut. Les valeurs de connexion/secrets sont des exemples à remplacer.
- Le préflight Windows signale également `RESTORE_TARGET_ISOLATED=1` comme un drapeau sensible.
- Le test statique A5 contrôle la cohérence entre route, UI, exemple de configuration et documentation.

## Limites
Ce contrôle ne prouve pas que la base cible est isolée. `RESTORE_TARGET_ISOLATED=1` reste une déclaration de l’opérateur, pas une vérification cryptographique ou réseau de la cible. Aucun cycle PostgreSQL réel n’a été exécuté dans cette étape. La restauration complète doit rester désactivée en production.
