# Plan maître d’exécution — Étages 4 à 7

## 1. Objet

Ce document transforme les issues #172 à #175 en programme d’exécution complet. Il fixe les lots de PR, les dépendances, les preuves attendues et les portes de sortie. Il ne remplace pas les issues : il les rend exécutables.

## 2. Principes communs

1. Chaque PR porte une seule responsabilité vérifiable.
2. Toute PR part de `main`, sauf dépendance technique explicite.
3. Les PR empilées sont ramenées sur `main` dès que leur dépendance est fusionnée.
4. Les fermetures d’étage partent toujours du `main` assemblé.
5. Aucun contrat frontend ne contourne les autorisations serveur.
6. Aucun test de sécurité ne repose seulement sur une recherche de chaînes.
7. Toute migration est testée depuis une base vide et une base partiellement migrée.
8. Toute décision de mise en service repose sur des preuves conservées.

---

# Étage 4 — Contrats frontend stables

Issue maîtresse : #172

## Porte d’entrée

- Étages 2 et 3 fusionnés;
- routes institutionnelles disponibles;
- enveloppe API globale stable;
- aucune rupture connue des migrations.

## Lots de PR

### 4A — Contrats de réponse communs

Branche : `feat/stage4-response-contracts`

Portée :
- listes sous `{ items, meta }`;
- ressources sous `{ resource, meta }`;
- codes et versions de contrat;
- conservation de l’enveloppe globale API.

Preuves :
- tests unitaires du formateur;
- tests de contrat sur chaque famille de routes;
- vérification de compatibilité avec les réponses antérieures.

Dépendance : aucune.

### 4B — Pagination, filtres et tri

Branche : `feat/stage4-pagination-filters`

Portée :
- `limit`, `cursor` ou page déterministe;
- filtres par état, propriétaire, période et échéance;
- tri explicite avec valeur par défaut stable;
- limites maximales côté serveur.

Preuves :
- pagination sans doublon ni omission;
- filtres isolés par organisation;
- tests sur volumes élevés.

Dépendance : 4A pour la structure `meta`.

### 4C — Capacités et permissions calculées

Branche : `feat/stage4-server-capabilities`

Portée :
- lecture, création, modification, approbation, fermeture;
- calcul côté serveur;
- raison d’indisponibilité exploitable par l’interface;
- aucune décision d’autorisation laissée au frontend.

Preuves :
- matrice rôle × action × module;
- tests d’autorisation positifs et négatifs;
- tests d’absence de fuite interorganisation.

Dépendance : aucune; peut avancer en parallèle avec 4B.

### 4D — Vues de synthèse institutionnelles

Branche : `feat/stage4-institutional-summaries`

Portée :
- risques et alertes;
- continuité et événements actifs;
- audit et actions en retard;
- performance et objectifs à risque;
- finances, documents et gouvernance.

Preuves :
- requêtes bornées et indexées;
- résultats reproductibles;
- absence de données appartenant à une autre organisation.

Dépendances : 4A et 4B.

### 4E — Contrats de transition

Branche : `feat/stage4-transition-schemas`

Portée :
- schémas d’entrée explicites;
- justification, preuve et idempotence;
- erreurs métier structurées;
- capacité d’action retournée après transition.

Preuves :
- tests de schémas;
- tests de rejeu;
- tests d’erreurs métier stables.

Dépendances : 4A et 4C.

### 4F — OpenAPI et validation automatique

Branche : `docs/stage4-openapi-contracts`

Portée :
- routes, schémas, réponses et erreurs;
- exemples sans renseignements sensibles;
- validation automatique du fichier OpenAPI;
- comparaison routes réelles ↔ documentation.

Dépendances : 4A à 4E.

### 4G — Compatibilité et dépréciation

Branche : `feat/stage4-compatibility-policy`

Portée :
- inventaire des anciens champs;
- alias temporaires;
- avertissements contrôlés;
- calendrier de retrait;
- aucun retrait silencieux.

Dépendances : 4A et 4F.

### 4H — Fermeture de l’Étage 4

Branche : `test/stage4-contract-closure`

Livrables :
- tests de contrat complets;
- matrice des permissions;
- rapport OpenAPI;
- constat de stabilité;
- fermeture de #172.

## Ordre recommandé

`4A → 4B + 4C → 4D + 4E → 4F → 4G → 4H`

## Critère de sortie

Le frontend peut consommer chaque capacité critique avec un contrat stable, paginé, autorisé côté serveur, documenté et testé.

---

# Étage 5 — Exploitation fiable et récupérable

Issue maîtresse : #173

## Porte d’entrée

- Étage 4 fermé;
- contrats de diagnostic définis;
- migrations institutionnelles stabilisées.

## Lots de PR

### 5A — Validation et réparation du schéma

Branche : `fix/stage5-schema-validation`

Portée :
- ordre complet des migrations;
- tables, index, contraintes et politiques attendus;
- réparation contrôlée;
- validation finale obligatoire.

Preuves : base vide, base partielle, migration interrompue, réexécution idempotente.

### 5B — Registre des tâches planifiées

Branche : `feat/stage5-cron-registry`

Portée : propriétaire, cadence, verrou, délai maximal, dernière exécution, prochaine exécution, état.

Preuves : double exécution bloquée, tâche en retard détectée, durée excessive signalée.

### 5C — Tentatives, reprise et quarantaine

Branche : `feat/stage5-retry-quarantine`

Portée : délai progressif, nombre maximal, cause finale, quarantaine, reprise manuelle traçable.

Preuves : erreur transitoire, erreur permanente, reprise autorisée, reprise refusée.

### 5D — Boîte de sortie et livraison différée

Branche : `feat/stage5-outbox-delivery`

Portée : émission après validation transactionnelle, déduplication, état de livraison, réconciliation.

Preuves : interruption après commit, livraison en double, reprise et ordre cohérent.

### 5E — Santé technique et fonctionnelle

Branche : `feat/stage5-health-readiness`

Portée : disponibilité, dépendances, files, tâches, schéma, état fonctionnel, diagnostic sans secret.

Preuves : panne PostgreSQL, file bloquée, migration manquante, tâche périmée.

### 5F — Journaux, mesures et corrélation

Branche : `feat/stage5-observability-correlation`

Portée : identifiant de corrélation, journaux structurés, mesures par module, masquage des secrets.

Preuves : corrélation requête → transaction → événement → tâche; test de non-divulgation.

### 5G — Sauvegarde et restauration

Branche : `ops/stage5-backup-restore`

Portée : sauvegarde PostgreSQL, chiffrement, conservation, exercice de restauration, objectifs de reprise.

Preuves : sauvegarde vérifiée, restauration isolée, contrôle d’intégrité, durée mesurée.

### 5H — Fermeture de l’Étage 5

Branche : `test/stage5-resilience-closure`

Livrables : exercices de panne, seuils d’alerte, guide d’exploitation, constat final, fermeture de #173.

## Ordre recommandé

`5A → 5B + 5F → 5C + 5D → 5E → 5G → 5H`

## Critère de sortie

Les pannes principales sont détectables, explicables, contenables et récupérables par des procédures testées.

---

# Étage 6 — Sécurité et preuve d’isolement

Issue maîtresse : #174

## Porte d’entrée

- Étage 5 fermé;
- observabilité disponible pour les essais d’abus;
- restauration testée avant les campagnes destructives.

## Lots de PR

### 6A — Matrice complète d’autorisation

Branche : `security/stage6-route-authorization-matrix`

Portée : inventaire automatique des routes, rôles, actions et gardes.

Preuves : aucune route sensible sans garde explicite; tests de refus par défaut.

### 6B — Isolation interorganisation exhaustive

Branche : `security/stage6-tenant-isolation`

Portée : lectures, écritures, transitions, tâches, événements, liens intermodules et exports.

Preuves : scénarios croisés entre au moins deux organisations; absence de fuite dans les erreurs.

### 6C — Abus des transitions sensibles

Branche : `security/stage6-sensitive-transition-abuse`

Portée : auto-approbation, élévation d’autorité, champs client falsifiés, rejeu, concurrence.

Preuves : tests positifs, négatifs et concurrents.

### 6D — Classification et protection des données

Branche : `security/stage6-sensitive-data-protection`

Portée : classification, minimisation, masquage, conservation, suppression et export.

Preuves : balayage des journaux et réponses; tests de conservation et gel juridique.

### 6E — Sessions et jetons

Branche : `security/stage6-session-hardening`

Portée : rotation, révocation, expiration, réutilisation d’un ancien jeton, concurrence de sessions.

Preuves : vol simulé, déconnexion globale, jeton révoqué, rotation simultanée.

### 6F — Dépendances et chaîne de construction

Branche : `security/stage6-supply-chain`

Portée : audit, verrou reproductible, licences, provenance des dépendances, politique de mise à jour.

Preuves : installation propre reproductible; vulnérabilités critiques bloquantes.

### 6G — Limitation et surcharge

Branche : `security/stage6-abuse-rate-limits`

Portée : limites par utilisateur et organisation, routes coûteuses, tailles maximales, files d’attente.

Preuves : tests de surcharge contrôlée et retour à la normale.

### 6H — Fermeture de l’Étage 6

Branche : `security/stage6-closure-report`

Livrables : rapport d’isolement, campagne de sécurité, risques résiduels, décisions d’acceptation, fermeture de #174.

## Ordre recommandé

`6A → 6B + 6E + 6F → 6C + 6D + 6G → 6H`

## Critère de sortie

Chaque route sensible possède une autorisation explicite, une isolation prouvée, une protection contre le rejeu et un test d’abus.

---

# Étage 7 — Validation complète et mise en service

Issue maîtresse : #175

## Porte d’entrée

- Étages 4, 5 et 6 fermés;
- environnement de préproduction séparé;
- sauvegarde et retour arrière disponibles.

## Lots de PR

### 7A — Données d’essai institutionnelles

Branche : `test/stage7-institutional-fixtures`

Portée : plusieurs organisations, rôles, délégations, preuves et états variés; aucune donnée réelle.

### 7B — Parcours prioritaires de bout en bout

Branche : `test/stage7-critical-e2e-flows`

Parcours :
- risque → traitement → revue;
- incident → continuité → décision → leçon;
- audit → action corrective → vérification;
- budget → approbation → suivi;
- document → version → publication → conservation.

### 7C — Scénarios interorganisation

Branche : `test/stage7-cross-tenant-e2e`

Preuves : accès et références croisés refusés, sessions isolées, tâches et événements isolés.

### 7D — Concurrence et idempotence

Branche : `test/stage7-concurrency-idempotency`

Preuves : double approbation, double paiement, transitions concurrentes, reprise réseau.

### 7E — Performance réaliste

Branche : `perf/stage7-production-load`

Portée : registres volumineux, pagination, synthèses, seuils p95/p99 documentés, consommation mémoire.

### 7F — Préproduction

Branche : `ops/stage7-staging-readiness`

Portée : variables, secrets, base séparée, migrations zéro, surveillance, sauvegarde, protections contre les tests destructifs en production.

### 7G — Déploiement progressif et retour arrière

Branche : `ops/stage7-rollout-rollback`

Portée : vérifications avant/après, stratégie compensatoire, retour arrière testé, décision de poursuite ou arrêt.

### 7H — Documentation d’exploitation et soutien

Branche : `docs/stage7-operations-support`

Portée : incidents fréquents, diagnostics, responsabilités, escalade, limites connues.

### 7I — Constat final de mise en service

Branche : `docs/stage7-go-live-decision`

Livrables : matrice finale, résultats des essais, risques résiduels, décision documentée, fermeture de #175 et #192.

## Ordre recommandé

`7A → 7B + 7C + 7D → 7E + 7F → 7G + 7H → 7I`

## Critère de sortie

Les parcours prioritaires réussissent en préproduction, l’isolation et la récupération sont prouvées, et la mise en service peut être décidée à partir de résultats vérifiables.

---

# 8. Vue globale des dépendances

```text
Étage 4 — Contrats et capacités frontend
        ↓
Étage 5 — Exploitation, reprise et observabilité
        ↓
Étage 6 — Sécurité exhaustive et preuve d’isolement
        ↓
Étage 7 — Parcours réels, préproduction et mise en service
```

Travaux parallèles permis :

- documentation et tests peuvent avancer pendant les implémentations correspondantes;
- les travaux de sauvegarde peuvent commencer tôt, mais leur fermeture dépend de 5A;
- les jeux de données de 7A peuvent être préparés pendant l’Étage 6;
- aucune campagne finale de 7B à 7G ne doit s’exécuter avant la fermeture de l’Étage 6.

# 9. Règle de fermeture

Un étage n’est fermé que si :

- toutes ses PR sont fusionnées dans `main`;
- les tests du `main` assemblé sont verts;
- les migrations sont validées depuis zéro;
- les preuves et risques résiduels sont documentés;
- l’issue maîtresse contient un constat de fermeture explicite.
