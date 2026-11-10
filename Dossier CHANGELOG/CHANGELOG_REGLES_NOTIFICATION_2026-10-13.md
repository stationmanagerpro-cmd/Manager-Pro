# Règles de notification sur rapports (13 oct. 2026)

## Formulaire (inspiré captures + demandes)
- Nom de la règle
- Déclencheur : création / modification / approbation de rapport, ou planification
- Modèle de courriel : système par défaut ou personnalisé (sujet + corps)
- Inclure pièces jointes : Oui / Non
- **Rapports concernés** : liste déroulante/cases, **min 1 max 5**
- **Priorité** : Faible / Important / Urgent
- **Périodicité** : quotidien, hebdomadaire, trimestriel, semestriel, annuel, date précise + heure
- Destinataires utilisateurs + e-mails libres
- Activer / désactiver

## Technique
- Migration `043_notification_rules.sql`
- API `/notification-rules`
- UI menu **Règles notification**
- E-mail via mailer existant (SMTP_HOST)
