# Station Manager Pro V1 — Étape 28 — A6/B1

## Résultat

Le contrôle PDF/logo/colonnes passe à 8/8. Le contrôle de sécurité des pièces jointes passe à 7/7. Un ancien contrôle statique de personnalisation des couleurs échouait car il recherchait un ancien libellé; son assertion a été alignée sur le champ `can_customize_report_exports` présent dans le formulaire de contrat.

Le contrôle de couleurs/PDF plateforme passe maintenant à 14/14. Cette modification ne change pas le code applicatif ni les permissions; elle corrige uniquement le test.

## À faire avant certification

- Générer et inspecter visuellement plusieurs PDF (logo station, logo de repli, colonnes nombreuses, tableaux multipages, totaux).
- Exécuter un upload multipart réel de pièce jointe, puis tenter un téléchargement depuis un autre client et un utilisateur non membre de la conversation.
- Valider ces parcours sur une base PostgreSQL de test.
