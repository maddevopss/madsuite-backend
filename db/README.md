# Database files

For a fresh database, use `schema_current.sql`.
For history, use `archive/migrations/`.
For future schema changes, add new numbered files in `migrations/`.

- New installs boot from `schema_current.sql`.
- Existing installs continue through `npm run db:migrate`.
- Applied files are tracked in `schema_migrations`.
- Never edit an already-applied migration.

Before a production deployment:

```bash
npm run db:preflight:org --prefix backend
npm run db:migrate --prefix backend
```

`manual-danger-zone/` is only for destructive admin resets. It is never loaded
by the migration runner.

`src/test/setupInvoicesTestDB.js` is test-only and must never target a
development or production database.

## Multi-organisation & soft delete

### Comportement utilisateur orphelin

Quand une organisation est supprimée (hard delete), les utilisateurs liés deviennent orphelins :

- `utilisateurs.organisation_id = NULL`
- L'utilisateur **ne peut plus se connecter** — le middleware `requireOrganisation` rejette toute requête sans `organisation_id`.
- Les données de l'utilisateur (time_entries, activity_logs, etc.) sont conservées pour l'audit.

**Raison :** préserver la traçabilité tout en empêchant l'accès post-suppression.

Si tu veux détruire complètement un utilisateur orphelin :

```sql
DELETE FROM utilisateurs WHERE organisation_id IS NULL AND deleted_at < NOW() - INTERVAL '30 days';
```
