# Étage 4D — Vues de synthèse institutionnelles

## Route

`GET /api/decision/institutional-summary`

## Contrat

La réponse `institutional-summary@1` regroupe des indicateurs bornés et reproductibles pour :

- les risques ouverts et critiques;
- les plans de continuité actifs;
- les constats et actions d’audit en retard;
- les objectifs à risque et plans d’amélioration en retard;
- les sommes à recevoir et à payer.

Chaque requête applique `organisation_id=$1`, ne retourne aucune ligne métier complète et ne sélectionne que des agrégats numériques. Les calculs restent côté serveur.

## Évolution

Les futures sections documentaires et de gouvernance devront être ajoutées dans une nouvelle version du contrat si leur structure modifie la réponse. Un ajout rétrocompatible peut conserver `institutional-summary@1` lorsqu’il n’altère aucune propriété existante.
