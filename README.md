# MADSuite Backend

Backend officiel de MADSuite.

Source de vérité documentaire : `bleeband/SYSTEME_MAD`.

Avant toute décision structurante, consulter :

```text
SYSTEME_MAD/MANIFEST.md
SYSTEME_MAD/00-SYSTEME-MAD/ai-context.md
SYSTEME_MAD/00-SYSTEME-MAD/ai-context-madsuite-madproof.md
SYSTEME_MAD/00-SYSTEME-MAD/repos.md
SYSTEME_MAD/04-ADR/
SYSTEME_MAD/09-CHECKLISTS/
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
npm run test:security -- --runInBand
```

Validation complète locale :

```bash
npm run check:backend
```

Les guards bloquent notamment :

- règles `.gitignore` critiques manquantes;
- fichiers `.env` réels, artefacts générés ou secrets évidents;
- routes platform montées sans garde super-admin;
- routes métier organisationnelles sans contexte `requireOrganisation` / RLS.

Si un guard tombe rouge, corriger le code ou la politique plutôt que de contourner le guard. Une exception doit être documentée dans `SYSTEME_MAD` avant fusion.

## Environnement

Ne jamais commiter de fichier `.env` réel. Utiliser `.env.example` comme référence sans secret.

## Sécurité

Toute route métier doit respecter l’isolation par organisation. Ne jamais exposer les données d’une autre organisation, ne jamais envoyer de notification cross-org, protéger les webhooks, éviter les logs contenant des secrets et garder les endpoints IA limités et audités.

## MADSuite / MADPROOF

MADSuite est un SaaS de gestion et d’assistance cognitive non médicale.

Les routes liées à l’IA, au Cognitive Engine, à l’activité ou aux suggestions doivent rester prudentes : pas de diagnostic, pas de promesse clinique, pas de mesure d’état mental réel, pas de profilage externe.

Les labels internes comme `flow`, `deep_focus`, `friction` ou `fatigue` doivent rester des hypothèses ou observations fonctionnelles basées sur des signaux d’usage, jamais des diagnostics.

## Déploiement

Avant un déploiement : valider les variables d’environnement, migrations, tests critiques, CORS, Socket.IO, Stripe webhook, routes système, Sentry/logging et absence de secrets.

## Statut

Actif. Priorités : garder les guards MADPROOF verts, valider CI/CD, auditer les routes IA/cognitive selon MADPROOF et vérifier la cohérence modules frontend/backend.
