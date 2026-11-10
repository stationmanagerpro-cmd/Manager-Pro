# Audit de réconciliation — Cahier des charges Station Manager Pro V1
Date : 19 octobre 2026 — Étape 8

## Portée et méthode

Comparaison du cahier des charges du 18 octobre 2026 avec les fichiers, routes, écrans, changelogs et tests présents dans l'archive de travail. Cet audit est une revue de code, pas une recette fonctionnelle : aucune session réelle Superadmin/client ni base PostgreSQL de production n'a été utilisée. « Présent / partiel » ne signifie donc pas que le parcours est certifié de bout en bout.

## État des 18 fiches

| Fiche | État après revue du code | Constat et suite nécessaire |
|---|---|---|
| A1 — Logo client | Correctif présent, validation partielle | Le sélecteur PNG/JPEG/WebP et le repli sur les initiales sont documentés et couverts par un test statique. Vérifier encore l'affichage réel dans l'en-tête, la connexion client et les PDF. |
| A2 — Paie/cotisations/indemnités | Diagnostic amélioré, cause métier non certifiée | Le calcul dépend des feature flags et de règles « Confirmées » et « Actives ». Les taux ne doivent pas être inventés. Tester l'enregistrement et la lecture de chaque flag/règle dans le même compte client avec des règles maliennes validées. |
| A3 — Config Dashboard par client | Implémentation dédiée ajoutée, intégration non certifiée | Ajout d'un stockage `client_dashboard_configs` (migration 055), d'une interface « Config Dashboard » dans la fiche administrative du client et d'API réservées au Super Admin. Le dashboard opérationnel privilégie la configuration du client, partagée entre ses stations; les anciens comptes sans `client_id` direct utilisent le client de leur station courante. Tests statiques 7/7. Il faut encore appliquer la migration et vérifier en base que X et Y restent indépendants. |
| A4 — Sauvegarde/restauration/réinitialisation client | Restauration JSON/JSON.GZ améliorée, réinitialisation non certifiée | Détection du format par signature/contenu et vérification du client sont présentes. Le scénario de réinitialisation qui contourne proprement le verrou de quart clôturé, avec transaction, sauvegarde et audit, doit encore être validé en intégration. |
| A5 — Sauvegarde/restauration/réinitialisation globale | Non certifié | Des contrôles de sauvegarde existent, mais ce relevé ne prouve pas que la restauration et la réinitialisation globales terminent le parcours avec authentification, confirmation écrite, sauvegarde préalable et isolation des données clients. |
| A6 — Exports PDF/logo/colonnes | À vérifier | Les exports doivent être vérifiés avec logo réel et alignement des colonnes dans un PDF rendu. Aucun résultat de rendu PDF bout en bout n'est établi par cet audit. |
| B1 — Pièces jointes messagerie | Non certifié | Vérifier upload, types MIME, taille, droits d'accès, téléchargement et isolation entre clients. |
| B2 — Mode sombre messagerie | Non certifié | Vérifier le contraste des messages reçus en thème sombre, y compris les pièces jointes et états non lus. |
| B3 — Recherche destinataire/participants | Non certifié | Vérifier recherche partielle insensible aux accents/casse, employés actifs seulement et limitation au même client. |
| B4 — Notifications de messages non lus | Non certifié | Vérifier file chronologique, intervalle de 5 minutes, retrait à la lecture et ouverture de la conversation. |
| B5 — Limitation du contact Superadmin | Couverture statique présente, recette à faire | Les contrôles statiques des rôles/messagerie passent (10/10). Le refus réel côté serveur pour un utilisateur simple et l'exception de renouvellement C2 n'ont pas été testés avec une session authentifiée. |
| B6 — Nom de l'expéditeur/support | Non certifié | Vérifier listes, notifications et cloche côté Superadmin et client, avec le nom d'expéditeur et le nom de station. |
| C1 — Onglet Fiscalité et permissions | Couverture statique présente, parcours réel non certifié | Les tests statiques frontend/backend et C1 (11 assertions) passent. Reste à vérifier les droits du contrat et du rôle sur toutes les routes API et pages directes avec des comptes de recette. |
| C2 — Abonnement expiré | Non certifié | Vérifier l'écran plein écran, le formulaire de renouvellement réservé à l'administrateur local, le compteur côté Superadmin et le numéro de téléphone configurable. |
| D1 — Icônes des cartes | Non certifié | Vérifier la couverture de toutes les cartes Superadmin/client et la cohérence en clair/sombre. |
| D2 — Animations et réduction des animations | Couverture statique présente, vérification visuelle restante | Le test statique des préférences de mouvement passe (12/12), notamment `prefers-reduced-motion`. Le rendu réel et l’absence de gêne dans la caisse doivent encore être vérifiés au navigateur. |
| D3 — Page d'accueil publique | Non certifié | Vérifier centrage, suppression du texte dupliqué et rendu mobile/desktop. |
| D4 — Connexion/clé d'accès | Non certifié | Le sens de la clé doit être clarifié à partir du mécanisme existant avant modification ; vérifier les deux boutons et le message d'erreur d'une clé invalide. |

## Étape 8 — Avancement A3

L'implémentation de code est maintenant présente : table dédiée par `client_id`, endpoints de lecture/enregistrement/réinitialisation protégés Super Admin, onglet de configuration dans la fiche client et prise en compte de cette configuration lors du chargement du dashboard client. Le réglage historique par station est conservé comme repli pour la compatibilité; les utilisateurs non globaux ne peuvent plus modifier directement cette ancienne clé via l'API générique.

**Limites restantes :** la migration `055_client_dashboard_config.sql` doit être appliquée à une base de test; il faut ensuite créer deux clients, modifier leurs configurations séparément, ouvrir le dashboard de chaque client et confirmer le résultat. Ces essais d'intégration n'ont pas été exécutés dans cet environnement.

## Prochaine priorité recommandée

Après validation en base de A3, poursuivre A4 — scénario de réinitialisation isolée du client avec sauvegarde préalable, gestion des quarts ouverts, transaction et audit. Ne pas activer les options de restauration/réinitialisation en production avant recette.

## Tests connus des étapes précédentes

Les tests statiques dédiés aux restaurations JSON, permissions fiscales, sécurité CSV, sécurité des paramètres de sauvegarde et validation des dates ont été ajoutés aux étapes précédentes. Ils ne remplacent pas les tests d'intégration PostgreSQL ni les essais visuels demandés par le cahier des charges (Superadmin/client, clair/sombre, rôle autorisé/non autorisé).
