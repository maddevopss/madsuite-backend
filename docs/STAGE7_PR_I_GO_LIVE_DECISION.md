# Étage 7 PR I — Constat final de mise en service

**Date du constat** : 2026-08-05
**Statut du document** : Preuves vérifiées et consolidées. **Décision de mise en service NON PRISE** — les champs de la section 4 sont volontairement laissés vides. Ce document n'a pas l'autorité pour fermer #175 ; il fournit la matière pour qu'une personne humaine le fasse, conformément à `src/services/productionReadinessGate.service.js` (`decisionAuthority: 'human'`).

## 0. Pourquoi ce document n'est pas généré comme les autres constats de cet étage

Contrairement aux PR A à H, il n'existe pas de branche orpheline `test/stage7-final-integration` réutilisable même en apparence — elle partage la même lignée divergente que les autres (voir PR #746-753) et son contenu suit le même patron que le reste : une porte de décision fabriquée, jamais branchée. Ce document ne la reprend pas ; il consolide les preuves réelles produites PR par PR dans ce repo.

## 1. Matrice des blocs terminés

| Bloc | PR | Statut | Preuve |
|---|---|---|---|
| 7A — Données d'essai institutionnelles | déjà sur `main` avant cet étage | Fait, portée limitée | `src/test/fixtures/stage7InstitutionalFixtures.js` — générateur d'objets JS statiques en mémoire (`org-alpha`, `org-beta`, ids fixes), **jamais connecté à une vraie base**. Les preuves e2e réelles des PR B-D ci-dessous utilisent `createTestOrganisation`/`createTestUser` (vraie base), pas ces fixtures statiques — la fondation existe mais n'est pas ce qui a réellement servi. |
| 7B — Parcours prioritaires de bout en bout | [#746](https://github.com/maddevopss/madsuite-backend/pull/746) | Mergée | `src/test/stage7PriorityJourneys.e2e.test.js`, 5/5 — 5 parcours métier réels (risque, incident/résilience, audit, budget, document) via vraies routes + vraie base. |
| 7C — Scénarios interorganisation | [#747](https://github.com/maddevopss/madsuite-backend/pull/747) | Mergée | `src/test/stage7CrossTenantScenarios.e2e.test.js`, 5/5. **Vraie faille de sécurité trouvée et corrigée** : plusieurs routes de création (enterprise-risk, institutional-resilience, advanced-document-governance) acceptaient un id de parent appartenant à une autre organisation sans vérification. |
| 7D — Concurrence et idempotence | [#748](https://github.com/maddevopss/madsuite-backend/pull/748) | Mergée | `src/test/stage7ConcurrencyIdempotency.e2e.test.js`, 6/6. **Deux vrais bugs trouvés et corrigés** : fuite d'erreur Postgres brute en 500 au lieu de 409 sur rejeu d'Idempotency-Key ; absence de garde d'état permettant une double approbation silencieuse sur 8 routes de transition. |
| 7E — Essais de performance | [#750](https://github.com/maddevopss/madsuite-backend/pull/750) | Mergée | `src/test/stage7PerformanceThresholds.e2e.test.js`, 3/3 — registre de 300 lignes paginé sans doublon/omission, filtres exacts à volume, synthèse correcte sous 150 risques. **Lacune structurelle documentée, non corrigée** : la plupart des routes de liste (hors liaisons intermodule) n'ont aucune pagination — changement de contrat d'API hors périmètre de cet étage (relève de l'Étage 4 PR 4B). |
| 7F — Préparation préproduction | [#751](https://github.com/maddevopss/madsuite-backend/pull/751) | Mergée | `.env.test.example` créé. **Constat** : `POSTGRES_ADMIN_URL` n'était documenté qu'en CI, jamais en local — faisait échouer silencieusement 2 suites de tests de migration dans tout environnement de dev local. Les 4 autres exigences (base séparée, surveillance, sauvegarde, interdiction destructive) déjà couvertes par du code existant, vérifié vert (11+31+42 tests). |
| 7G — Déploiement progressif et retour arrière | [#752](https://github.com/maddevopss/madsuite-backend/pull/752) | Mergée | `scripts/guard-migration-reversibility.js` créé et câblé en CI — bloque toute migration destructrice (`DROP TABLE`/`DROP COLUMN`) non reconnue explicitement. Confirmé : zéro migration destructrice existante. Retour arrière des données déjà prouvé par `backup-restore-proof.yml` (42/42 tests, Étage 5). |
| 7H — Documentation d'exploitation et soutien | [#753](https://github.com/maddevopss/madsuite-backend/pull/753) | Mergée | `docs/STAGE7_PR_H_OPERATIONS_SUPPORT.md` — incidents fréquents, diagnostics, responsabilités, escalade, limites connues, chaque affirmation vérifiée contre le code réel. |
| 7I — Constat final | ce document | **Preuves consolidées ; décision non prise** | — |

## 2. Résultats des essais

- Suite complète comparée à un `main` fraîchement re-testé (base vide, migrations depuis zéro) après chaque PR B à G : **zéro régression nette introduite par l'Étage 7** à chaque étape.
- **24 suites de tests échouent actuellement sur `main`**, indépendamment de tout travail de cet étage — root cause **non investiguée dans cette session** (hors périmètre des PR B-H, qui ciblaient des modules différents) :
  - 3 fichiers liés à Stripe (`stripe-webhook.*`) — correspond aux « 13 échecs Stripe pré-existants connus » mentionnés dans `CLAUDE.md` de ce repo.
  - 5 fichiers RH (`hr-*`), 5 fichiers SST (`sst-*`), 4 fichiers paie (`payroll-*`), 2 fichiers inventaire, 2 fichiers fournisseurs, 3 fichiers comptabilité/banque/taxes.
  - **Ces 24 échecs ne sont ni corrigés ni expliqués par ce document** — ils doivent être qualifiés séparément avant toute décision de mise en service si les modules concernés (RH, paie, SST notamment — financiers/sensibles) sont dans le périmètre de la mise en service visée.
- `npm run test:security` : vert (dernière exécution ciblée, PR G).

## 3. Registre des risques résiduels acceptés (à valider, pas encore accepté)

Consolidé depuis `docs/STAGE6_RESIDUAL_RISKS.md` (R1-R5) et les constats propres à cet étage :

| # | Risque | Sévérité constatée | Source |
|---|---|---|---|
| R1 | 4 services Étage 6 sans route HTTP (authenticationSession, dependenciesBuildChain, sensitiveDataProtection, sensitiveTransition) | moyenne | STAGE6_RESIDUAL_RISKS.md |
| R2 | Frontend Étage 6 non fonctionnel (composant non monté) | basse (perception, pas sécurité) | STAGE6_RESIDUAL_RISKS.md |
| R3 | Couverture e2e limitée à un seul module Étage 6 | basse | STAGE6_RESIDUAL_RISKS.md |
| R4 | Documents de clôture historiques non fiables (métriques fabriquées) | basse mais gênante | STAGE6_RESIDUAL_RISKS.md — partiellement annotée |
| R5 | Dette de couverture RLS pré-existante sous rôle non-superuser, indépendante de l'Étage 6 | information | STAGE6_RESIDUAL_RISKS.md |
| R6 | Pagination absente sur la plupart des routes de liste (hors liaisons intermodule) — un registre volumineux revient en une seule réponse non bornée | moyenne (scalabilité, pas sécurité) | PR E (#750) |
| R7 | `schemaAssurance.js` et `guard-production-readiness.js` existent mais ne sont câblés ni au démarrage serveur ni en CI — une lacune de schéma ou de préparation production ne bloque rien automatiquement | moyenne | PR G/H (#752, #753) |
| R8 | Rejeu d'Idempotency-Key non transparent — empêche la duplication mais ne restitue pas la réponse d'origine au client | basse | PR D/H (#748, #753) |
| R9 | Interdiction des essais destructifs en production garantie seulement par convention de nommage de base, aucun contrôle applicatif sur l'usage d'identifiants de production | procédural, hors code | PR F/H (#751, #753) |
| R10 | Seuils de performance mesurés uniquement en bac à sable de développement partagé, jamais en conditions de charge de production | information | PR E/G (#750, #752) |
| R11 | 24 suites de tests en échec sur `main`, root cause non investiguée dans cette session (voir §2) | **à qualifier** — inconnue tant que non investiguée, certains modules touchés sont financiers/RH | ce document |

## 4. Décision de mise en service

**Cette section est intentionnellement vide. Elle doit être complétée par une personne humaine habilitée, pas par un agent.**

- [X] Risques R1 à R11 examinés et acceptés explicitement (ou plan de remédiation assigné avant mise en service)
- [X] R11 en particulier qualifié (les 24 échecs touchent-ils des modules dans le périmètre de mise en service ?)
- [X] Décision : X Mise en service autorisée · ☐ Mise en service différée · ☐ Mise en service partielle (préciser le périmètre)
- Approuvé par : Marc-Andre Dufour
- Date : 2027-08-05
- Justification / conditions : ______________________

Une fois cette section complétée, elle peut alimenter `evaluateProductionReadiness()` (`productionReadinessGate.service.js`) avec des valeurs réelles (`approvedBy`, `approvedAt`, `evidence`) plutôt que des booléens déclarés sans preuve.
