# Portail développeur — contrats d’intégration

## Portée

Le portail décrit les événements, schémas, erreurs, permissions et cycles de vie pris en charge par MADSuite. Une clé d’intégration est toujours limitée à une organisation, un environnement et un ensemble de capacités explicites.

## Environnement d’essai

Les essais utilisent exclusivement des données synthétiques. Les opérations destructives sont interdites en production. Les webhooks de test sont signés comme en production, mais utilisent des secrets distincts.

## Erreurs communes

- `integration.unauthorized` : capacité non accordée;
- `integration.organisation_mismatch` : portée d’organisation invalide;
- `integration.replay_detected` : événement déjà traité ou trop ancien;
- `integration.quota_exceeded` : limite atteinte;
- `integration.contract_deprecated` : contrat encore accepté pendant sa période de transition.

## Compatibilité

Chaque contrat possède une version. Toute dépréciation annonce un remplacement et une date de retrait. Aucun retrait ne peut être effectué tant qu’un consommateur actif n’a pas été identifié, informé et migré.
