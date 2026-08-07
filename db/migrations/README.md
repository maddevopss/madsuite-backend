# Future migrations

Put new incremental schema changes here.

Historical migrations are archived in `../archive/migrations/`.
Fresh installs use `../schema_current.sql`.

## Migrations Stage 5 ajoutées le 2026-08-03

Les migrations actives doivent conserver un nom unique et un changement de schéma
unique. La migration `20260803_00_retry_engine_quarantine.sql` est additive : elle
normalise la contrainte de `quarantine_queue` après la migration fondatrice
`20260802_99_retry_engine_quarantine.sql`.

L’intégration Outbox est portée uniquement par
`20260803_01_outbox_enhanced.sql`. Aucun fichier homonyme ou duplicata de contenu
ne doit être ajouté.
