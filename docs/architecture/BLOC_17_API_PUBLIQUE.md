# Bloc 17 — API publique

## Objectif

Exposer les capacités autorisées de MADSuite au moyen d’un contrat stable, versionné, documenté et isolé par organisation.

## Portée complète

- versionnement explicite des routes;
- authentification et autorisation;
- clés et secrets révocables;
- limites d’usage;
- idempotence des écritures;
- pagination et erreurs normalisées;
- contrat OpenAPI;
- stratégie de dépréciation;
- journalisation et preuves;
- compatibilité contrôlée;
- approbation humaine avant activation.

## Règle de fermeture

Le bloc est fermé lorsque tous les contrôles sont prouvés et qu’une personne autorisée approuve l’activation. Une documentation générée ou une CI verte ne remplace pas cette décision.
