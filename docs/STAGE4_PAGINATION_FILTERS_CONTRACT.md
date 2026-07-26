# Étage 4B — Pagination, filtres et tri

## Contrat

Les listes d’intégrations utilisent une pagination déterministe par curseur opaque fondée sur le couple `created_at` et `id`.

Paramètres communs :

- `limit` : de 1 à 100, valeur par défaut 25;
- `cursor` : curseur opaque retourné par la page précédente;
- `sort` : `created_at`;
- `direction` : `asc` ou `desc`, valeur par défaut `desc`;
- `createdFrom` et `createdTo` : bornes ISO de période.

La réponse conserve le contrat `integration-list@1` :

```json
{
  "items": [],
  "meta": {
    "contract": "integration-list@1",
    "count": 0,
    "limit": 25,
    "hasMore": false,
    "nextCursor": null,
    "sort": "created_at",
    "direction": "desc"
  }
}
```

## Filtres spécialisés

Liens risques et continuité : `relationType`, `riskId`, `processId`, `planId`.

Liens institutionnels de risques : `targetType`, `relationshipType`, `riskId`, `targetId`.

## Garanties

- la portée de l’organisation demeure la première clause de chaque requête;
- tous les filtres utilisent des paramètres PostgreSQL;
- le tri ajoute `id` comme départage stable;
- une ligne supplémentaire est lue pour déterminer `hasMore` sans requête de comptage globale;
- un curseur invalide, une limite excessive ou un tri inconnu produit une erreur métier structurée;
- aucune donnée d’une autre organisation ne peut influencer la page ni son curseur.
