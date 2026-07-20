# Preuve P0 — isolation multi-tenant côté serveur

## Objectif

Fermer la portion serveur de l'issue SYSTEME_MAD #77 en démontrant qu'aucune donnée, écriture, diffusion temps réel, tâche asynchrone ou export ne peut franchir la frontière d'une organisation.

## Portée de la PR

- écriture croisée interdite;
- réutilisation d'une connexion PostgreSQL sans fuite de contexte RLS;
- Socket.IO cloisonné par organisation;
- jobs et crons exécutés avec un contexte d'organisation explicite;
- exports et rapports limités à l'organisation courante.

## Matrice de preuve

| Scénario | Résultat attendu |
|---|---|
| B tente de modifier un client de A | 403 ou 404, aucune mutation |
| B tente de supprimer un projet de A | 403 ou 404, ressource intacte |
| Connexion SQL réutilisée A → B | aucune donnée de A visible par B |
| Événement Socket.IO émis pour A | reçu uniquement dans `org_A` |
| Job lancé pour A | aucune ligne de B traitée |
| Export CSV/PDF demandé par B | aucune donnée de A dans le fichier |

## Fichiers de tests prévus

- `tests/security/multiTenantCrossWrite.p0.test.js`
- `tests/security/rlsPoolReuse.p0.test.js`
- `tests/socket/socketTenantIsolation.p0.test.js`
- `tests/jobs/jobTenantIsolation.p0.test.js`
- `tests/exports/exportTenantIsolation.p0.test.js`

## Règles de validation

1. Les tests créent deux organisations indépendantes.
2. Les identifiants de A sont réutilisés volontairement dans les requêtes de B.
3. Chaque refus est vérifié au niveau HTTP et au niveau base de données.
4. Les tests de pool alternent plusieurs fois A/B sur le même pool.
5. Aucun test ne doit dépendre uniquement de l'interface.

## Commande cible

```bash
npm test -- --runInBand tests/security tests/socket tests/jobs tests/exports
```

## Critère de fermeture

La preuve est considérée complète lorsque tous les scénarios sont verts en CI et que le résultat est relié à SYSTEME_MAD #77.
