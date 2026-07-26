# Bloc 1 — Comptabilité complète (#310)

## Capacités consolidées

MADSuite possède désormais un noyau comptable en partie double par organisation comprenant :

- un plan comptable fr-CA configurable;
- des journaux et périodes comptables;
- des écritures brouillon, publiées et renversées;
- l’égalité obligatoire des débits et crédits;
- la fermeture et la réouverture gouvernées des périodes;
- le grand livre et la balance de vérification;
- l’état des résultats et le bilan expliqués;
- un état initial des flux de trésorerie traçable;
- des exports CSV du journal et de la balance;
- la production PDF des états financiers;
- l’isolation stricte par organisation;
- des événements métier, une projection quotidienne et un chemin d’explication jusqu’aux sources.

## API

- `GET /api/accounting/accounts`
- `POST /api/accounting/accounts/seed`
- `POST /api/accounting/accounts`
- `GET|POST /api/accounting/periods`
- `POST /api/accounting/periods/:id/close`
- `POST /api/accounting/periods/:id/reopen`
- `GET|POST /api/accounting/entries`
- `POST /api/accounting/entries/:id/post`
- `POST /api/accounting/entries/:id/reverse`
- `GET /api/accounting/entries/:id/explain`
- `GET /api/accounting/ledger`
- `GET /api/accounting/trial-balance`
- `GET /api/accounting/statements`
- `GET /api/accounting/statements/explained`
- `GET /api/accounting/cash-flow`
- `GET /api/accounting/exports/trial-balance.csv`
- `GET /api/accounting/exports/journal.csv`

## Règles de fermeture

1. Une écriture publiée n’est jamais corrigée destructivement; elle est renversée.
2. Une période fermée refuse les nouvelles écritures ordinaires.
3. Toute opération conserve son organisation, sa provenance et ses références.
4. Les exports et rapports réutilisent uniquement les écritures publiées ou renversées.
5. Les clés d’idempotence préviennent la double comptabilisation des automatismes.
6. Tous les montants sont exprimés en dollars canadiens sauf devise explicitement déclarée.

## Validation attendue avant fusion

```bash
npm run build
npm test -- --runInBand
npm run db:preflight:org
```

Le scénario de recette est : création du plan comptable, ouverture d’une période, facture, paiement, dépense, publication, balance équilibrée, états financiers, flux de trésorerie et traçage jusqu’aux écritures sources.
