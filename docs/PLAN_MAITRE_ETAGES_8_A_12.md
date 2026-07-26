# Plan maître — Étages 8 à 12

## 1. Objet

Ce document organise l’après-mise-en-service de MADSuite. Il transforme les Étages 8 à 12 en programme d’exécution ordonné, mesurable et vérifiable.

Il complète le plan des Étages 4 à 7 et ne remplace aucune fondation antérieure.

## 2. Invariants transmis par les étages précédents

Chaque PR des Étages 8 à 12 doit préserver les garanties suivantes :

- isolation stricte par organisation;
- autorisations calculées côté serveur;
- transitions sensibles transactionnelles;
- idempotence des écritures critiques;
- preuves et justifications conservées;
- contrats versionnés;
- aucune duplication silencieuse de données métier;
- aucune action externe ou assistée ne contourne les politiques existantes.

## 3. Règles communes d’exécution

1. Chaque branche part de `main`, sauf dépendance explicitement documentée.
2. Les PR de fermeture partent toujours du `main` assemblé.
3. Aucun compteur de test ne doit être modifié sans expliquer la nouvelle capacité couverte.
4. Une nouvelle table doit déclarer propriétaire, source de vérité et stratégie de conservation.
5. Une nouvelle intégration doit être révocable et observable.
6. Une capacité assistée ne peut exécuter une transition sensible sans validation humaine adaptée au risque.
7. Une optimisation ne peut affaiblir cohérence, autorisation ou preuve.
8. Toute dépréciation doit fournir fenêtre de compatibilité et preuve d’absence de consommateur actif.

---

# Étage 8 — Gouverner l’exploitation continue

Issue de référence : #194

## Porte d’entrée

- Étages 4 à 7 fermés;
- environnement de préproduction stable;
- journaux, santé, sauvegarde et sécurité déjà vérifiés;
- responsabilité d’exploitation attribuée.

## PR 8A — Registre des services et propriétaires

Branche : `feat/stage8-service-registry`

### Portée

- registre des services;
- propriétaires métier, technique et opérationnel;
- criticité, dépendances, heures de soutien;
- statut opérationnel;
- vues internes de lecture.

### Preuves obligatoires

- migration depuis base vide;
- test d’isolation;
- test d’unicité des codes de service;
- contrat de lecture stable;
- aucune dépendance orpheline.

## PR 8B — Incidents opérationnels

Branche : `feat/stage8-operational-incidents`

Dépendance : 8A.

### Portée

- déclaration d’incident;
- gravité, impact, chronologie;
- transitions `declared`, `contained`, `restored`, `closed`;
- preuves de rétablissement;
- liens vers services, alertes et déploiements.

### Preuves obligatoires

- transition concurrente;
- impossibilité de fermer sans preuve;
- séparation incident et problème;
- idempotence des transitions;
- test interorganisation.

## PR 8C — Problèmes et causes profondes

Branche : `feat/stage8-problem-management`

Dépendance : 8B.

### Portée

- problèmes récurrents;
- causes profondes;
- erreurs connues;
- actions correctives;
- récidives et vérification.

### Preuves obligatoires

- lien incident → problème;
- action corrective non dupliquée;
- clôture interdite avant vérification;
- conservation de l’historique.

## PR 8D — Changements et fenêtres d’entretien

Branche : `feat/stage8-change-management`

Peut avancer après 8A en parallèle de 8C.

### Portée

- demande de changement;
- risque et impact;
- approbation;
- fenêtre d’entretien;
- plan de retour arrière;
- preuve d’exécution.

### Preuves obligatoires

- auto-approbation refusée;
- changement critique sans retour arrière refusé;
- calendrier sans chevauchement dangereux;
- lien vers déploiement et incident éventuel.

## PR 8E — Niveaux de service et budgets d’erreur

Branche : `feat/stage8-service-levels`

Dépendances : 8A, métriques de l’Étage 5.

### Portée

- objectifs de disponibilité;
- délais de réponse et de rétablissement;
- périodes de mesure;
- budgets d’erreur;
- alertes de dérive.

### Preuves obligatoires

- calcul reproductible;
- périodes incomplètes signalées;
- incidents exclus ou inclus selon règle documentée;
- aucune donnée inventée en absence de mesure.

## PR 8F — Coûts et capacité

Branche : `feat/stage8-cost-capacity`

Peut avancer après 8A en parallèle de 8E.

### Portée

- consommation par service;
- stockage, traitement et fournisseur;
- prévisions de capacité;
- seuils;
- liens financiers sans double comptabilisation.

### Preuves obligatoires

- agrégats réconciliables;
- coûts techniques séparés des écritures comptables;
- alertes tenant compte de la période;
- isolation complète.

## PR 8G — Revues d’exploitation

Branche : `feat/stage8-operations-reviews`

Dépendances : 8B à 8F.

### Portée

- synthèses hebdomadaires et mensuelles;
- décisions;
- responsables;
- risques et actions;
- preuves de suivi.

## PR 8H — Fermeture de l’Étage 8

Branche : `docs/stage8-closure`

Base obligatoire : `main` après fusion de 8A à 8G.

### Exercices

- incident majeur;
- changement avec retour arrière;
- calcul des niveaux de service;
- revue d’exploitation complète;
- constat des risques résiduels.

### Ordre recommandé

`8A → 8B → (8C + 8D) → (8E + 8F) → 8G → 8H`

---

# Étage 9 — Intelligence assistée vérifiable

Issue de référence : #195

## Porte d’entrée

- Étages 4 à 8 fermés;
- permissions, preuves et journaux stables;
- cas d’usage explicitement approuvés;
- aucune promesse d’autonomie non validée.

## PR 9A — Registre des cas d’usage assistés

Branche : `feat/stage9-ai-use-case-registry`

### Portée

- cas permis, interdits et expérimentaux;
- propriétaire;
- finalité;
- niveau de risque;
- données autorisées;
- niveau d’autonomie;
- version et statut.

### Preuves obligatoires

- activation impossible sans approbation;
- version explicite;
- retrait contrôlé;
- isolation par organisation.

## PR 9B — Contexte institutionnel contrôlé

Branche : `feat/stage9-authorized-context`

Dépendances : 9A et matrice d’autorisation de l’Étage 6.

### Portée

- assemblage de contexte autorisé;
- minimisation des champs;
- provenance;
- période de validité;
- filtrage par rôle et organisation.

### Preuves obligatoires

- tests de fuite interorganisation;
- champs sensibles masqués;
- contexte expiré signalé;
- provenance complète.

## PR 9C — Recommandations explicables

Branche : `feat/stage9-explainable-recommendations`

Dépendance : 9B.

### Contrat

- recommandation;
- faits;
- calculs;
- hypothèses;
- preuves;
- limites;
- confiance;
- date d’expiration.

### Preuves obligatoires

- aucune source inventée;
- distinction fait/hypothèse;
- contrat versionné;
- résultat périmé identifiable.

## PR 9D — Confirmation humaine et exécution

Branche : `feat/stage9-human-confirmed-execution`

Dépendances : 9C et moteur transactionnel.

### Portée

- séparation génération, validation et exécution;
- confirmation explicite;
- politiques métier existantes;
- auteur humain final;
- idempotence.

### Preuves obligatoires

- aucune exécution implicite;
- refus si autorité insuffisante;
- rejeu contrôlé;
- journal complet.

## PR 9E — Journal d’audit de l’intelligence

Branche : `feat/stage9-ai-audit-ledger`

Peut avancer après 9A en parallèle de 9B.

### Portée

- demande;
- contexte autorisé;
- version du moteur;
- résultat;
- décision humaine;
- corrélation;
- conservation.

## PR 9F — Évaluation et jeux de référence

Branche : `test/stage9-ai-evaluation-harness`

Dépendances : 9C à 9E.

### Portée

- scénarios reproductibles;
- exactitude;
- pertinence;
- refus;
- absence de fuite;
- comparaison de versions.

## PR 9G — Dérive, coûts et arrêt contrôlé

Branche : `feat/stage9-ai-operations`

Dépendances : 9E et 9F.

### Portée

- taux d’acceptation et correction;
- dérive;
- latence;
- coût par cas d’usage;
- seuils;
- désactivation contrôlée.

## PR 9H — Fermeture de l’Étage 9

Branche : `docs/stage9-closure`

### Exercices

- injection de consignes;
- contexte interdit;
- recommandation périmée;
- refus d’exécution autonome;
- comparaison de versions;
- arrêt d’une capacité dégradée.

### Ordre recommandé

`9A → (9B + 9E) → 9C → 9D → 9F → 9G → 9H`

---

# Étage 10 — Écosystème d’intégrations externes

Issue de référence : #196

## Porte d’entrée

- contrats API et événements stables;
- sécurité et observabilité fermées;
- politique de secrets disponible;
- environnement d’essai séparé.

## PR 10A — Registre des intégrations

Branche : `feat/stage10-integration-registry`

### Portée

- fournisseur;
- finalité;
- propriétaire;
- portée;
- environnement;
- version;
- statut proposé, approuvé, actif, suspendu ou révoqué.

## PR 10B — Secrets et identifiants

Branche : `feat/stage10-integration-secrets`

Dépendance : 10A.

### Portée

- référence à un coffre ou stockage protégé;
- rotation;
- expiration;
- révocation;
- séparation environnement/organisation.

### Preuves obligatoires

- aucun secret dans les journaux;
- rotation sans interruption non maîtrisée;
- révocation immédiate;
- test d’accès croisé refusé.

## PR 10C — Webhooks sortants

Branche : `feat/stage10-outbound-webhooks`

Dépendances : 10A, 10B et boîte de sortie de l’Étage 5.

### Portée

- abonnements;
- signature;
- horodatage;
- déduplication;
- tentatives;
- quarantaine;
- reprise.

## PR 10D — Entrées externes contrôlées

Branche : `feat/stage10-controlled-ingress`

Dépendance : 10B.

### Portée

- authentification;
- validation de schéma;
- provenance;
- idempotence;
- règles métier internes;
- protection contre rejeu.

## PR 10E — Connecteurs de référence

Branche : `feat/stage10-reference-connectors`

Dépendances : 10C et 10D.

### Connecteurs initiaux

- paiements et comptabilité;
- calendrier et messagerie;
- stockage documentaire;
- import/export structuré.

### Règle

Aucun connecteur externe ne devient source de vérité sans décision d’architecture explicite.

## PR 10F — Quotas et usage

Branche : `feat/stage10-integration-quotas`

Peut avancer après 10A en parallèle de 10C.

### Portée

- quotas par organisation;
- fréquence;
- volume;
- mesures;
- coût d’usage;
- alertes.

## PR 10G — Portail développeur et compatibilité

Branche : `docs/stage10-developer-contracts`

Dépendances : 10C à 10F.

### Portée

- événements;
- schémas;
- erreurs;
- environnement d’essai;
- permissions;
- politique de dépréciation.

## PR 10H — Fermeture de l’Étage 10

Branche : `docs/stage10-closure`

### Exercices

- panne fournisseur;
- webhook dupliqué;
- signature invalide;
- secret révoqué;
- entrée externe malformée;
- isolation entre organisations.

### Ordre recommandé

`10A → 10B → (10C + 10D + 10F) → 10E → 10G → 10H`

---

# Étage 11 — Évolution durable et passage à l’échelle

Issue de référence : #197

## Porte d’entrée

- charge réelle ou cible mesurable;
- contrats et observabilité stables;
- aucun découpage distribué entrepris sans problème démontré.

## PR 11A — Cartographie de capacité

Branche : `perf/stage11-capacity-baseline`

### Portée

- volumes;
- débits;
- tailles;
- latences;
- files;
- points de contention;
- seuils de saturation.

## PR 11B — Frontières et découplage

Branche : `refactor/stage11-domain-boundaries`

Dépendance : 11A.

### Portée

- dépendances circulaires;
- contrats internes;
- événements;
- responsabilités;
- candidats au découplage.

### Règle

Un module n’est séparé physiquement que si le gain est démontré et que la complexité supplémentaire est acceptée.

## PR 11C — Données à grande échelle

Branche : `perf/stage11-data-scaling`

Dépendance : 11A.

### Portée

- indexation;
- archivage;
- partitionnement;
- historique;
- migrations progressives.

## PR 11D — Cache et projections

Branche : `perf/stage11-cache-projections`

Dépendances : 11A et 11B.

### Portée

- lectures admissibles au cache;
- invalidation;
- projections reconstruisibles;
- âge des données;
- refus des décisions sensibles sur état périmé non signalé.

## PR 11E — Compatibilité des versions

Branche : `feat/stage11-version-compatibility`

Peut avancer après 11A en parallèle de 11C.

### Portée

- versions API;
- événements;
- schémas;
- migrations;
- fenêtres de compatibilité;
- tests entre versions.

## PR 11F — Résidence et souveraineté

Branche : `docs/stage11-data-residency`

Dépendances : inventaire des données et fournisseurs.

### Portée

- emplacement réel;
- dépendances;
- réplication;
- sauvegarde;
- restauration;
- préparation régionale.

## PR 11G — Dette et retrait contrôlé

Branche : `chore/stage11-controlled-retirement`

Dépendance : 11E.

### Portée

- registre de dette;
- priorité;
- retrait de routes, champs et composants;
- vérification des consommateurs actifs.

## PR 11H — Fermeture de l’Étage 11

Branche : `docs/stage11-closure`

### Exercices

- montée progressive de charge;
- reconstruction d’une projection;
- migration de version;
- restauration d’un ensemble partitionné;
- retrait simulé d’un contrat ancien.

### Ordre recommandé

`11A → (11B + 11C + 11E + 11F) → 11D → 11G → 11H`

---

# Étage 12 — Évolution continue et transmission

Issue de référence : #199

## Porte d’entrée

- système en exploitation durable;
- responsabilités et documents accessibles;
- décisions majeures déjà traçables;
- volonté explicite de réduire les dépendances humaines uniques.

## PR 12A — Décisions d’architecture

Branche : `feat/stage12-architecture-decisions`

### Portée

- contexte;
- options;
- décision;
- conséquences;
- date de révision;
- statut actif, remplacé ou expérimental;
- liens vers risques, modules et preuves.

## PR 12B — Mémoire institutionnelle technique

Branche : `docs/stage12-technical-memory`

Dépendance : 12A.

### Portée

- invariants;
- règles critiques;
- pièges connus;
- liens code/migration/test/incident;
- détection de documents périmés.

## PR 12C — Recherche et expérimentations

Branche : `feat/stage12-research-governance`

Peut avancer après 12A en parallèle de 12B.

### Portée

- hypothèses;
- protocoles;
- critères d’arrêt;
- résultats;
- limites;
- adoption ou rejet;
- résultats négatifs utiles.

## PR 12D — Relève et transfert

Branche : `docs/stage12-responsibility-transfer`

Dépendances : registre des services de l’Étage 8 et 12B.

### Portée

- responsables;
- remplaçants;
- procédures;
- exercices de transfert;
- preuves d’exécution par une autre personne autorisée.

## PR 12E — Compétences critiques

Branche : `feat/stage12-critical-skills`

Dépendance : 12D.

### Portée

- compétences nécessaires;
- dépendances à une personne;
- formation;
- validation pratique;
- couverture de relève.

## PR 12F — Cycle de révision institutionnelle

Branche : `feat/stage12-institutional-review-cycle`

Dépendances : 12A à 12E.

### Portée

- révision des politiques, contrats, risques et limites;
- maintien, adaptation ou retrait;
- calendrier;
- responsables;
- preuves et suivis.

## PR 12G — Continuité de MADSuite

Branche : `docs/stage12-system-continuity`

Dépendances : 12B, 12D et sauvegardes de l’Étage 5.

### Scénarios

- perte d’un fournisseur;
- perte d’un mainteneur;
- perte d’un dépôt;
- reconstruction d’environnement;
- reprise du développement et de l’exploitation.

## PR 12H — Fermeture de l’Étage 12

Branche : `docs/stage12-closure`

### Exercices

- transmission complète;
- reconstruction guidée;
- exécution d’une opération critique par relève;
- revue des décisions;
- programme d’évolution suivant.

### Ordre recommandé

`12A → (12B + 12C) → 12D → 12E → (12F + 12G) → 12H`

---

# Vue de dépendance globale

```text
Étages 4–7
   ↓
Étage 8 — exploitation continue
   ↓
Étage 9 — intelligence assistée vérifiable
   ↓
Étage 10 — intégrations externes maîtrisées
   ↓
Étage 11 — passage à l’échelle
   ↓
Étage 12 — transmission et évolution continue
```

Certaines préparations peuvent avancer en parallèle, mais aucune fermeture ne doit être déclarée avant la fermeture de l’étage précédent.

# Critère final de maturité

La chaîne des Étages 2 à 12 est considérée cohérente lorsque MADSuite peut :

- exécuter ses règles métier sans ambiguïté;
- intégrer ses modules sans déplacer leurs responsabilités;
- exposer des contrats stables;
- détecter et récupérer ses pannes;
- prouver son isolation et sa sécurité;
- être déployé et retourné en arrière;
- être exploité quotidiennement;
- assister sans usurper la décision humaine;
- échanger avec l’extérieur sans perdre le contrôle;
- grandir selon des limites mesurées;
- être transmis sans savoir caché ni personne irremplaçable.
