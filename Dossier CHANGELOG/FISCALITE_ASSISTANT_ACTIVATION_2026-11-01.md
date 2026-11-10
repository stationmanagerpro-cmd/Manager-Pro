# Fiscalité — assistant d'activation individuelle (exécution de l'audit du 31/10/2026)

## Ce qui est fait
**Assistant par impôt** (TVA, impôt synthétique, IBIC, IS, ITS, INPS, AMO, CFE, TFP, taxe de logement, taxe emploi-jeune, patente, retenues, autres) :
1. Présentation (rôle, personnes concernées, périodicité, base légale)
2. Paramètres préremplis avec le jeu de référence (`src/fiscal_reference.js`, version `2026-10-31.1`), tous modifiables, avec source, date de relevé et statut « à confirmer » ; « personnalisé » + « Revenir à la valeur officielle »
3. Test (simulation sur les données réelles, sans enregistrement)
4. Confirmation : case « valeurs vérifiées », motif, date d'effet — puis activation. Désactivation avec motif.

**Règles de sécurité**
- Aucun module ne calcule ni n'affiche de montant tant qu'il n'est pas activé par l'assistant (« Module non activé »). Les anciennes activations sans paramètres confirmés sont « À reconfirmer ».
- Taux nul ou vide : blocage sauf confirmation explicite. Valeurs contestées (barème ITS, INPS, seuil synthétique, CFE, AMO) : choix obligatoire entre les valeurs relevées.
- Paramètres versionnés avec date d'effet (migration 086, versions immuables), journalisés (qui, quand, ancienne/nouvelle valeur, motif). Chaque estimation indique la version de paramètres et les valeurs personnalisées.
- Une mise à jour du jeu de référence n'écrase jamais les valeurs confirmées d'un client.
- Les périodes clôturées restent figées.

**Paie = même source** : ITS, INPS, AMO, CFE, TFP confirmés dans l'assistant alimentent `its_brackets`, `inps_branches`, `amo_branches`, `employer_charges` de toutes les stations du client et activent les indicateurs de paie (droit `hr.manage` requis).

**Correctifs techniques** (`src/fiscal_calc.js`, testés : `npm run test:fiscal-wizard`)
- ITS annuel : annualisation, cotisations salariales déduites de l'assiette, réductions familiales en % de l'impôt brut (plafond d'enfants), tranches « de 175 001 » sans décalage d'un franc.
- IS/IBIC : impôt minimum forfaitaire (% du CA HT), report des déficits limité si une durée est paramétrée.
- Synthétique : seuil de régime et alerte de bascule vers le réel.
- TVA : écart de base carburant (compteurs de pompes) chiffré et inclus si paramétré ; alerte « TVA déductible non calculable » ; taux de repli ; prorata ; crédit antérieur.
- Calendrier des échéances généré depuis la périodicité, le jour limite et la pénalité paramétrés.

## À décider / valider (aucune valeur n'est validée juridiquement)
Version du barème ITS 2026 (A ou B), taux CFE (3 % ou 3,5 %) et TFP, seuil du synthétique (30 ou 50 M), taux INPS par branche et plafond, liste des taxes complémentaires de la première livraison, responsable de la mise à jour du jeu de référence. Les cas chiffrés des tests sont des contrôles arithmétiques : à faire valider par un expert-comptable.

## Mise en service
1. `npm run migrate` (migration 086), redémarrer le serveur, Ctrl+F5.
2. Fiscalité > Étape 2 : « Activer avec l'assistant » pour chaque module utilisé.
3. L'ancien écran Paie > Modules (`payroll_activation.js`) n'est plus la source des paramètres ITS/INPS/AMO : ses paramètres n'étaient pas lus par le calcul de paie.
