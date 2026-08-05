# Étage 8 PR H — Fermeture de l'Étage 8 (issue #194)

**Date** : 2026-08-05
**Statut** : Vérifié par exécution réelle contre une vraie base — pas généré automatiquement.

## Pourquoi ce document existe

L'issue #194 exige, pour PR H : un exercice d'incident majeur, un exercice de changement avec retour arrière, une vérification des niveaux de service, un manuel d'exploitation continue et un constat final.

**Constat de départ** (voir commentaires automatisés sur l'issue #194, 2026-08-03 et 2026-08-05) : la chaîne de PR #201-#244 prétendait fermer les blocs 8A à 8H, mais était fusionnée sur des branches `feat/stage8-*` jamais intégrées à `main`. Seule la PR A (registre des services, `src/operations/serviceRegistry.js`) existait réellement — module pur en mémoire, sans table ni route. Ce constat a été vérifié en lisant `main` directement, pas en faisant confiance aux PR mergées sur les branches orphelines.

## 1. Ce qui a été construit et vérifié (PR B à G)

| PR | Objet | Table(s) | Route | Preuve |
|---|---|---|---|---|
| B | Incidents opérationnels | `operational_incidents` | `/api/operations/incidents` | `operational-incidents.e2e.test.js` (7 tests) |
| C | Problèmes et causes profondes | `operational_problems` | `/api/operations/problems` | `operational-problems.e2e.test.js` (8 tests) |
| D | Changements et fenêtres d'entretien | `operational_changes` | `/api/operations/changes` | `operational-changes.e2e.test.js` (8 tests) |
| E | Niveaux de service et objectifs | `operational_slo_objectives` | `/api/operations/service-levels` | `operational-service-levels.e2e.test.js` (7 tests) |
| F | Coûts et capacité | `operational_capacity_usage`, `operational_capacity_thresholds` | `/api/operations/capacity` | `operational-capacity.e2e.test.js` (8 tests) |
| G | Revues d'exploitation | `operational_reviews`, `operational_review_decisions` | `/api/operations/reviews` | `operational-reviews.e2e.test.js` (7 tests) |

Chaque table est protégée par RLS forcée par organisation (`FORCE ROW LEVEL SECURITY`, policy `organisation_id = current_setting('app.current_organisation_id')`), cohérente avec le reste du schéma depuis l'Étage 6. Chaque route est montée dans `src/app.js` derrière `requireModule(...)` et son module est déclaré dans `src/config/modules.js` — pas de route orpheline non câblée.

## 2. Exercices de fermeture (PR H) — `stage8ClosurePlaybook.e2e.test.js`

Contrairement aux suites B à G (qui testent chaque bloc isolément), cet exercice enchaîne les blocs **ensemble** dans un scénario unique, contre une vraie base, pour prouver que le tout fonctionne en pratique et pas seulement chaque brique séparément.

**Scénario** : panne du fournisseur de paiement principal au checkout.

1. **Exercice d'incident majeur** — incident critique déclaré → confiné → rétabli (bascule vers un fournisseur de secours) → fermé. Rétablissement forcé à 90 minutes (déterministe pour le test) contre un objectif de 60 minutes.
2. **Vérification des niveaux de service** — `GET /service-levels/results` détecte réellement la dérive de rétablissement (`restorationTimeBreached: true`) et `GET /service-levels/alerts` remonte le service, avec l'incident réel en preuve dans `incidentsConsidered` (jamais un agrégat sans les données qui le composent).
3. **Exercice de changement avec retour arrière** — migration à risque élevé demandée, approbation refusée si le demandeur tente d'approuver son propre changement (409), approuvée par un tiers admin, planifiée, exécutée, puis **retour arrière** suite à une régression détectée en production.
4. **Dérive de capacité** — un relevé de consommation compute au-delà du seuil d'alerte déclenche une entrée dans `GET /capacity/alerts` pour le même service.
5. **Revue d'exploitation** — une revue hebdomadaire couvrant la période capture, dans sa synthèse **figée**, l'incident majeur, le changement exécuté/retourné et la dérive de capacité. Une décision (« ajouter un fournisseur de paiement de secours permanent ») est enregistrée avec échéance ; la fermeture de la revue est **refusée** tant que la décision n'a pas de preuve de suivi (`pendingDecisionIds` explicite, jamais masqué) ; une fois la preuve fournie, la fermeture réussit.

5 tests, tous verts, exécutés contre une vraie base (migrations réelles, pas de mock).

## 3. Manuel d'exploitation continue (résumé opérationnel)

- **Incident** : `POST /api/operations/incidents` (admin/manager) → `contain` → `restore` (preuve de rétablissement + cause provisoire obligatoires) → `close` (résumé obligatoire). Un incident fermé est un état terminal (`checkBlockClosure`).
- **Problème récurrent** : si plusieurs incidents partagent une cause, ouvrir un `operational_problems` et y lier les incidents (`POST /problems/:id/link-incident`) — une récidive sur un problème déjà résolu le rouvre automatiquement. Fermeture soit `resolved` (vérifié), soit `known_error` (contournement documenté), consultable via `GET /problems/known-errors`.
- **Changement** : `POST /api/operations/changes` (demande, risque + plan de retour arrière obligatoires) → `approve` (jamais par le demandeur ; admin obligatoire si risque élevé/critique) → `schedule` (fenêtre, visible dans `GET /calendar`) → `execute` (preuve obligatoire) → `rollback` si nécessaire (motif obligatoire).
- **Niveaux de service** : définir les objectifs par service (`POST /api/operations/service-levels`), consulter les résultats sur une période (`GET /results`) et les dérives courantes (`GET /alerts`) — toujours calculés à la volée depuis les incidents réels, jamais un agrégat qui pourrait diverger.
- **Capacité** : enregistrer les relevés de consommation (`POST /api/operations/capacity/usage`, unités physiques uniquement — jamais de montant), définir des seuils (`POST /thresholds`), consulter la prévision (`GET /forecast`, régression linéaire réelle) et les alertes (`GET /alerts`).
- **Revue périodique** : générer une revue (`POST /api/operations/reviews`, synthèse figée), y ajouter des décisions avec responsable et échéance, exiger une preuve de suivi avant de fermer (`POST /:id/close` refuse tant qu'une décision reste `pending`).

## 4. Limites connues

- **PR A (registre des services) reste un module en mémoire, non persisté.** `service_key` est un champ texte libre dans toutes les tables B à G (incidents, changements, seuils de capacité, revues) — aucune contrainte référentielle ne garantit qu'un `service_key` correspond à un service réellement déclaré. Documenté à chaque migration concernée plutôt que masqué. Câbler un vrai registre persisté (table + validation FK) serait un chantier distinct, hors scope de cette fermeture.
- **Pas de détection de chevauchement de fenêtres de changement.** `GET /changes/calendar` liste les fenêtres planifiées mais ne bloque pas deux changements qui se chevauchent sur le même service — laissé à la vigilance humaine à la planification.
- **Les revues ne se régénèrent pas automatiquement.** Créer une revue est une action explicite (`POST /reviews`) ; il n'existe pas de tâche planifiée qui génère automatiquement les revues hebdomadaires/mensuelles. Cohérent avec le reste du chantier (aucun ordonnanceur n'a été ajouté hors scope), mais à prévoir si l'équipe veut une cadence garantie sans intervention manuelle.
- **Aucune notification sortante.** Une dérive de niveau de service ou de capacité n'envoie ni courriel ni webhook — elle n'est visible qu'en interrogeant activement `GET /alerts`. Documenté plutôt que fabriqué : ce chantier n'a pas construit de canal de notification.
- **Listes sans pagination.** Comme documenté pour l'Étage 7 (`docs/STAGE7_PR_H_OPERATIONS_SUPPORT.md`, §1 « Latence élevée »), les routes `GET /` de ce chantier (incidents, problèmes, changements, revues) sont un `SELECT * ... ORDER BY` sans `LIMIT` — limite structurelle connue, pas propre à l'Étage 8.

## 5. Constat final

Les PR B à G sont réellement câblées sur `main`, testées individuellement (45 tests unitaires/e2e au total) et testées **ensemble** dans un scénario de fermeture réaliste (5 tests supplémentaires, §2). La fermeture de l'issue #194 peut s'appuyer sur ces preuves d'exécution réelle, pas sur des affirmations.

Aucune décision de mise en service n'est requise pour ce chantier (contrairement à l'Étage 7) : Étage 8 ajoute des capacités d'exploitation interne, pas un changement de posture de mise en service pour les clients.
