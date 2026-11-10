# Ops+ — Dashboard, déclarations, notifications, audit, HS

## 1. Dashboard Jour J
- `GET /dashboard/jour?date=YYYY-MM-DD`
- KPIs du jour + alertes (stock, caisse, RH, paie, contrat)

## 2. Déclarations
- `GET /hr/declarations?month=YYYY-MM`
- `GET /hr/declarations?month=YYYY-MM&format=csv`
- Totaux ITS / INPS / AMO / charges sur bulletins validés/payés

## 3. Notifications
- `POST /notifications/scan` — crée des notifications locales
- `POST /notifications/email-digest` — envoi SMTP (nécessite SMTP_HOST)

## 4. Audit filtrable
- `GET /audit/search?from=&to=&module=&login=&q=`
- `GET /audit/modules`

## 5. Heures sup. → paie réelle
- Flag `payroll_rules.feature_flags.payroll_overtime_enabled` = **false** par défaut
- Si ON : HS `approuve_rh` du mois ajoutées au **brut**
- Si `amount_estimate` vide : estimation `(base/173.33)*h*1.5`
- Toujours testable en dry-run avec `flag_overrides`

### Activation manuelle
1. Simuler avec dry-run + `payroll_overtime_enabled: true`
2. Vérifier les montants
3. Activer le flag dans paramètres `payroll_rules`
4. Générer les bulletins
