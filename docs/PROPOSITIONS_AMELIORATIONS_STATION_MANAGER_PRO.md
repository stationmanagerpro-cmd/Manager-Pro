# Station Manager Pro
## Propositions d’améliorations — Version finale (cadre d’activation progressive)

**Date :** 07 octobre 2026  
**Principe fondamental :**  
Toute fonctionnalité nouvelle ou à valeur ajoutée est **désactivée par défaut**.  
L’Administrateur Principal décide de l’activation.  
L’utilisateur voit toujours **pourquoi** c’est désactivé et **comment le rendre en service**.

---

### Règles générales appliquées partout

| Règle | Description |
|-------|-------------|
| Désactivé par défaut | Oui pour toute nouveauté à impact (fonctionnel, performance ou potentiellement financier) |
| Bloc « Infos » visible | Présent dans l’écran concerné |
| Procédure claire | Chemin exact Admin ou Gérant |
| Guide en pleine utilisation | Tooltips, empty states, bandeaux contextuels |
| Aucune activation silencieuse | Jamais |

---

## 1. Améliorations UX / Visuelles

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Micro-animations & transitions fluides | **Activé** | — | Déjà disponible |
| Empty states illustrés | **Activé** | — | Déjà disponible |
| Skeletons + effet shimmer | **Activé** | — | Déjà disponible |
| Mode sombre avancé + thèmes de couleur par station | **Désactivé** | « Les thèmes personnalisés sont désactivés par défaut pour garantir une identité visuelle homogène sur l’ensemble des stations. » | Admin → Identité de l’application → Thèmes personnalisés → Activer |
| Cartes KPI animées (chiffres qui montent, sparklines) | **Désactivé** | « Les animations avancées des indicateurs sont désactivées par défaut afin de limiter la charge sur les appareils modestes et les connexions limitées. » | Admin → Config. Dashboard → Animations KPI → Activer |
| Icônes SVG modernes (remplacement des emojis) | **Activé** | — | Déjà disponible |

---

## 2. Expérience mobile & PWA

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Installation PWA mise en avant | **Activé** | — | Déjà disponible |
| Mode Focus pompiste renforcé (gros boutons, contraste) | **Activé** | — | Déjà disponible |
| Gestes tactiles (swipe) | **Désactivé** | « Les gestes tactiles sont désactivés par défaut pour éviter les actions accidentelles sur écran tactile en conditions de station. » | Admin → Paramètres station → Ergonomie mobile → Activer les gestes |
| Notifications push (stock bas, écart caisse, licence…) | **Désactivé** | « Les notifications push sont désactivées par défaut car elles nécessitent une configuration serveur et peuvent entraîner des coûts selon l’hébergeur. » | Admin → Système → Notifications → Activer et configurer |
| Mode hors-ligne avancé (file d’attente visuelle) | **Désactivé** | « Le mode hors-ligne avancé est désactivé par défaut. Il consomme davantage de stockage local sur l’appareil. » | Admin → Paramètres station → Mode hors-ligne avancé → Activer |

---

## 3. Onboarding & adoption

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Parcours guidé interactif « Premiers pas » | **Activé** | — | Déjà disponible |
| Checklist de configuration du gérant | **Activé** | — | Déjà disponible |
| Tooltips contextuels (premiers jours) | **Activé** | — | Déjà disponible |
| Vidéos d’aide courtes intégrées | **Désactivé** | « Les vidéos d’aide sont désactivées par défaut pour réduire la consommation de bande passante. » | Admin → Aide & Formation → Vidéos intégrées → Activer |

---

## 4. Fonctionnalités à forte valeur (modules avancés)

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Tableau de bord « Direction » (vue multi-stations) | **Désactivé** | « Cette vue consolidée multi-stations est désactivée par défaut. Elle fait partie des fonctionnalités avancées. » | Admin Principal → Contrats / Packs du client → Activer « Vue Direction » |
| Comparaison de performance (stations / périodes) | **Désactivé** | « Les comparaisons avancées sont désactivées par défaut. Elles nécessitent le module Rapports avancés. » | Admin Principal → Contrats → Module « Rapports avancés » → Activer |
| Objectifs & barre de progression (gamification légère) | **Désactivé** | « Les objectifs d’équipe sont désactivés par défaut afin de laisser le gérant décider s’il souhaite motiver ses équipes de cette manière. » | Gérant (si autorisé) ou Admin → Paramètres station → Objectifs → Activer |
| Rapport automatique hebdomadaire / mensuel par email | **Désactivé** | « L’envoi automatique de rapports est désactivé par défaut car il nécessite une configuration SMTP valide et génère du trafic email. » | Admin → Système → Rapports automatiques → Activer + configurer les destinataires |
| Alertes intelligentes / prédictives | **Désactivé** | « Les alertes prédictives sont désactivées par défaut. Elles s’appuient sur l’historique de la station. » | Admin → Alertes → Alertes intelligentes → Activer |
| Espace Abonnement & Facturation (côté client) | **Activé** (consultation) | L’espace est visible. Les actions de renouvellement restent sous contrôle de l’Administrateur Principal. | — |

---

## 5. Modernité technique perçue

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Temps réel (ventes et caisse qui se mettent à jour) | **Désactivé** | « Le temps réel est désactivé par défaut pour préserver les performances sur les connexions limitées. » | Admin → Système → Temps réel → Activer |
| Recherche globale enrichie | **Activé** | — | Déjà disponible |
| Exports programmés | **Désactivé** | « Les exports automatiques sont désactivés par défaut (dépend de la configuration email). » | Admin → Exports → Exports programmés → Activer |
| Signature électronique simple | **Désactivé** | « La signature électronique est désactivée par défaut. Elle peut être activée une fois la politique interne validée. » | Admin → Documents → Signature électronique → Activer |
| QR Code sur bulletins et rapports de quart | **Désactivé** | « Les QR Codes sont désactivés par défaut. » | Admin → Documents → QR Code → Activer |

---

## 6. Spécificités Mali / Afrique

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Logos et flux guidés Mobile Money renforcés | **Activé** | — | Déjà disponible |
| Mode « faible connexion » explicite | **Désactivé** | « Le mode faible connexion est désactivé par défaut. Il réduit certaines fonctionnalités visuelles pour prioriser la stabilité. » | Admin → Paramètres station → Mode faible connexion → Activer |
| Mise en avant des mentions légales et déclarations sociales | **Activé** | — | Déjà disponible |

---

## 7. Côté Administrateur Principal

| Proposition | Statut par défaut | Message « Infos » affiché | Procédure pour rendre en service |
|-------------|-------------------|---------------------------|----------------------------------|
| Dashboard plateforme enrichi | **Activé** (Admin Principal uniquement) | — | Déjà disponible |
| Espace commercial (création rapide contrat / pack) | **Activé** | — | Déjà disponible |
| Statistiques d’usage détaillées par client | **Désactivé** | « Les statistiques d’usage détaillées sont désactivées par défaut pour respecter la discrétion des données d’utilisation des clients. » | Admin Principal → Plateforme → Statistiques d’usage → Activer |

---

## Mise en œuvre dans l’interface (guide en pleine utilisation)

Pour **chaque fonctionnalité désactivée**, l’écran concerné doit afficher systématiquement :

1. Un encadré ou bandeau **« Infos »** clairement identifiable  
2. La raison précise du désactivation par défaut  
3. Le chemin exact pour l’activer  
4. (Optionnel) Un bouton « Demander l’activation » qui notifie l’Administrateur Principal

### Exemple de texte type à afficher

> **Infos**  
> Cette fonctionnalité est désactivée par défaut.  
> **Pourquoi ?** [raison courte et claire]  
> **Pour la rendre en service :**  
> Administration → [chemin exact] → Activer  
> ou contactez l’Administrateur Principal.

---

## Roadmap recommandée

**Phase 1 – Attractivité rapide**  
Empty states, micro-animations, icônes SVG, Mode Focus renforcé, checklist onboarding, bandeaux Infos.

**Phase 2 – Valeur perçue**  
Rapports automatiques email, comparaisons de performance, alertes intelligentes, espace abonnement modernisé, notifications push.

**Phase 3 – Différenciation**  
Temps réel, objectifs/gamification, vue Direction multi-stations, exports programmés, signature électronique.

---

**Document de référence — Station Manager Pro**  
Toutes les activations restent sous le contrôle exclusif de l’Administrateur Principal.  
Aucune fonctionnalité à incidence n’est activée automatiquement.
