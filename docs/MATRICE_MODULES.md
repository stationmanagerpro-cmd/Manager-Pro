# Matrice des modules — Station Manager Pro

| Flag / module | Routes / zones impactées | Menu UI | Activé par défaut |
|---------------|--------------------------|---------|-------------------|
| module:sales / ventes | /sales, /shifts, /customers | Ventes, Quarts | Oui |
| module:stock | /products, /purchases, /suppliers | Stocks, Fournisseurs | Oui |
| can_access_finance / module:finance | /finance, caisse | Finance, Caisse | Oui |
| can_view_reports / module:reports | /reports, /dashboard | Rapports, Dashboard | Oui |
| can_export_reports | /exports | Exports | Oui |
| can_access_hr / module:hr | /hr/* | RH | Oui |
| payroll_* | Paie ITS/INPS/AMO | RH paie | Oui |
| can_use_messaging / module:messaging | /messaging | Messagerie | Oui |
| messaging_support | Conversations SA ↔ client | Support | Oui |
| can_use_auto_alerts / module:auto_alerts | alert-config, scheduler | Alertes | Oui |
| can_use_billing / module:billing | /invoices | Facturation | Oui |
| can_access_fiscal / module:fiscal | /fiscal/* | La Fiscalité | **Non** |
| can_fiscal_* + fiscal_* | Sous-parcours fiscal | La Fiscalité | **Non** |
| can_access_settings | Paramètres station | Paramètres | Oui |
| can_access_advanced_settings | Règles avancées | Paramètres avancés | Oui |
| can_access_personalization | Thème, branding | Personnalisation | Oui |
| can_customize_signature | Signatures PDF | Documents | Oui |
| can_customize_report_exports / report_colors | Couleurs exports | Rapports | Oui |
| module:reconcile | Réconciliation pompes | Ops | selon pack |
| module:period_lock | Clôture période | Ops | selon pack |
| module:receipts | Tickets | POS | Oui |
| module:price_history | Historique prix | Carburant | selon pack |
| can_view_coming_soon | Onglet À venir | À venir | Oui |
| can_manage_services | Packs station | Services | Oui |
| employee_portal_payslips | Bulletins employés | Portail | Oui |
| demo_mode | Mode sandbox | — | **Non** |
| can_manage_users / max_users | Création utilisateurs | Utilisateurs | quota |
| can_create_station / max_stations | Création stations | Stations | quota |

Superadmin (`is_global`) : configure uniquement les contrats ; pas d’ops station ni parcours fiscal opérationnel.

| can_access_accounting / accounting_entries, _assets, _vat, _closing, _export | Comptabilité OHADA | Comptabilité (menu) | module + options (désactivé par défaut) |
