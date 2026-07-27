# Bloc A — Automatisations comptables métier

Issue : #336

## Résultat attendu

Chaque opération métier admissible crée une écriture comptable publiée, équilibrée, idempotente et retraçable.

## Sources obligatoires

- facture finalisée;
- paiement client;
- dépense;
- facture fournisseur;
- paiement fournisseur;
- paie;
- charges employeur.

## Garanties

- transaction unique avec l’opération source lorsque possible;
- aucune écriture partielle;
- aucune duplication au retraitement;
- organisation isolée;
- période ouverte obligatoire;
- comptes actifs et compatibles;
- lien source_type/source_id consultable;
- erreur explicite si la comptabilité n’est pas prête.

## Preuves requises avant fusion

- tests unitaires de calcul et de correspondance;
- tests PostgreSQL des contraintes et transactions;
- tests HTTP des parcours métier;
- seconde exécution sans doublon;
- validation des soldes produits.

Cette PR demeure en brouillon tant que toutes ces preuves ne sont pas présentes.