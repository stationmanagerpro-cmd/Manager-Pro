# PROMPT MAÎTRE — Spécification d’implémentation
## Personnalisation des comptes · Messagerie interne · Activation guidée

**Projet :** Station Manager Pro  
**Date :** 08 octobre 2026  
**Statut :** Spécification normative — à intégrer sans régression  

---

## 0. Principes non négociables (rappel)

1. **Ne rien supprimer** de l’existant (modules, permissions, données, interfaces, exports, rapports).
2. **Super Admin (`is_global`)** = autorité contractuelle maximale.
3. **Administrateur local / Gérant** = configuration dans les limites du contrat.
4. **Employé** = utilisation uniquement des droits effectifs.
5. Toute fonctionnalité à incidence (contractuelle / licence / abonnement) est **désactivée par défaut**.
6. Une restriction de niveau supérieur ne peut **jamais** être contournée par un niveau inférieur.
7. Isolation stricte par `client_id` (aucune fuite inter-comptes).
8. Chaque fonctionnalité désactivée affiche : statut + pourquoi + qui peut activer + procédure.

---

## 1. En-tête identitaire de chaque compte client

### 1.1 Objectif
Toute interface accessible à un utilisateur connecté (hors Super Admin plateforme) affiche en haut :
- Nom de l’entreprise / station
- Logo
- Slogan
- (optionnel) élément visuel complémentaire

### 1.2 Données

**Nouvelle table (migration additive) :**

```sql
CREATE TABLE IF NOT EXISTS client_branding (
  client_id     BIGINT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  display_name  TEXT,
  slogan        TEXT,
  logo_path     TEXT,
  accent_color  TEXT,          -- optionnel
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    BIGINT REFERENCES users(id)
);
```

- Fallback : si absent → nom de la station courante, puis nom du client, puis identité globale application.
- Le Super Admin conserve l’identité **globale** de l’application (`app_settings` existant).

### 1.3 Autorisations (double niveau)

| Niveau | Droit | Feature flag contrat |
|--------|-------|----------------------|
| Super Admin | Autorise ou non la personnalisation | `features.can_customize_identity` / `module:personalization` |
| Admin local | Modifie nom / logo / slogan **si** le flag est true | Permission `appearance.manage` locale |

### 1.4 UI
- En-tête sticky sur toutes les pages métier.
- Si non autorisé : champs verrouillés +  
  `🔒 Fonctionnalité non activée pour votre compte.`  
  Bouton **ⓘ Pourquoi ?** → explication + procédure.

---

## 2. Messagerie interne

### 2.1 Portée
Strictement limitée aux utilisateurs ayant le **même `client_id`**.  
Aucun accès inter-clients possible (même par URL directe).

### 2.2 Tables

```sql
CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES clients(id),
  conversation_id BIGINT NOT NULL,          -- regroupement
  sender_id     BIGINT NOT NULL REFERENCES users(id),
  subject       TEXT,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS message_recipients (
  message_id    BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  read_at       TIMESTAMPTZ,
  archived_at   TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id            BIGSERIAL PRIMARY KEY,
  message_id    BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INT,
  uploaded_by   BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id            BIGSERIAL PRIMARY KEY,
  client_id     BIGINT NOT NULL REFERENCES clients(id),
  title         TEXT,                       -- pour groupes
  is_group      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Index : `(client_id)`, `(conversation_id)`, `(user_id, read_at)`.

### 2.3 Fonctionnalités de base
- Envoyer / recevoir / répondre
- Transférer (si permission)
- Recherche message & employé (scope client uniquement)
- Conversations individuelles et de groupe (si autorisé)
- Non-lus, notifications, marquer lu/non-lu
- Archiver / supprimer selon permissions
- Date/heure + identification claire expéditeur/destinataire

### 2.4 Feature flags contrat

| Flag | Signification |
|------|---------------|
| `module:messaging` ou `can_use_messaging` | Messagerie texte |
| `messaging_attachments` | Pièces jointes |
| `messaging_groups` | Conversations de groupe |
| `messaging_broadcast` | « Message à tous » |

Tous **false par défaut**.

---

## 3. Envoi de fichiers (pièces jointes)

### 3.1 Double autorisation

| Autorisation | Contrôle |
|--------------|----------|
| 1. Service messagerie | Super Admin → `can_use_messaging` |
| 2. Pièces jointes | Super Admin → `messaging_attachments` |

Cas possibles :
- Messagerie ✅ + Fichiers ❌ → texte uniquement
- Les deux ✅ → texte + fichiers

### 3.2 Intégration modules
Depuis un bulletin de paie, un rapport, une clôture, etc. :

```
[Générer] → [Envoyer par messagerie interne]
```

Le système pré-remplit le destinataire et joint le fichier généré (si `messaging_attachments` actif).

### 3.3 Sécurité fichiers
- Stockage sous `UPLOAD_DIR/messaging/{client_id}/...`
- Téléchargement uniquement si le user est destinataire **et** appartient au même `client_id`
- Aucune URL publique non authentifiée

---

## 4. Alertes de manquement / écart / anomalie

### 4.1 Déclencheurs (exemples)
- Écart de caisse
- Différence de stock
- Anomalie de compteur
- Erreur de saisie
- Manquement administratif / retard / absence
- Anomalie de clôture

### 4.2 Flux
1. L’événement métier est enregistré (existant).
2. Si `module:auto_alerts` (ou `can_use_auto_alerts`) est actif :
   - Message interne automatique → employé concerné
   - Copies configurables (gérant, comptable, responsable…)

### 4.3 Configuration gérant (niveau 2)
Si le Super Admin a autorisé les alertes, le gérant configure :
- Types d’alertes activés
- Destinataire principal (employé concerné — toujours)
- Destinataires en copie (cases à cocher)
- Priorité éventuelle

Le système **ne transmet jamais** à un utilisateur non autorisé à voir l’information.

### 4.4 Feature flags
- `can_use_auto_alerts` / `module:auto_alerts` (Super Admin)
- Configuration locale (gérant) uniquement si le flag est true

---

## 5. Message à tous les employés (« Broadcast »)

### 5.1 Double autorisation

| Niveau | Contrôle |
|--------|----------|
| Super Admin | `messaging_broadcast` dans le contrat |
| Admin local | Liste des rôles autorisés à utiliser « Envoyer à tous » |

Exemple :
- Super Admin : Broadcast = ACTIVÉ
- Admin local : Pompistes ❌ · Comptables ❌ · Gérants ✅ · Responsables ✅

### 5.2 Comportement
- Destinataires = tous les utilisateurs actifs du même `client_id` (filtrés par droits de lecture)
- Journal d’audit de l’envoi

---

## 6. Système général d’activation des fonctionnalités

### 6.1 Trois niveaux

```
Super Admin (contrat / licence / pack)
        ↓
Administrateur local (configuration dans les limites)
        ↓
Employé (utilisation des droits effectifs)
```

### 6.2 États uniformes dans toute l’UI

| Badge | Signification |
|-------|---------------|
| 🟢 Activée | Utilisable |
| 🟡 Disponible mais non configurée | Autorisée au contrat, pas encore paramétrée localement |
| 🔒 Non autorisée par le Super Admin | Absente du contrat |
| ⚠️ Nécessite configuration admin local | Autorisée, en attente de paramétrage |
| ⏳ En attente d’activation | Demande en cours |
| ❌ Désactivée | Explicitement coupée |

### 6.3 Bloc « Infos » obligatoire (fonction désactivée)

```
🔒 Fonctionnalité désactivée

Pourquoi ?
Cette fonctionnalité n’est pas incluse dans les fonctionnalités
actuellement autorisées pour votre compte.

Qui peut l’activer ?
Seul le Super Admin (Administrateur Principal) peut autoriser
cette fonctionnalité.

Comment l’obtenir ?
Contactez l’administrateur principal ou le développeur afin de
vérifier les conditions d’activation.

Après autorisation
L’administrateur local pourra configurer cette fonctionnalité
depuis Paramètres → Fonctionnalités.
```

---

## 7. Centre de gestion des fonctionnalités (Super Admin)

### Interface « Gestion des fonctionnalités »

Pour chaque client :

| Colonne | Contenu |
|---------|---------|
| Fonctionnalité | Nom lisible |
| Contrat | ✅ / ❌ |
| Activée | ✅ / ❌ |
| Configuration | Disponible / À activer / 🔒 |
| Date activation | |
| Expiration éventuelle | |
| Restrictions | |
| Utilisateurs concernés | |

Exemple de lignes :
- Messagerie interne
- Pièces jointes
- Message à tous
- Alertes automatiques
- Personnalisation logo / identité
- (toutes les features existantes + nouvelles)

Routes suggérées :
- `GET  /admin/clients/:id/features`
- `PUT  /admin/clients/:id/features`
- Réutilise le JSONB `client_contracts.features` existant (extension, pas de rupture).

---

## 8. Matrice d’autorisation (existantes + nouvelles)

| Fonctionnalité | Super Admin (contrat) | Admin local | Employé |
|----------------|----------------------|-------------|---------|
| Identité (logo, slogan, nom) | `can_customize_identity` | Config si autorisé | Lecture seule |
| Messagerie texte | `can_use_messaging` | — | Utilisation si autorisé |
| Pièces jointes | `messaging_attachments` | — | Utilisation si autorisé |
| Groupes | `messaging_groups` | — | Utilisation si autorisé |
| Message à tous | `messaging_broadcast` | Qui a le droit | Selon config locale |
| Alertes auto | `can_use_auto_alerts` | Config destinataires | Réception |
| Vue Direction multi-stations | `module:direction_dashboard` | — | — |
| Rapports avancés / comparaisons | `can_view_advanced_reports` | — | Selon droit |
| Temps réel | `module:realtime` | — | — |
| Notifications push | `module:push` | — | — |
| Signature électronique | `module:esign` | — | — |
| QR Code documents | `module:qrcode` | — | — |
| Objectifs / gamification | `module:goals` | Config | — |
| Exports programmés | `module:scheduled_exports` | Config | — |
| Thèmes personnalisés | `can_customize_identity` | Config | — |
| Statistiques d’usage (plateforme) | Réservé Super Admin | — | — |

Toutes les clés absentes du JSONB = **false** (désactivé par défaut).

---

## 9. Intégration avec les modules existants

| Module | Action possible | Condition |
|--------|-----------------|-----------|
| RH / Paie | « Envoyer bulletin par messagerie » | messaging + attachments |
| Caisse | « Notifier écart à l’employé » | auto_alerts |
| Stock | « Notifier anomalie » | auto_alerts |
| Quarts / Clôture | « Demander explication » | messaging ou auto_alerts |
| Documents / Exports | « Joindre et envoyer » | messaging + attachments |
| Administration | Décisions / documents → messagerie | selon flags |

Toutes les intégrations respectent les flags Super Admin + config locale.

---

## 10. Guide intégré à l’application

Pour chaque fonctionnalité importante :
- Bouton **ⓘ Informations**
- Aide contextuelle courte
- Description détaillée
- Autorisations nécessaires
- Qui peut activer
- Procédure d’activation
- Avertissements
- Exemples d’utilisation

Rédaction accessible à un utilisateur non technique.

---

## 11. Sécurité & confidentialité (rappels techniques)

- Toute requête messagerie filtre **obligatoirement** `client_id = req.user.client_id` (ou via station → client).
- Super Admin plateforme n’accède **pas** au contenu des messages métier (cohérent avec la règle actuelle « pas de données métier »).
- Pièces jointes : contrôle d’appartenance + permission de lecture.
- Pas d’IDOR possible via ID de message ou d’attachment.
- Audit des envois (surtout broadcast et alertes).

---

## 12. Plan d’implémentation recommandé (sans régression)

### Phase A — Fondations (non visibles utilisateur)
1. Migration additive : `client_branding`, tables messagerie, indexes.
2. Extension du merge des `features` (nouvelles clés, défaut false).
3. Helpers serveur : `featureOn(contract, key)`, `assertSameClient(...)`.
4. Centre de gestion des fonctionnalités (Super Admin) — lecture + écriture flags.

### Phase B — Identité client
5. En-tête dynamique (fallback station → client → app).
6. Écran de personnalisation (verrouillé si flag off + bloc Infos).

### Phase C — Messagerie
7. API messages / conversations / recipients (scope client).
8. UI messagerie (liste, conversation, non-lus).
9. Pièces jointes (si flag).
10. Broadcast (si flag + config rôles locaux).

### Phase D — Alertes & intégrations
11. Hooks sur écarts caisse / stock / compteurs / clôtures.
12. Configuration destinataires (gérant).
13. Boutons « Envoyer par messagerie » depuis RH, documents, etc.

### Phase E — Uniformisation UI
14. Composant réutilisable `FeatureStatus` (badges + Infos).
15. Parcours d’aide contextuelle.
16. Tests d’isolation client + tests de non-contournement des flags.

---

## 13. Exemple de features JSONB étendu (contrat)

```json
{
  "can_customize_identity": false,
  "can_use_messaging": false,
  "messaging_attachments": false,
  "messaging_groups": false,
  "messaging_broadcast": false,
  "can_use_auto_alerts": false,
  "module:direction_dashboard": false,
  "module:realtime": false,
  "module:push": false,
  "module:esign": false,
  "module:qrcode": false,
  "module:goals": false,
  "module:scheduled_exports": false,
  "modules": {
    "sales": true,
    "stock": true,
    "hr": false,
    "finance": true,
    "reports": true
  }
}
```

Toute clé absente = désactivée.

---

## 14. Objectif final atteint

- Chaque entreprise/station possède son identité visuelle (si autorisée).
- Chaque utilisateur voit clairement le compte auquel il appartient.
- Les employés communiquent en interne de façon sécurisée.
- Les documents sont transmis uniquement si l’option est autorisée.
- Les anomalies sont signalées automatiquement aux bonnes personnes.
- Les copies sont configurables par le gérant (dans les limites).
- Les communications générales (« à tous ») sont sous double contrôle.
- Le Super Admin garde le contrôle contractuel total.
- L’administrateur local garde le contrôle opérationnel dans les limites.
- Chaque employé n’utilise que ce qui lui est attribué.
- Les fonctionnalités désactivées sont **expliquées**, jamais simplement cachées.
- L’application guide l’utilisateur à chaque étape importante.

---

**Document normatif — Station Manager Pro**  
À utiliser comme référence d’implémentation.  
Aucune fonctionnalité existante n’est retirée ou dégradée.
