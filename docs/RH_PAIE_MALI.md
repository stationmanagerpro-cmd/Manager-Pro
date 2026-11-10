# Station Manager Pro — RH / Paie / Fiscalité sociale (Mali)

## Principe de sécurité financière

**Aucune règle financière incertaine n’est activée automatiquement.**

Ordre obligatoire :

1. Renseigner taux / barèmes officiels (DGI, INPS, CANAM…)
2. Confirmer juridiquement (`POST …/confirm`)
3. Activer techniquement (`POST …/activate`)
4. Tester (dry-run / impact)
5. Activer le feature flag (`POST /hr/activation/enable-flag`)
6. Pilote réel

Flags par défaut : **OFF**.

## Moteur de calcul

```
DONNÉES EMPLOYÉ → CONTRAT → RÉMUNÉRATION → RUBRIQUES → ASSIETTES
→ ITS / INPS / AMO / AUTRES RETENUES → NET À PAYER
→ CHARGES PATRONALES → COÛT EMPLOYEUR
→ BULLETIN → VALIDATION → PAIEMENT → FINANCE → AUDIT
```

- Arrondis : 2 décimales (`fl`)
- Net négatif : bloqué (sauf override admin strict)
- Double bulletin / double paiement : refusés
- Bulletins validés/payés : figés (`is_locked`), non recalculés
- Simulation : `calculation_mode = simulation`, ROLLBACK forcé

## Migrations

| Fichier | Contenu |
|---------|---------|
| 003 | RH / paie / finances de base |
| 004 | Sécurité paie (verrouillage) |
| 005 | Rubriques + règles versionnées |
| 006 | ITS |
| 007 | INPS |
| 008 | AMO |
| 009 | Charges patronales |
| 010 | Bulletin (appréciations) |
| 011 | Index audit RH |

## Feature flags (`settings.payroll_rules.feature_flags`)

- `payroll_its_enabled`
- `payroll_inps_enabled`
- `payroll_amo_enabled`
- `payroll_employer_charges_enabled`

## Endpoints clés

### Calcul / paie
- `POST /hr/payroll/preview` — simulation + ROLLBACK
- `POST /hr/payroll/dry-run` — dry-run + overrides de flags
- `POST /hr/payroll/dry-run-batch`
- `POST /hr/payroll/impact` — avant/après un flag
- `POST /hr/payroll` — préparation réelle
- `POST /hr/payroll/:id/validate|pay`
- `GET  /hr/payroll/:id/pdf|detail|audit`

### Règles
- ITS / INPS / AMO / charges : CRUD + confirm / activate / deactivate

### Activation progressive
- `GET  /hr/activation-status`
- `POST /hr/activation/enable-flag`
- `POST /hr/activation/disable-flag`

### Rapports
- `/hr/reports/payroll|employer-cost|employees|social-fiscal|forecast|stats`

### Audit
- `/hr/audit` · `/hr/audit/integrity` · `/hr/audit/export`

### Portail salarié
- `GET /hr/me`
- `GET /hr/me/payslips`
- PDF bulletin si le compte est lié à la fiche employé

## Tests

```bash
npm test
npm run test:payroll
```

## UI

- Gestion RH
- Rapports RH (masse, coût, social/fiscal, prévision, stats)
- Activation paie
- Audit RH
- Ma fiche (self-service)

## Hors périmètre (facultatif futur)

Pointage, congés, heures sup auto, contrat digital, signature électronique avancée, organigramme graphique — **non activés** ; n’affectent pas les calculs financiers existants.
'''
