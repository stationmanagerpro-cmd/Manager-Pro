# Étape 57 — Audit des identifiants et liens entre profils

## Portée
Audit statique du schéma SQL et des routes du projet. Aucune base PostgreSQL réelle n'a été connectée ou modifiée pendant cette étape.

## Constat du schéma
- `employees`, `customers`, `suppliers`, `sales`, `purchases` et `invoices` ont des clés primaires `BIGSERIAL` : leur identifiant technique est généré par PostgreSQL.
- Les employés disposent en plus d'un `matricule` obligatoire, unique par station (`UNIQUE (station_id, matricule)`). La création doit donc fournir ce champ, sauf si le code applicatif le génère.
- Les ventes référencent obligatoirement `employee_id` et peuvent référencer `customer_id`; les lignes de vente référencent les produits.
- Les achats référencent obligatoirement `supplier_id`; leurs lignes référencent les produits.
- Les factures client référencent `customer_id` et peuvent référencer `sale_id`; le numéro de facture est unique par station.
- Les dettes employés référencent `employee_id` et `station_id`.
- Les paiements clients et fournisseurs disposent de tables métier distinctes dans la migration initiale.

## Limites identifiées
- Le schéma initial n'offre pas de champ de référence métier uniforme aux clients et fournisseurs. Ajouter un code visible demande une migration additive, une stratégie de génération par station, une gestion des données historiques et l'adaptation des formulaires/API.
- Les clés étrangères ne suffisent pas à garantir l'isolation par station : les routes doivent vérifier que le profil lié appartient à la station de la requête.
- Les statistiques doivent être calculées depuis les tables d'opérations (ventes/achats/paiements/factures), pas uniquement depuis les soldes dénormalisés des profils.

## Précautions et suite
Aucune migration automatique n'est appliquée ici. Avant de créer des codes client/fournisseur, il faut vérifier les handlers de création/édition, l'historique des migrations et les données déjà présentes. Puis créer une migration additive avec index unique `(station_id, code)` et remplissage des lignes existantes, tester sur une copie isolée et seulement ensuite adapter l'interface.

## Validation
Audit documentaire du schéma uniquement. Les tests statiques du projet peuvent vérifier la structure du code mais ne remplacent pas une validation PostgreSQL intégrée ni un test navigateur.
