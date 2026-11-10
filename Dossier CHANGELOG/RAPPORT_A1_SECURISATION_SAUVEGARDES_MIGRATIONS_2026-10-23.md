# Manager Pro — Rapport A1 : sauvegardes et migrations

Date : 23 octobre 2026  
Périmètre : copie locale des fichiers du projet reçus dans `Station_Manager_Pro_MAJ_2026-10-23_identification_appareils.zip`. Aucune connexion à la base de production n'a été effectuée.

## Modifications apportées dans cette copie

1. **Sauvegarde vérifiée avant migration**
   - Le succès de `pg_dump` n'est plus déclaré uniquement sur la base d'une taille de fichier supérieure à 50 octets.
   - Le fichier gzip est réellement décompressé en flux, ce qui vérifie notamment l'intégrité du flux et son CRC.
   - Le contenu doit dépasser une taille minimale et contenir la signature attendue d'un dump SQL PostgreSQL.
   - La validation se fait en flux pour éviter de charger la sauvegarde complète en mémoire.

2. **Suppression du contournement `--no-backup` sur une base avec données**
   - Si des migrations sont en attente et qu'une table publique contient des données, `--no-backup` provoque un arrêt de sécurité.
   - Si la sauvegarde préalable échoue, le lanceur arrête la procédure avant la première migration.

3. **Détection des données dans toutes les tables publiques**
   - Le contrôle ne dépend plus uniquement de `stations`.
   - Le lanceur vérifie l'existence de lignes dans les tables publiques et échoue fermé si le contrôle ne peut pas être effectué.

4. **Test automatisé de restauration renforcé**
   - `scripts/ci-restore-test.js` crée une base temporaire distincte uniquement après les garde-fous exigeant une base source locale de test/CI et `ALLOW_DESTRUCTIVE_TESTS=1`.
   - Le script restaure le dump dans cette base temporaire, compare les colonnes/types/nullabilité et le nombre de lignes de chaque table publique, puis tente de supprimer uniquement la base temporaire.
   - Ce script a été vérifié syntaxiquement, mais **n'a pas été exécuté contre PostgreSQL dans cette session**.

5. **Configuration d'exemple manquante**
   - Ajout de `.env.pc.example` avec valeurs fictives, base locale nommée `station_manager_test` et opérations destructives désactivées. Le fichier ne contient pas de secret réel.

6. **Tests A1 ajoutés**
   - `test/backup-integrity-unit.js`
   - `test/migration-backup-gate-static.js`
   - Scripts npm : `test:backup-integrity`, `test:migration-backup-gate` et `test:a1`.

## Tests exécutés et résultats

### Tests ciblés A1

- Validation d'une sauvegarde gzip/SQL valide : réussite.
- Rejet d'un fichier gzip tronqué : réussite.
- Rejet d'un contenu compressé ne correspondant pas à un dump PostgreSQL : réussite.
- Garde-fous de migration : 7/7 contrôles réussis.
- Sécurité des migrations existantes : 7/7 contrôles réussis.
- Sécurité des paramètres de connexion `pg_dump` : 10 assertions réussies.
- Sécurité des paramètres de connexion `psql` : 12 assertions réussies.
- Contrôles statiques de restauration : 6/6 réussis.
- Identification des appareils : 13/13 contrôles statiques réussis.
- Hébergement PC et modèle de configuration : 10/10 puis 9/9 contrôles réussis.
- Garde-fous de restauration complète : 10/10 contrôles statiques réussis.
- `node --check` sur `src/backup.js`, `src/migrate.js` et `scripts/ci-restore-test.js` : réussite.

### Suite statique/unitaire plus large

103 scripts statiques/unitaires ont été lancés : **94 scripts réussis, 9 scripts en échec**. Les échecs restent ouverts et ne sont pas attribués automatiquement à ce lot A1 :

- `test/branding-logo-fallback-webp-static.js`
- `test/import-ui-security-static.js`
- `test/pdf-logo-columns-static.js`
- `test/performance-motion-static.js`
- `test/roles-messaging-static.js`
- `test/step10-ux-branding-static.js`
- `test/step12-alert-config-static.js`
- `test/step8-contract-unlock-static.js`
- `test/superadmin-sidebar-icons-static.js`

Ces scripts doivent être examinés séparément avant de considérer la suite complète comme verte.

## Ce qui n'a PAS été vérifié

- Aucun `pg_dump` réel n'a été exécuté contre la base de l'utilisateur.
- Aucun dump réel n'a été restauré dans PostgreSQL.
- Aucune comparaison de données réelles source/restauration n'a été faite.
- Aucune migration n'a été exécutée, ni sur Neon, ni sur la base de production.
- Aucune publication GitHub/Render n'a été faite.

## Conditions pour clôturer A1

1. Créer une copie isolée et jetable de la base PostgreSQL cible, avec des identifiants de test distincts.
2. Vérifier la version de `pg_dump` par rapport au serveur PostgreSQL et la disponibilité de `psql`.
3. Exécuter `npm run test:restore` uniquement depuis un environnement local dédié à la copie de test, après avoir vérifié la valeur de `DATABASE_URL` et activé explicitement `ALLOW_DESTRUCTIVE_TESTS=1`.
4. Confirmer la restauration, la comparaison du schéma et des nombres de lignes, ainsi que le nettoyage de la base temporaire.
5. Examiner les neuf échecs de tests restants.
6. Ne demander une validation de migration réelle qu'après réussite des contrôles précédents et sauvegarde indépendante vérifiée.
