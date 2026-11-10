# Étape 29 — Interface Super Admin : autorisations contractuelles complètes

## Constat (vérifié dans le code)

Le formulaire Super Admin → client (création / modification de contrat) n’exposait qu’une partie des flags utilisés par le serveur (`src/server.js`, `src/messaging.js`, `src/admin.js`, `src/contracts.js` DEFAULT_FEATURES).

### Autorisations absentes de l’UI (bloquantes côté API)

| Flag | Effet si absent / false |
|------|-------------------------|
| `can_export_reports` | Blocage `/exports` (PDF/Excel) |
| `can_view_advanced_reports` | Rapports avancés / pilotage |
| `can_access_settings` | Paramètres station |
| `can_access_advanced_settings` | Règles paie, compta complète |
| `can_manage_hr` | Gestion RH (distinct de l’accès) |
| `can_customize_signature` | Signatures documents |
| `can_manage_services` | Services / packs station |
| `messaging_groups` | Conversations de groupe |
| `messaging_broadcast` | Diffusion messagerie |
| `can_use_auto_alerts` | Alertes auto + rapports programmés (top-level) |

Auparavant, `can_export_reports` était forcé égal à `can_view_reports`, et `can_manage_hr` forcé égal à `can_access_hr`, sans contrôle indépendant. `messaging_groups` / `messaging_broadcast` n’étaient jamais saisis.

## Correctif

Fichier : `public/ext-contracts.js`

- Helpers `featureFormFields()`, `featureDefaultsFromContract()`, `featuresPayloadFromForm()`
- Formulaires **Nouveau client** et **Gérer client** : liste complète des autorisations
- Payload enregistré aligné sur `DEFAULT_FEATURES` + modules backend
- `can_use_auto_alerts` synchronisé avec le module alertes

## Correctifs déjà inclus dans ce lot (étapes antérieures de la session)

- Couleurs rapports client + plateforme : PUT au lieu de POST (`ext-p9.js`, `ext-platform.js`, helper `Pu` dans `app.js`)
- Message d’activation messagerie clarifié (`src/messaging.js`)
- Toast octroi compte employé clarifié (`ext-roles.js`)
- Scroll horizontal tableaux mobile renforcé (`app.css`)

## Limites

- Vérification UI manuelle requise après déploiement (rechargement forcé cache navigateur)
- Les contrats déjà en base ne changent pas tant que le Super Admin ne les réenregistre pas
- Aucune migration SQL dans cette étape
