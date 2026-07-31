# Round 2 - Verification rigoureuse P0 + P1 (Partie A)

Date: 2026-07-30
Scope: `backend`
Statut: complete, avec limites externes documentees

## A1 - Role prod VPS reel

Statut: impossible a verifier.

Neon n'est plus utilise pour la production. La verification doit viser le PostgreSQL reel du VPS avec la meme connexion que l'application.

Requete a executer sur le VPS:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Critere attendu: `rolsuper = false` et `rolbypassrls = false`.

## A2 - Test reel Docker + role superuser

Statut: en attente.

La configuration locale pointe vers `127.21.0.2:5433`, mais l'instance Docker locale n'etait pas disponible au moment du test.

## A3 - Auto-review async/flush

Verdict initial: le guard etait appele avant `app.listen()`, mais la correction `setTimeout(() => process.exit(1), 100)` etait insuffisante.

Risque corrige: un `setTimeout` sans `throw` faisait retourner `assertRoleNotSuperuser()`, donc `server.js` pouvait continuer vers `listen()` pendant la fenetre de 100 ms.

Correction finale appliquee dans `db.js`:

```javascript
logger.error(...);
await new Promise((resolve) => setTimeout(resolve, 100));
throw new Error(`Unsafe database role: ${reason}`);
```

Effet: le flush Winston a une courte fenetre bloquante, puis l'erreur remonte au `catch` de `server.js`; le serveur ne demarre pas.

Correction additionnelle: la query selectionne maintenant `rolname` pour que le log contienne le role reel:

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
```

## A4 - Trace `analytics.routes.js`

`GET /funnel`: vue globale intentionnelle, protegee par `requireSuperAdmin`.

`POST /track`: scope via `getOrganisationId(req)`, validation 400 si absent, puis passage au service.

Verdict: aucune modification necessaire.

## Tests

Commande executee:

```bash
npm test -- src/test/assertRoleNotSuperuser.test.js --runInBand
```

Resultat: 1 suite OK, 4 tests OK.

## Fichiers modifies

- `db.js`: guard RLS superuser/BYPASSRLS, flush bloquant court, `throw` au lieu d'un `process.exit` interne.
- `server.js`: guard appele apres migrations et avant creation du serveur HTTP.
- `src/test/assertRoleNotSuperuser.test.js`: test ajoute pour verifier qu'un role unsafe rejette avant retour et n'appelle pas `process.exit`.

## Conclusion

P0 RLS Superuser: complete cote code local.

Restent externes: verifier le role PostgreSQL applicatif sur le VPS, puis refaire le test Docker superuser quand l'instance locale est disponible.
