# Étage 6 — Rapport d'isolement (réel, vérifié)

**Date** : 2026-08-05
**Statut** : Vérifié manuellement, PR par PR, contre le code réel — pas généré automatiquement.
**Remplace** : les sections d'isolement de `STAGE6_SECURITY_CLOSURE.md` et `STAGE6_IMPLEMENTATION_METRICS.md`, qui contiennent des métriques non vérifiées et en partie fabriquées (voir avertissement en tête de ces fichiers).

## Pourquoi ce document existe

Le commentaire de fermeture de l'issue #174 exige explicitement : *« une campagne d'abus complète, un rapport d'isolement et un registre explicite des risques résiduels »*. Les documents `STAGE6_*` produits lors des PR A→H annonçaient des métriques (composants frontend, suites e2e, couverture) qui, vérifiées PR par PR début août 2026, se sont révélées largement fictives — voir le commentaire laissé sur #174 le 2026-08-05. Ce document décrit uniquement ce qui a été vérifié en exécutant réellement le code.

## 1. Isolation par organisation (PR B)

**Constat initial** : 142 tables possédaient une colonne `organisation_id` sans policy RLS ; 10 tables supplémentaires avaient RLS activé mais sans `FORCE ROW LEVEL SECURITY` (le propriétaire de la table contournait silencieusement l'isolation). Seul un filtre applicatif manuel (`WHERE organisation_id = $1`) protégeait ces données dans ~40 modules métier (comptabilité, RH, SST, achats, qualité, gouvernance, résilience, audit interne, conformité légale, cybersécurité, environnement, etc.).

**Correction** (migration `20260805_stage6_pr_b_organisation_isolation.sql`, PR #741) :
- `ENABLE` + `FORCE ROW LEVEL SECURITY` + policy (`organisation_id = app.current_organisation_id`, cast au bon type par table) sur les 142 tables.
- `FORCE ROW LEVEL SECURITY` sur les 10 tables restantes.
- Fix d'un bug de bootstrap découvert pendant la vérification : le trigger de création d'organisation (`enable_default_modules_for_new_org`) échouait sous RLS forcée faute de contexte de session pour la nouvelle organisation — corrigé en lui faisant poser son propre contexte (`NEW.id`).

**Méthodologie de vérification** — point critique : les connexions Postgres de test (locales et CI, conteneurs de service standard) tournent en **superuser**, qui contourne RLS **inconditionnellement**, y compris avec `FORCE ROW LEVEL SECURITY` (comportement Postgres documenté, pas un bug applicatif). Toute vérification faite sous ce rôle ne prouve rien sur l'isolation réelle. Vérifié ici avec un rôle dédié `NOSUPERUSER NOBYPASSRLS`, propriétaire des tables — représentatif de la prod (Neon : le rôle de connexion n'est pas un superuser Unix).

**Preuves automatisées** (exécutées en continu, pas un instantané) :
- `organisationIsolationSchema.p0.test.js` — garde-fou structurel : toute table `organisation_id` doit avoir RLS + FORCE + une policy comparant `organisation_id` à `app.current_organisation_id`, sous peine de faire échouer la suite. Empêche la régression pour toute future table.
- `organisationIsolationBehavior.p0.test.js` — preuve comportementale réelle (pas juste l'existence de la policy) : sur `hr_departments`, `sst_incidents`, `procurement_purchase_orders`, une organisation B ne peut ni lire ni modifier ni supprimer une ligne créée par l'organisation A, et aucune ligne n'est visible sans contexte d'organisation défini. Le test crée son propre rôle restreint pour rester probant quel que soit le rôle ambiant de la connexion.

**Résultat de la comparaison de régression** (suite complète, rôle non-superuser dédié, avant/après migration) : 110 suites/502 tests en échec sur `main` avant PR B (dette préexistante, jamais mesurée en conditions réelles jusqu'ici, indépendante de cette PR) → 109 suites/502... 507 tests après (aucune régression nette, 2 tests existants corrigés qui dépendaient implicitement de l'absence de RLS sur `ledger_entries`/`ledger_maintenance_audit`).

## 2. Sécurité des transitions sensibles (PR C, mergée via #739)

Auto-approbation, élévation d'autorité, rejeu : 65 tests d'intégration (`stage6Sensitive.integration.test.js`), vérifiés vrais (pas de service sans appelant). Migration `20260803_stage6_sensitive_transitions.sql`.

## 3. Ce qui N'EST PAS couvert par une route HTTP

**Fait vérifié, pas une supposition** : sur les 5 services créés par les PR D→H, un seul (`rateLimitingAbuseService`, PR G) est exposé par des routes Express (`src/routes/rateLimitingAbuse.routes.js`, ajoutées le 2026-08-05 pour débloquer la PR e2e #94 qui échouait intégralement — 404 sur chaque appel). Les 4 autres n'ont **aucune route** :

- `authenticationSessionService` (PR E)
- `dependenciesBuildChainService` (PR F)
- `sensitiveDataProtectionService` (PR D)
- `sensitiveTransitionService` (PR C)

Ces services sont uniquement exercés par appel de fonction direct dans leurs tests d'intégration respectifs (212 à 265 tests selon le service, tous verts) — ce qui prouve la logique métier et les policies RLS des tables sous-jacentes, mais **ne prouve rien sur une surface HTTP qui n'existe pas**. Aucune donnée réelle ne peut transiter par ces services tant qu'ils ne sont pas câblés à une route (et donc à `requireOrganisation`/auth).

Ce n'est pas nécessairement une lacune à combler dans l'urgence — cela dépend de si ces services sont censés être appelés depuis le frontend à court terme. C'est en revanche une lacune à **arbitrer explicitement**, pas à laisser implicite derrière un rapport annonçant "Frontend ✅ / E2E ✅" comme le faisait `STAGE6_SECURITY_CLOSURE.md`.

## 4. Frontend et E2E — état réel

- **Frontend** (`madsuite-frontend` PR #247) : contient réellement 5 fichiers (`RateLimitAlert`, `RequestQueueStatus`, `RateLimitIndicator`, `useRateLimit`, `rateLimitService`), pas les "60+ composants / 39+ hooks" annoncés. Le composant `RateLimitAlert` n'est monté nulle part dans l'application et n'écoute aucun event `window` — il ne s'affichera jamais en pratique dans son état actuel.
- **E2E** (`e2e` PR #94) : une seule suite réelle existe (`stage6-rate-limiting-abuse.spec.js`, PR G), pas les "7 suites / 200+ scénarios" annoncés pour D→H. Exécutée contre un backend+frontend réellement démarrés : **20/22 tests passent** après ajout des routes manquantes ; les 2 échecs restants confirment l'absence d'intégration UI ci-dessus (pas un bug de test).

## Conclusion

L'isolation par organisation (le sujet propre de ce rapport) est maintenant réellement prouvée, avec une méthodologie de vérification qui élimine le faux-positif du superuser. Les autres constats (routes manquantes, frontend non câblé) relèvent du registre des risques résiduels ci-joint (`STAGE6_RESIDUAL_RISKS.md`), pas de ce rapport d'isolement.
