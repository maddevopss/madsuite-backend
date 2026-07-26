# Étage 4F — Documentation OpenAPI et contrats publics

## Portée

Le fichier `openapi/stage4-contracts.yaml` publie les éléments réutilisables qui encadrent les intégrations institutionnelles de MADSuite :

- pagination bornée et curseurs;
- métadonnées de contrat versionnées;
- capacités calculées côté serveur;
- transitions sensibles avec justification, preuve et idempotence;
- erreurs métier structurées et stables.

## Autorité

La documentation décrit le contrat exposé. Elle ne remplace ni les gardes d’autorisation, ni l’isolation par organisation, ni les transactions du serveur.

## Compatibilité

Les contrats initiaux demeurent :

- `integration-list@1`;
- `integration-resource@1`;
- `server-capabilities@1`;
- `transition@1`.

Toute modification incompatible exige un nouveau numéro majeur de contrat et une période de dépréciation explicite.

## Preuves

La suite `stage4-openapi.contract.test.js` charge le document avec le même analyseur YAML que le serveur et vérifie la présence des paramètres, schémas, limites et codes institutionnels obligatoires.
