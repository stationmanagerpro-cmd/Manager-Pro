# Module Facturation clients (13 oct. 2026)

## Contenu
- Tables `invoices`, `invoice_lines`, `invoice_payments` (migration `042_customer_invoices.sql`)
- API : liste, création brouillon, modification, émission, paiement, annulation, depuis vente, PDF
- UI menu **Facturation** + bouton **Facturer** sur ventes validées
- Autorisation contrat `can_use_billing` (défaut **actif**)

## Cycle
1. Brouillon → Émettre → (Paiements partiels) → Payée
2. Ou : Vente validée → Facturer
3. PDF téléchargeable

## Prérequis
Appliquer la migration 042 sur la base.
