# Maintenance exceptionnelle du ledger

`ledger_entries` est append-only au niveau PostgreSQL.

Toute opération `UPDATE` ou `DELETE` est refusée par défaut. Une intervention exceptionnelle doit être exécutée dans une transaction avec les trois paramètres locaux suivants :

```sql
BEGIN;
SELECT set_config('app.ledger_maintenance_mode', 'on', true);
SELECT set_config('app.ledger_maintenance_actor', '<identité de l’opérateur>', true);
SELECT set_config('app.ledger_maintenance_reason', '<raison et référence du changement>', true);
-- opération exceptionnelle ciblée
COMMIT;
```

Chaque mutation autorisée est automatiquement enregistrée dans `ledger_maintenance_audit` avec l’opération, l’acteur déclaré, la raison, l’utilisateur PostgreSQL et l’état précédent complet de la ligne.

Ce mode ne doit jamais être activé par le parcours applicatif normal. Il est réservé aux migrations, restaurations et interventions contrôlées.
