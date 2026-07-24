# Facturation depuis les heures V1

## Contrat

L’aperçu `/api/invoices/time-billing-preview` filtre les entrées terminées, non supprimées et non facturées de l’organisation courante.

Les filtres acceptés sont :

- `client_id` obligatoire;
- `project_id` facultatif;
- `from` et `to` facultatifs au format `YYYY-MM-DD`;
- `tax_rate` de 0 à 100.

La réponse contient les entrées et un résumé calculé côté serveur : nombre d’entrées, heures, sous-total, taxes, total et devise.

La création finale demeure portée par le service canonique des factures, avec transaction, verrouillage, liaison des entrées et idempotence.
