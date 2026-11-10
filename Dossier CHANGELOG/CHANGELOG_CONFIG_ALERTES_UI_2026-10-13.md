# Interface configuration alertes (13 oct. 2026)

## UI page « Config. alertes »
- Une carte par type d’alerte (stock bas, écart caisse, retard, etc.)
- Champs directs : seuil, unité, notifier employé, destinataires
- **Bouton interrupteur Actif / Inactif** sur chaque carte
- Enregistrer par alerte

## API
- `PATCH /messaging/alert-config/:id/active` — bascule rapide
- PUT : destinataires et seuil obligatoires **seulement si active = true**

## Accès
Menu **Config. alertes** (près d’Alertes) · permission `settings.edit` | `user.manage` · contrat `can_use_auto_alerts`
