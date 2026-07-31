# Phase 0 - Fermeture du gap RLS Superuser

Date: 2026-07-30
Scope: `backend`

## Verite role de connexion

Dev local: non verifie, DB locale `127.21.0.2:5433` indisponible.

Test env: `postgres` est superuser/BYPASSRLS, attendu pour les tests RLS. Le guard skippe explicitement `NODE_ENV=test`.

Prod VPS: a verifier sur le PostgreSQL reel du VPS. Neon n'est plus utilise.

Commande de verification a lancer sur la connexion applicative du VPS:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Critere attendu: `rolsuper = false` et `rolbypassrls = false`.

## Garde permanente

`db.js` expose `assertRoleNotSuperuser(pool)`.

La query verifie le role courant:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
```

Si `rolsuper` ou `rolbypassrls` est vrai hors test:

- log fatal via Winston avec `rolname`, `rolsuper`, `rolbypassrls`, `NODE_ENV`
- attente bloquante courte de 100 ms pour laisser les transports async flusher
- `throw new Error(...)`

`server.js` appelle le guard apres les migrations et avant `http.createServer()` / `listen()`.

## Tests

Fichier: `src/test/assertRoleNotSuperuser.test.js`

Tests couverts:

- role normal non-superuser detecte comme safe
- privileges du role courant detectables
- skip en `NODE_ENV=test`
- role unsafe en environnement non-test rejette avant retour et n'appelle pas `process.exit`

Commande executee:

```bash
npm test -- src/test/assertRoleNotSuperuser.test.js --runInBand
```

Resultat: 1 suite OK, 4 tests OK.

## Routes revues

- `activity.read.routes.js`: scope via `getOrganisationId(req)`
- `activity.write.routes.js`: scope via `getOrganisationId(req)`
- `analytics.routes.js`: `/track` scope, `/funnel` global superadmin intentionnel
- `paymentReminders.routes.js`: scope via `getOrganisationId(req)`

## Conclusion

La garde applicative bloque maintenant le demarrage si la connexion DB a `SUPERUSER` ou `BYPASSRLS`, hors environnement de test.

Limites restantes: verification du role applicatif PostgreSQL sur le VPS et test Docker reel a refaire quand les ressources externes sont disponibles.
