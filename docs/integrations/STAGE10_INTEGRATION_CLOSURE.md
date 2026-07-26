# Constat de fermeture — Étage 10

## Portée

L’Étage 10 encadre les échanges entre MADSuite et les services externes. Aucun fournisseur n’obtient d’autorité implicite sur les règles métier internes.

## Preuves requises

- registre versionné des intégrations et de leurs capacités;
- secrets séparés par organisation et environnement, rotatifs et révocables;
- webhooks signés, horodatés, rejouables uniquement selon une procédure contrôlée;
- entrées externes validées, authentifiées, idempotentes et soumises aux politiques métier;
- connecteurs de référence sans statut de source de vérité implicite;
- quotas et usage mesurés sans double comptabilisation financière;
- contrats, erreurs, environnement d’essai et dépréciation documentés;
- tests de panne fournisseur, signature invalide, rejeu, rotation et isolation interorganisation.

## Risques résiduels

Chaque fournisseur conserve ses propres risques de disponibilité et de changement de contrat. Ces risques doivent être suivis dans le registre opérationnel et peuvent entraîner la suspension immédiate de l’intégration.

## Décision

L’Étage 10 peut être déclaré fermé lorsque toutes les PR 10A à 10H sont fusionnées et que leurs validations automatisées réussissent. Chaque échange externe demeure authentifié, autorisé, idempotent, observable, révocable et isolé par organisation.
