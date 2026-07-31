# Certification locale MADSuite — modules Comptabilité & Paie

Date : 2026-07-31
Dépôts : `madsuite-backend`, `madsuite-frontend`, `e2e` (branche `claude/comptabilite-paie-module-n0efh2`, à jour de `main`)

## Verdict

**Certification complète : ÉTABLIE.**

Contrairement à la tentative précédente (bloquée par l'absence de registre npm et de PostgreSQL fonctionnels), cette certification a été exécutée avec un accès npm et PostgreSQL 16 réels, un rôle applicatif non-superutilisateur (conforme au garde-fou de démarrage du serveur, qui refuse tout rôle `SUPERUSER`/`BYPASSRLS`), un backend et un frontend réellement démarrés, et un navigateur Chromium réel piloté par Playwright.

Le module compta/paie est fonctionnellement complet et validé de bout en bout, **après correction de 10 défauts réels** découverts pendant la certification (détaillés ci-dessous). Sans ces correctifs, le module était **inutilisable en pratique dès qu'une sécurité RLS correcte était appliquée** — un scénario que les tests automatisés existants ne couvraient pas, car ils s'exécutaient jusqu'ici avec un rôle PostgreSQL superutilisateur qui contourne silencieusement la RLS.

## Contrôles exécutés

| Contrôle | Résultat |
|---|---|
| `npm ci` backend (880 paquets) | PASS |
| `npm ci` frontend | PASS |
| Build frontend (`vite build`) | PASS |
| Suite Jest backend complète (298 suites) | 294 passées, 3 échecs pré-existants **hors périmètre** (voir note Stripe), 1 skip |
| Suite Jest frontend complète | **114/114 suites, 444/444 tests** |
| Migrations SQL (202 → 205 avec les 2 nouvelles) | PASS, appliquées sur base PostgreSQL réelle |
| E2E `accounting-closure.spec.js` (Playwright, Chromium réel) | **PASS** — cycle complet |
| E2E `payroll-closure.spec.js` (Playwright, requêtes API réelles) | **PASS** — endpoints + isolation multi-tenant |

**Note Stripe** : les 3 suites en échec (`stripe-webhook.*`) le sont uniquement faute de `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` de test dans cet environnement de certification (503 attendu) — sans rapport avec compta/paie, non modifié par ce travail.

### Ce que le test e2e comptabilité valide réellement

Inscription réelle via l'UI → onboarding → navigation `/accounting` → seed du plan comptable → création de deux périodes → écriture équilibrée (125,50 $) → publication → détail → grand livre → balance de vérification → états financiers (résultats/bilan/flux de trésorerie) → exports CSV (balance + journal) → **contrepassation gouvernée** (confirmation humaine obligatoire) → clôture de période → réouverture → **isolation stricte entre deux organisations** (écriture invisible et 404 pour le tenant B).

### Ce que le test e2e paie valide réellement

Employés, périodes, cycles de paie, remises, dépôts directs, vacances, remises de fin d'emploi, feuillets de fin d'année, réconciliation — tous accessibles avec un jeton réel — et **isolation stricte** des cycles de paie entre deux organisations.

## Défauts réels trouvés et corrigés

Tous corrigés dans les commits poussés sur `claude/comptabilite-paie-module-n0efh2` des trois dépôts.

1. **RLS incomplète (sécurité, ~25 tables)** — plusieurs policies (`utilisateurs`, `password_reset_tokens`, tables `cognitive_*`, `activity_logs`, `activity_project_cache`, `security_incidents_buffer`, et un motif générique `{table}_org_isolation` sur une douzaine de tables dont `invoices`, `clients`, `time_entries`, `user_sessions`) appelaient `current_setting('app.current_organisation_id')` **sans** `missing_ok=true`. Résultat : toute requête sur une connexion n'ayant jamais fixé ce paramètre de session échouait avec *"unrecognized configuration parameter"*. → migration `20260731_fix_utilisateurs_rls_missing_ok.sql`.

2. **Authentification cassée sous RLS réelle (critique)** — `signup`, `login`, `refresh` et `logout` n'ont jamais fixé `app.current_organisation_id` avant d'écrire dans des tables protégées par RLS. La recherche d'utilisateur par email/id (login, refresh) est intrinsèquement cross-tenant et ne peut pas connaître l'organisation à l'avance : elle passe désormais par deux fonctions PostgreSQL `SECURITY DEFINER` étroites (`auth_find_user_by_email`, `auth_find_user_by_id`) plutôt que d'accorder `BYPASSRLS` au rôle applicatif (ce que le démarrage du serveur refuse à raison). **Sans ce correctif, aucun compte ne peut se connecter dès que l'application tourne avec le rôle non-superutilisateur que son propre code exige.**

3. **Moteur transactionnel partagé (`transaction-engine.service.js`)** — utilisé par toutes les opérations "gouvernées" compta/paie (contrepassation, clôture, etc.) ; ne fixait pas non plus le GUC de session. Un seul correctif bénéficie à toutes les opérations qui en dépendent.

4. **`accounting-posting.service.js`** — même défaut, corrigé.

5. **Colonne manquante `accounting_entries.metadata`** — référencée par `getLedger` (filtres projet/client/fournisseur), absente du schéma : `/accounting/ledger` échouait systématiquement. → migration `20260731_accounting_entries_add_metadata.sql`.

6. **Contrepassation comptable — liaison** — la mise à jour liant l'écriture d'origine à son renversement ne passait pas `status='reversed'`, condition exigée par le trigger d'immutabilité (`prevent_posted_accounting_entry_mutation`), qui bloquait donc l'opération.

7. **Contrepassation comptable — lignes** — l'écriture de renversement était créée directement `'posted'`, puis ses lignes insérées ensuite : le trigger `accounting_lines_immutable_when_posted` interdit *tout* insert de ligne dès que l'écriture parente est `posted`, sans exception. Restructuré selon le flux standard (brouillon → lignes → publication).

8. **Sérialisation JSON (`trust-persistence.service.js`)** — les colonnes JSONB `evidence`/`provenance` recevaient des objets JS bruts sans `JSON.stringify`, provoquant *"invalid input syntax for type json"*. Module partagé par toutes les opérations gouvernées.

9. **Routes paie manquantes** — `payroll-termination.service.js`, `payroll-year-end.service.js`, `payroll-reconciliation.service.js` et leurs tables (`payroll_terminations`, `payroll_year_end_slips`, `payroll_reconciliation_runs`) existaient et étaient testés unitairement, mais **jamais exposés en HTTP**. Trois routes GET minimalistes ajoutées et montées.

10. **Routes frontend `/accounting` et `/payroll` jamais montées (critique, découverte la plus significative)** — `src/index.jsx` importe `./pages/App`, qui résout vers `pages/App/index.jsx`. Ce fichier ne définissait **aucune route** pour `/accounting` ni `/payroll` ; `pages/App/App.jsx`, qui les définissait, n'est importé nulle part et constitue du code mort. Le lien "Comptabilité" de la barre latérale retombait silencieusement sur la route catch-all vers `/dashboard`, et aucun lien "Paie" n'existait. **Le module compta/paie, bien que complet côté backend et UI, était inaccessible à tout utilisateur réel.** Corrigé : routes ajoutées (gardées par `ModuleGate`, cohérent avec le reste du routeur) + lien de navigation paie ajouté.

## Points notés mais non corrigés (hors périmètre de cette certification)

- **Accès au module** : `accounting` et `payroll` sont au plan `internal` (`matrix_status: foundation_alpha` / `ruleset_required`) — un signup public standard obtient le plan `free` et n'y a pas accès. Décision produit délibérée à confirmer avec l'équipe avant mise en avant publique du module.
- **Même défaut RLS (`db.pool.connect()` sans `set_config`)** repéré, non corrigé, dans des modules hors compta/paie : `asset-maintenance-closure.service.js`, `supplier-master.service.js`, `supplier-approval-payment.service.js`. À corriger séparément.
- **`db/archive/migrations`** contient des définitions dupliquées/obsolètes par rapport à `db/migrations` (avertissements de collision au démarrage) — nettoyage recommandé mais non bloquant.
- Suites e2e `accounting-closure`/`payroll-closure` nécessitent des identifiants générés dynamiquement (signup réel) ou des jetons pré-générés (`E2E_PAYROLL_TOKEN_A/B`) — non intégrées à une pipeline CI dans ce dépôt à ce jour.

## Conclusion

Le module de comptabilité et de paie est **fonctionnellement solide et prêt**, mais il souffrait de défauts d'intégration critiques et jusqu'ici invisibles (authentification cassée sous sécurité réelle, routes frontend jamais montées) qui le rendaient inutilisable en pratique malgré un code métier de qualité. Ces défauts sont corrigés, poussés sur la branche `claude/comptabilite-paie-module-n0efh2` des trois dépôts, et validés par une exécution e2e réelle et non plus seulement syntaxique.
