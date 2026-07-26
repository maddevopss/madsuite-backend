# Étage 4H — Validation institutionnelle et fermeture

## Objet

Cette clôture affirme que l’interface du backend MADSuite repose désormais sur des contrats explicites, versionnés, testés et capables d’évoluer sans rupture silencieuse.

## Périmètre validé

- réponses de listes et de ressources;
- pagination bornée, filtres et ordre déterministe;
- capacités calculées côté serveur;
- transitions sensibles normalisées;
- documentation OpenAPI vérifiable;
- compatibilité, dépréciation et remplacement;
- erreurs métier stables.

## Autorités conservées

- le serveur demeure l’autorité d’autorisation;
- l’organisation courante demeure une frontière obligatoire;
- la transaction demeure l’autorité d’atomicité et de rejeu;
- le navigateur et les clients externes ne peuvent déduire ni élargir leurs droits.

## Critères de fermeture

L’étage est fermé lorsque les PR 4F, 4G et 4H sont fusionnées dans l’ordre, que la suite complète est verte et que les contrats actifs suivants sont présents :

- `integration-list@1`;
- `integration-resource@1`;
- `server-capabilities@1`;
- `transition@1`.

Toute évolution ultérieure doit suivre les règles de cycle de vie définies à l’étage 4G.
