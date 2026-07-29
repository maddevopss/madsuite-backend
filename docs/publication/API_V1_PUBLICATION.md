# Publication de l’API MADSuite v1

## Contrat

La publication doit identifier la version, le commit, le schéma OpenAPI, les chemins stables, les mécanismes d’authentification, les limites d’usage et la politique de compatibilité.

## Avant publication

- valider `swagger.yaml`;
- confirmer l’isolation par organisation;
- vérifier les réponses 401, 403, 404, 409 et 429;
- confirmer l’idempotence des opérations financières;
- vérifier les exemples sans données sensibles;
- inscrire les changements incompatibles et leur migration;
- relier la publication aux résultats de CI et E2E.

## Après publication

Surveiller les erreurs, le débit, la latence, les rejets d’authentification et les traitements en échec. Toute dépréciation doit être annoncée, datée et accompagnée d’une voie de migration.
