# Étage 7 PR F — Préparation de l'environnement de préproduction

**Date** : 2026-08-05
**Statut** : Vérifié manuellement en exécutant le code réel — pas généré automatiquement.

## Pourquoi ce document existe

L'issue #175 exige, pour PR F, la preuve de cinq points : variables et secrets, base séparée, migrations depuis zéro, surveillance et sauvegarde, interdiction des essais destructifs en production.

La branche `ops/stage7-staging-readiness` déjà présente dans le repo partage la même lignée git divergente inexploitable que les autres branches `test/stage7-*` (voir PR #746-750). Son seul contenu réel, `src/ops/stagingReadiness.js`, évalue une fonction locale contre un objet `env` passé en paramètre — jamais appelée par une route, un script de démarrage ou un test d'intégration réel. Ce document remplace cette preuve fabriquée par une vérification réelle de ce qui existe déjà dans le repo, plus un correctif de documentation réel (`.env.test.example`).

## 1. Variables et secrets

- `.env.example` (racine, déjà existant) documente les variables applicatives (`JWT_SECRET`, `DATABASE_URL`, etc.).
- **Lacune trouvée et corrigée** : `.gitignore` référence `!.env.test.example` comme exception documentaire attendue, mais ce fichier n'existait pas. Résultat concret constaté en écrivant cette preuve : `POSTGRES_ADMIN_URL` — requis par `src/test/migrations.integration.test.js` pour créer/détruire une base de migration dédiée — n'est documenté nulle part en dehors des workflows CI (`.github/workflows/backend-main-ci.yml`, `ci.yml`, `backup-restore-proof.yml`). Son absence en local fait échouer silencieusement `migrations.integration.test.js` et `migrations.065.integration.test.js` (la base `madsuite_migrations_test` n'est jamais créée) — sans lien avec un vrai bug applicatif, un pur trou de documentation qui coûte du temps de diagnostic à chaque nouvel environnement.
- Corrigé : `.env.test.example` créé, avec `POSTGRES_ADMIN_URL` documenté et expliqué.

## 2. Base séparée

- `TEST_DATABASE_URL` / `TEST_DB_NAME` pointent sur une base dédiée (`madsuite_test`), jamais la base applicative.
- Garde-fou réel et déjà largement appliqué (pas ajouté ici) : `src/test/setupInvoicesTestDB.js:96` — `recreateTestDatabase()` lève une exception si `TEST_DB_NAME` ne se termine pas par `_test`, **avant** tout `DROP DATABASE`. Cette fonction tourne dans `jest.globalSetup.js`, donc à chaque exécution de la suite, pas seulement pour les migrations.
- `src/test/migrations.integration.test.js` a son propre garde-fou équivalent (`assertSafeTestDatabase()`) pour sa base de migration dédiée.

## 3. Migrations depuis zéro

- `src/test/migrations.integration.test.js` (6 tests) : crée une base entièrement neuve (`DROP DATABASE IF EXISTS` + `CREATE DATABASE`), exécute toutes les migrations depuis zéro, vérifie la persistance de session RLS et l'isolation via `req.db`.
- `src/test/migrations.065.integration.test.js` (5 tests) : vérifie une migration spécifique dans les mêmes conditions.
- **Constat de vérification** : ces deux suites apparaissaient comme échecs dans toutes les comparaisons de régression de cette session (`fail-list-main-fresh.txt` et les listes équivalentes pour les PR B à E) — mais uniquement à cause de l'absence locale de `POSTGRES_ADMIN_URL` (§1), pas d'un vrai échec sur `main`. Avec la variable ajoutée localement : **11/11 tests verts**, migrations depuis zéro prouvées réellement, pas supposées à partir du seul fait que CI est vert.

## 4. Surveillance

- `src/observability/healthRoutes.js`, monté à `/api/observability` dans `app.js` (ligne 292) — pas un import mort.
- `src/test/stage14-health-checks.contract.test.js` : 31 tests e2e réels (vraies routes Express, vraie base via `db`, dépendances externes type Redis/queue mockées) — **31/31 verts**.

## 5. Sauvegarde (et interdiction des essais destructifs en production)

- `src/services/backupService.js`, `restoreService.js`, `backupRetention.js` (Stage 5 PR G, issue #173) : sauvegarde complète/incrémentale/schéma, restauration complète/sélective/point-in-time, rollback de restauration, politique de rétention.
- `src/test/stage5Backup.integration.test.js` : 42 tests d'intégration réels contre une vraie base — **42/42 verts**.
- `.github/workflows/backup-restore-proof.yml` (CI dédiée) exécute un exercice de restauration réel en pipeline.
- Interdiction des essais destructifs en production : aucun de ces services ni la suite de test ne cible autre chose que `TEST_DATABASE_URL`/la base de migration dédiée, protégées par les garde-fous du §2. Aucun mécanisme applicatif séparé n'empêche explicitement un opérateur d'exécuter ces scripts avec des identifiants de production en dehors des tests automatisés — **résidu non couvert par le code, relève de la procédure opérationnelle (accès aux secrets de production), pas d'un gap testable**.

## Conclusion

Les cinq exigences de PR F sont réellement couvertes par du code existant et testé, à une exception près : la documentation des variables de test (corrigée dans cette PR par l'ajout de `.env.test.example`), qui masquait jusqu'ici deux suites de tests migrations pourtant fonctionnelles. Aucun nouveau service n'a été ajouté — la barrière `src/ops/stagingReadiness.js` de la branche orpheline aurait dupliqué, en moins bien (jamais appelée, jamais testée contre un vrai environnement), ce qui existe déjà.
