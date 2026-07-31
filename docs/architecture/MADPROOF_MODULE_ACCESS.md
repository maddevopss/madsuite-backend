# MADPROOF — Module Access Rules

Ce document décrit la règle officielle d’accès aux modules côté backend.

Source de vérité produit :

```text
bleeband/SYSTEME_MAD
SYSTEME_MAD/09-CHECKLISTS/chk-052-p3-plans-modules-subscriptions.md
```

## Règle principale

Une route backend sensible ne doit pas décider localement si une organisation a accès à un module.

La vérification doit passer par :

```text
src/middleware/requireModule.js
```

Usage recommandé :

```javascript
const { requireModule } = require('../middleware/requireModule');

router.get(
  '/',
  requireOrganisation,
  requireModule('invoices'),
  handler,
);
```

## Rôle du middleware

`requireModule(moduleKey)` vérifie :

```text
1. la clé existe dans le registre MODULES;
2. le contexte organisation est disponible;
3. le plan inclut le module;
4. sinon, le module est activé explicitement;
5. sinon, la route retourne 403 MODULE_NOT_AVAILABLE.
```

## Règle frontend/backend

Frontend :

```text
ModuleGate = garde d’expérience utilisateur
```

Backend :

```text
requireModule = garde d’accès API
```

`ModuleGate` ne remplace jamais `requireModule`.

## Tests

La commande backend suivante inclut les tests de registre, de payload et d’accès module :

```bash
npm run test:modules
```

Le test dédié est :

```text
src/test/requireModule.test.js
```
