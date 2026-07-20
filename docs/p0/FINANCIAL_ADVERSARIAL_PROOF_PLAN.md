# Preuve P0 — scénarios financiers adversariaux

## Objectif

Fermer la portion restante de l'issue SYSTEME_MAD #78 en démontrant que le cycle financier résiste aux événements désordonnés, concurrents, répétés et partiellement invalides.

## Portée de la PR

- webhooks Stripe reçus dans le désordre;
- double paiement et idempotence concurrente;
- paiement partiel;
- rollback transactionnel complet;
- plusieurs paiements simultanés;
- immuabilité du ledger;
- divergence volontaire puis réconciliation.

## Matrice de preuve

| Scénario | Résultat attendu |
|---|---|
| `payment_succeeded` avant l'événement de création attendu | état final cohérent après reprise |
| même webhook livré plusieurs fois | une seule écriture financière effective |
| deux paiements simultanés avec même clé | un seul résultat comptable |
| paiement partiel | solde restant exact, statut cohérent |
| erreur après écriture intermédiaire | transaction entièrement annulée |
| tentative de modification d'une entrée ledger | refus ou création d'une correction append-only |
| divergence Stripe/base locale | réconciliation détecte et corrige ou signale explicitement |

## Fichiers de tests prévus

- `tests/financial/webhookOrdering.p0.test.js`
- `tests/financial/paymentConcurrency.p0.test.js`
- `tests/financial/partialPayment.p0.test.js`
- `tests/financial/transactionRollback.p0.test.js`
- `tests/financial/ledgerImmutability.p0.test.js`
- `tests/financial/reconciliationEdgeCases.p0.test.js`

## Invariants à vérifier

1. Le total payé ne peut jamais dépasser le total facturé sans trace explicite.
2. Une clé d'idempotence ne produit qu'un effet métier.
3. Le ledger est append-only.
4. Une transaction échouée ne laisse aucun état partiel.
5. La réconciliation produit un résultat déterministe et traçable.
6. Les écritures restent isolées par organisation.

## Commande cible

```bash
npm test -- --runInBand tests/financial
```

## Critère de fermeture

La preuve est considérée complète lorsque tous les scénarios sont verts en CI et que le résultat est relié à SYSTEME_MAD #78.
