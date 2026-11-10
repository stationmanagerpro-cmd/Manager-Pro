# Activation progressive des règles de paie (Mali)

## Checklist

- [ ] Sources officielles collectées (DGI / INPS / CANAM)
- [ ] Barèmes / taux saisis dans l’application
- [ ] Confirmation juridique (statut `confirmee`)
- [ ] Activation technique (statut `active`)
- [ ] Dry-run salarié pilote
- [ ] Rapport d’impact (POST `/hr/payroll/impact`)
- [ ] Feature flag ON (menu **Activation paie**)
- [ ] Bulletin brouillon → validation → paiement pilote
- [ ] Contrôle audit RH

## Exemple AMO

```http
POST /hr/amo-branches/{id}/confirm   { "reason": "Circulaire CANAM …" }
POST /hr/amo-branches/{id}/activate  { "reason": "Mise en production …" }
POST /hr/payroll/impact              { "month": "2026-10", "flag": "payroll_amo_enabled" }
POST /hr/activation/enable-flag      { "flag": "payroll_amo_enabled", "reason": "…", "confirm": true }
```

## Désactivation

```http
POST /hr/activation/disable-flag { "flag": "payroll_amo_enabled", "reason": "…" }
```

Les bulletins déjà validés/payés **ne sont jamais recalculés**.
'''
