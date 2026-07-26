# Étage 4G — Compatibilité et dépréciation

## Règle de compatibilité

Un contrat public suit la forme `nom@version-majeure`. Une modification additive peut conserver la version majeure. Une modification qui retire, renomme ou change le sens d’un champ exige un nouveau contrat.

## Métadonnées

Chaque cycle de vie expose :

- `contract` : identifiant versionné;
- `deprecated` : indique qu’un remplacement doit être planifié;
- `sunset` : date ISO de retrait, seulement pour un contrat déprécié;
- `replacedBy` : contrat successeur, seulement pour un contrat déprécié.

## Garanties

- aucun retrait silencieux;
- aucune date de fin sans dépréciation explicite;
- aucun contrat qui se désigne lui-même comme successeur;
- possibilité d’émettre les en-têtes HTTP `Deprecation`, `Sunset` et `Link`;
- les clients existants continuent d’utiliser la version annoncée durant la période de transition.

Le registre initial comprend `integration-list@1`, `integration-resource@1`, `server-capabilities@1` et `transition@1`.
