# Station Manager Pro — consignes permanentes pour l'agent

Lire dans cet ordre, et rien d'autre tant que la tâche ne l'exige pas :
1. `docs/ETAT_ACTUEL.md` : état de reprise et prochaine tâche.
2. `docs/REFERENCE.md` : règles permanentes, architecture, sources des règles métier, directive d'économie de tokens (section 0 ter), commandes courtes.

Règles essentielles (détail dans `docs/REFERENCE.md`) :
- Ne jamais modifier ni supprimer une règle métier validée, une route, une table ou une donnée sans accord explicite.
- Sécurité et intégrité financière avant l'apparence. Isolation stricte entre clients et entre stations.
- Un suivi n'est pas une preuve : vérifier le code. Signaler une contradiction entre documents, ne pas trancher seul.
- Ne jamais déclarer un test, une livraison ou une optimisation réussis sans l'avoir exécuté et vérifié.
- Travailler sur le périmètre demandé ; modifications ciblées ; pas d'audit refait si un audit récent existe (`docs/audit/`).
- Fin d'intervention significative : mettre à jour `docs/ETAT_ACTUEL.md`. Livraison : voir `docs/REFERENCE.md`, section 0 ter.
- Réponses en français, courtes, sans jargon. Décisions proposées en choix fermés, option recommandée en premier.
