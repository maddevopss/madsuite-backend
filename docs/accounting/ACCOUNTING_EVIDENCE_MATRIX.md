# Matrice de preuves — Comptabilité complète

## Objet

Ce document définit les preuves exigées pour fermer le bloc parent #310 sans confondre présence de code et fonctionnement démontré.

## Dépendances

Les PR suivantes doivent être fusionnées avant la preuve finale complète :

- #349 — automatisations comptables et idempotence;
- #354 — grand livre traçable;
- #355 — balance comparative et anomalies;
- #356 — états financiers comparatifs.

## Commandes de validation

```bash
npm test -- --runInBand \
  src/test/accounting-ledger.service.test.js \
  src/test/accounting-ledger.route.test.js \
  src/test/accounting-trial-balance.service.test.js \
  src/test/accounting-trial-balance.route.test.js \
  src/test/accounting-statements-comparative.service.test.js \
  src/test/accounting-statements-comparative.route.test.js
```

Preuves PostgreSQL réelles :

```bash
RUN_ACCOUNTING_POSTGRES_EVIDENCE=true \
NODE_ENV=test \
npm test -- --runInBand src/test/accounting-evidence-matrix.integration.test.js
```

## Preuves obligatoires

| Preuve | Résultat attendu |
|---|---|
| Schéma comptable | Les cinq tables essentielles existent |
| Équilibre | Aucune écriture publiée avec débit différent du crédit |
| Étanchéité | Aucune ligne liée à une écriture ou un compte d’une autre organisation |
| Traçabilité | Toute écriture publiée possède une source ou une justification |
| Unicité | Aucun numéro d’écriture dupliqué dans une même organisation |
| Grand livre | Soldes d’ouverture, mouvements, solde courant et sources disponibles |
| Balance | Deux périodes, écarts, équilibre et anomalies disponibles |
| États financiers | Résultats, bilan et trésorerie comparatifs disponibles |

## Contrat HTTP à constater

- `GET /api/accounting/ledger`
- `GET /api/accounting/trial-balance`
- `GET /api/accounting/statements`

Les trois réponses doivent être filtrées par l’organisation authentifiée et ne jamais accepter un identifiant d’organisation fourni par le client.

## Critère de fermeture

Le bloc #353 peut être fermé seulement lorsque :

1. les PR dépendantes sont fusionnées;
2. les tests unitaires et HTTP sont verts;
3. la matrice PostgreSQL s’exécute sur une base migrée réelle;
4. aucune anomalie d’équilibre ou de séparation entre organisations n’est retournée;
5. les résultats CI sont attachés à la PR de fermeture.
