# Rapport d'utilisation mensuel (PDF)

- Tableau de bord Superadmin → Utilisation de la plateforme : bouton « Rapport PDF » (export manuel, période choisie) en plus du CSV.
- Bloc « Rapport mensuel automatique » : activer/désactiver, jour du mois (1–28), heure (UTC), e-mail du destinataire, « Envoyer maintenant ».
- Envoi : le serveur (vérification toutes les 5 min) génère le PDF le jour/heure choisis, une seule fois par mois (réservation atomique), l'archive (table usage_reports, migration 110, 12 derniers listés avec téléchargement) et l'envoie par e-mail en pièce jointe si SMTP est configuré.
- Les mêmes calculs servent désormais au tableau de bord et au PDF (src/usage_report.js).
- Limite : le rendu PDF réel (pdfkit) n'a pas pu être exécuté dans l'environnement de développement (modules non installés) ; seule la logique a été testée avec un faux pdfkit.
