# MADSuite Backend

Backend officiel de MADSuite.

Source de vérité documentaire : `bleeband/SYSTEME_MAD`.

Avant toute décision structurante, consulter les documents officiels à la racine du dépôt `bleeband/SYSTEME_MAD` :

```text
MANIFEST.md
00-SYSTEME-MAD/ai-context.md
00-SYSTEME-MAD/ai-context-madsuite-madproof.md
00-SYSTEME-MAD/repos.md
04-ADR/
09-CHECKLISTS/
```

## Rôle

Ce dépôt contient l’API, la logique métier, les migrations, les jobs, la sécurité applicative, les intégrations et les services serveur de MADSuite.

## Stack

- Node.js
- Express
- PostgreSQL
- Prisma
- Stripe
- Socket.IO
- Sentry
- Winston
- Jest
- Supertest

## Commandes

```bash
npm install
npm run dev
npm start
npm test
npm run test:coverage
npm run lint
npm run db:migrate
npm run db:preflight:org
```

## MADPROOF checks

Avant de pousser une correction backend sensible, exécuter au minimum :

```bash
npm run guard:gitignore
npm run guard:hygiene
npm run guard:routes
npm run guard:organisation-routes
npm run guard:modules-contract
npm run test:modules
npm run test:security -- --runInBand
```

Validation complète locale :

```bash
npm run check:backend
```

Les guards bloquent notamment :

- règles `.gitignore` critiques manquantes;
- fichiers d’environnement réels, artefacts générés ou informations sensibles évidentes;
- routes platform montées sans garde super-admin;
- routes métier organisationnelles sans contexte `requireOrganisation` / RLS;
- reconstruction inline du contrat API modules dans `src/routes/modules.routes.js`.

Si un guard tombe rouge, corriger le code ou la politique plutôt que de contourner le guard. Une exception doit être documentée dans `bleeband/SYSTEME_MAD` avant fusion.

## Contrat modules

Le contrat API modules doit rester centralisé dans :

```text
src/services/modules.service.js
```

La route :

```text
src/routes/modules.routes.js
```

doit rester une couche d’orchestration : authentification, contexte organisation, lectures DB et retour `ApiResponse`.

Ne pas reconstruire manuellement les champs suivants dans la route :

```text
plan_type
modules
diagnostics
matrix_status
is_active
active
included_in_plan
included
is_addon_active
```

Commandes dédiées :

```bash
npm run guard:modules-contract
npm run test:modules
```

Références SYSTEME_MAD :

```text
02-PRODUIT/madsuite-matrice-plans-modules.md
09-CHECKLISTS/chk-052-p3-plans-modules-subscriptions.md
```

## Environnement

Ne jamais commiter de fichier d’environnement réel. Utiliser l’exemple fourni comme référence sans valeur sensible.

## Sécurité

Toute route métier doit respecter l’isolation par organisation. Ne jamais exposer les données d’une autre organisation, ne jamais envoyer de notification cross-org, protéger les webhooks, éviter les logs sensibles et garder les endpoints IA limités et audités.

## MADSuite / MADPROOF

MADSuite est un SaaS de gestion et d’assistance cognitive non médicale.

Les routes liées à l’IA, au Cognitive Engine, à l’activité ou aux suggestions doivent rester prudentes : pas de diagnostic, pas de promesse clinique, pas de mesure d’état mental réel, pas de profilage externe.

Les labels internes comme `flow`, `deep_focus`, `friction` ou `fatigue` doivent rester des hypothèses ou observations fonctionnelles basées sur des signaux d’usage, jamais des diagnostics.

## Déploiement

Avant un déploiement : valider les variables d’environnement, migrations, tests critiques, CORS, Socket.IO, Stripe webhook, routes système, Sentry/logging et absence d’information sensible.

## Statut

Actif. Priorités : garder les guards MADPROOF verts, valider CI/CD, auditer les routes IA/cognitive selon MADPROOF et vérifier la cohérence modules frontend/backend.
