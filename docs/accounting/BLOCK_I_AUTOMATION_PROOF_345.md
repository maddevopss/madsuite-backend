# Bloc I — Reprise des automatisations fusionnées sans preuve complète

Ce bloc vérifie et complète la portée du Bloc A après la fusion de #339.

## Critères obligatoires

- audit du code présent sur `main`;
- factures, paiements, dépenses, fournisseurs et paie réellement raccordés;
- transactions équilibrées et idempotentes;
- erreurs explicites lorsque le plan comptable n’est pas prêt;
- traçabilité source vers écriture;
- tests PostgreSQL et HTTP pour chaque source;
- second traitement sans doublon.

Le statut historique de #339 ne remplace pas ces preuves.