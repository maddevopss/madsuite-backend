# Étage 7 PR H — Documentation d'exploitation et soutien

**Date** : 2026-08-05
**Statut** : Vérifié manuellement contre le code réel — pas généré automatiquement.

## Pourquoi ce document existe

L'issue #175 exige, pour PR H, un guide couvrant : incidents fréquents, diagnostics, responsabilités, chemins d'escalade, limites connues.

La branche `docs/stage7-operations-support` déjà présente dans le repo partage la même lignée git divergente inexploitable que les autres branches `test/stage7-*` (voir PR #746-752). Son contenu (`docs/STAGE7_OPERATIONS_SUPPORT.md`, 21 lignes) n'est pas fabriqué comme les autres branches orphelines (pas de nombres inventés), mais il est générique et non vérifié contre le code réel — certaines affirmations n'y résistent pas (voir §4 « Limites connues » ci-dessous, notamment sur le blocage du démarrage). Ce document reprend la même structure mais avec un contenu vérifié, y compris les constats accumulés au fil des PR B à G de cet étage.

## 1. Incidents fréquents et diagnostics

### Tâche planifiée en retard ou en échec répété
- **Où regarder** : `src/services/retryEngine.js` (backoff, `quarantine_queue`), `src/services/cronMonitor.service.js`, `src/config/cron_registry.js`.
- **Diagnostic** : vérifier le verrou (une tâche planifiée en double indique un verrou non tenu), la dernière exécution enregistrée, et si l'item est passé en quarantaine (`quarantine_queue`) après épuisement des tentatives.

### Événements non livrés (webhooks, notifications intermodules)
- **Où regarder** : `src/services/outbox.service.js`, `src/services/outboxProcessor.js`, `src/jobs/outboxWorker.js`.
- **Diagnostic** : examiner la boîte de sortie pour un événement bloqué en statut non-livré, le compteur de tentatives, et la déduplication (les routes de liaison intermodule utilisent `ON CONFLICT (organisation_id, idempotency_key) DO NOTHING` — voir `institutional-risk-links.routes.js` et équivalents, fermeture #171).

### Rejeu de requête / double soumission (Idempotency-Key)
- **Où regarder** : `src/middleware/errorHandler.js` (mapping des violations de contrainte UNIQUE Postgres — depuis Étage 7 PR D, #748).
- **Diagnostic** : un rejeu avec la même `Idempotency-Key` renvoie **409** avec le code `IDEMPOTENCY_KEY_ALREADY_USED` (conflit sur la contrainte d'idempotence) ou `UNIQUE_CONSTRAINT_VIOLATION` (conflit sur un champ métier, ex. numéro de facture) — jamais un 500 opaque avec du texte Postgres brut. Aucune ligne dupliquée n'est créée dans les deux cas (contrainte `UNIQUE(organisation_id, idempotency_key)` par table).
- **Limite connue** : ceci empêche la duplication, mais ne renvoie **pas** la ressource d'origine au client qui rejoue — un vrai rejeu transparent (retourner la réponse originale) n'est pas implémenté.

### Double approbation / re-publication sur une ressource déjà finalisée
- **Où regarder** : `checkBlockClosure` (`src/utils/blockClosureValidation.js`), appliqué depuis Étage 7 PR D aux transitions budget/forecast/scenario/document/retention/résilience/risque.
- **Diagnostic** : une tentative de transition sur une ressource déjà en état terminal renvoie 409 `block_closure.resource_final` — pas une réapplication silencieuse.

### Suspicion de fuite interorganisation
- **Où regarder** : `docs/STAGE6_ISOLATION_REPORT.md`, `docs/STAGE6_RESIDUAL_RISKS.md`, `docs/STAGE7_PR_C_CROSS_TENANT` (voir PR #747 pour le détail de la vérification et du correctif d'origine).
- **Diagnostic critique** : les connexions Postgres de développement/CI standard tournent en **superuser**, qui contourne RLS **inconditionnellement**, y compris `FORCE ROW LEVEL SECURITY`. Toute vérification manuelle d'isolation faite sous ce rôle ne prouve rien. Utiliser un rôle dédié `NOSUPERUSER NOBYPASSRLS` (voir `organisationIsolationBehavior.p0.test.js` pour le patron de vérification).
- **Action** : suspendre l'action suspecte, conserver les preuves (logs, requêtes), escalader immédiatement (voir §3).

### Latence élevée sur une route de liste
- **Où regarder** : `docs/STAGE7_PR_E_PERFORMANCE...` (voir PR #750).
- **Diagnostic** : seules les routes de liaison intermodule (`institutional-risk-links`, `risk-continuity-links`, `audit-corrective-action-links`) ont une vraie pagination par curseur (`src/utils/integrationPagination.js`). Toutes les autres routes de liste (`enterprise-risk`, `institutional-resilience`, `internal-audit`, `advanced-financial-management`, `advanced-document-governance`) sont un `SELECT * ... ORDER BY` **sans LIMIT** — un registre volumineux sur ces routes revient intégralement en une seule réponse. Ce n'est pas un incident à corriger en urgence isolément ; c'est une limite structurelle connue (voir §4).

### Migration incomplète ou base partiellement à jour
- **Où regarder** : `src/migrate/runMigrationsFromFiles.js`, `src/operations/schemaAssurance.js`, `src/migrate/schemaInventory.js`.
- **Diagnostic** : `schemaAssurance.js` existe et a sa propre couverture de test (`schema-assurance.contract.test.js`), mais **n'est pas câblé au démarrage du serveur** (`server.js`/`app.js` ne l'appellent pas) — voir §4. En pratique, la validation de schéma avant mise en service repose sur l'exécution manuelle/CI de `npm run db:migrate` et des suites `migrations.integration.test.js`/`migrations.065.integration.test.js` (Étage 7 PR F, #751), pas sur un blocage automatique au boot.

## 2. Responsabilités

- **Exploitation** : constate l'incident, contient l'impact immédiat (ex. suspendre une action suspecte), déclenche l'escalade.
- **Responsable du module concerné** : qualifie l'impact métier réel (financier, RH, conformité) une fois l'incident contenu.
- **Sécurité** : prend en charge toute suspicion d'isolement interorganisation ou de compromission — voir le diagnostic dédié ci-dessus.
- **Décideur de mise en service** : seul rôle habilité à accepter un risque résiduel documenté. Formalisé dans le code, pas seulement en procédure : `src/services/productionReadinessGate.service.js` fixe `decisionAuthority: 'human'` et refuse `ready: true` sans `approvedBy`/`approvedAt` explicites, quelles que soient les preuves techniques.

## 3. Chemins d'escalade

Alignés sur l'échelle de sévérité déjà utilisée dans le schéma applicatif (`severity CHECK (... IN ('low','medium','high','critical'))`, voir par ex. `cybersecurity_incidents`, `privacy_incidents`) plutôt qu'une échelle procédurale distincte à retenir en plus :

- **critical** : indisponibilité, fuite de données possible, corruption de données financières — intervention immédiate, gel des changements en cours, escalade à la sécurité si isolement interorganisation suspecté.
- **high** : fonctionnalité essentielle dégradée sans indisponibilité totale — traitement prioritaire dans le cycle courant.
- **medium/low** : contournement sûr disponible — inscription au registre de suivi, planification normale.

## 4. Limites connues

Ce sont des constats vérifiés au fil de cet Étage 7, pas des suppositions :

- **Modules de gouvernance non câblés** : `src/operations/schemaAssurance.js` et `scripts/guard-production-readiness.js` existent, ont parfois leur propre test, mais ne sont appelés ni au démarrage du serveur ni dans aucun workflow CI (le second est en plus une simple recherche de mots-clés, pas une vérification réelle — voir `docs/STAGE7_PR_G_ROLLOUT_ROLLBACK.md`). Une lacune de schéma ou de préparation production ne bloque donc **rien automatiquement** aujourd'hui.
- **Pagination absente hors liaisons intermodule** : voir §1 « Latence élevée ». Changer cela modifie le contrat de réponse API (tableau brut → `{items, meta}`) — relève de l'Étage 4 PR 4B, pas de ce guide.
- **Dette de couverture RLS pré-existante** : sous un rôle Postgres non-superuser représentatif de la prod, la suite complète du repo affichait déjà des échecs indépendants de tout travail de cet étage au moment de la vérification (`docs/STAGE6_RESIDUAL_RISKS.md`, R5) — jamais mesuré dans ces conditions avant l'Étage 6.
- **Interdiction des essais destructifs en production** : garantie uniquement par convention de nommage de base (`_test`, voir `docs/STAGE7_PR_F_STAGING_READINESS.md`) — aucun contrôle applicatif n'empêche un opérateur d'exécuter ces scripts avec des identifiants de production en dehors des tests automatisés. Relève de la procédure d'accès aux secrets, pas d'un gap testable dans le code.
- **Seuils de performance** : mesurés uniquement en bac à sable de développement (voir `docs/STAGE7_PR_G_ROLLOUT_ROLLBACK.md` et PR #750) — jamais en conditions de charge de production. À recalibrer avec des mesures réelles avant de s'en servir comme SLA.
- **Rejeu d'Idempotency-Key non transparent** : voir §1 — empêche la duplication, ne restitue pas la réponse d'origine.

## Conclusion

Ce guide documente ce qui est réellement câblé et vérifié dans ce repo à l'issue des PR B à G de l'Étage 7, y compris les endroits où le filet de sécurité attendu (schéma, préparation production) existe en code mais n'est pas branché. Ces lacunes ne sont pas nouvelles ; les rendre visibles ici est le livrable de PR H — pas les corriger toutes, ce qui dépasserait son périmètre.
