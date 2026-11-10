# Prompt consolidé — référence de livraison

Document source : Prompt consolidé de correction et d’évolution du 07/10/2026.

Principes repris pour cette archive :
1. Vérifier avant de créer.
2. Ne supprimer aucune fonctionnalité, donnée, permission, historique ou audit.
3. Toute restriction sensible est contrôlée côté serveur.
4. Aucun mock, faux bouton ou faux succès.
5. Les migrations sont additives et les migrations historiques appliquées ne sont pas modifiées.
6. Les valeurs métier restent paramétrables et historisées.
7. Les libellés techniques inutiles ne sont pas exposés dans l’interface.
8. Chaque correctif doit disposer d’une preuve de test exécutée.
9. Le mode local reste utilisable sans dépendance obligatoire à Internet.

Périmètre fonctionnel de référence :
- comptes administrateur principal / gérant / employés ;
- licences, contrats, packs et révocation ;
- plafond de permissions par station ;
- bugs B1 à B9 ;
- fonctionnalités N1 à N11 ;
- UX U1 à U7 ;
- tests T1 à T27 ;
- rapport d’audit, matrice fonction → écran → API → table → permission → règle → test.

Le document PDF original reste la source normative complète. Cette copie sert uniquement de repère de livraison dans le dépôt.
