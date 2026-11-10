# Correctif paie — explication des montants à zéro (2026-10-19)

- L'aperçu de paie explique désormais lorsqu'aucune indemnité / aucun autre gain n'a été saisi pour le mois.
- Si AMO, INPS, ITS ou les autres charges patronales sont à zéro, l'aperçu affiche la cause fournie par le calcul, l'état du module et un rappel de ne pas activer de taux/barème avant validation.
- Aucun taux social ou fiscal n'est activé automatiquement ; les garde-fous serveur restent inchangés.
- Vérification statique ajoutée : `npm run test:payroll-zero-guidance`.

Limite : les tests statiques ne remplacent pas un essai d'intégration avec une base PostgreSQL et des règles de paie réelles validées.
