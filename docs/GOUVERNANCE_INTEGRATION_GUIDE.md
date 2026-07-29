# Guide d’intégration du noyau de gouvernance

## But

Ce guide décrit le contrat minimal qu’un module métier doit respecter avant d’utiliser le noyau de gouvernance de MADSuite.

## 1. Contexte obligatoire

Toute commande doit contenir :

- `organisationId`;
- `aggregateType`;
- `aggregateId`;
- `actorId`;
- `action`;
- `idempotencyKey`.

L’organisation provient du contexte serveur authentifié. Une valeur fournie par le client ne doit jamais remplacer ce contexte.

## 2. Cycle décisionnel

Le cycle normal est :

`observation → analysis → decision → approval → execution → verification → closure`

Une transition ne doit jamais contourner une étape obligatoire. Les preuves doivent être présentes avant l’approbation et la vérification doit précéder la fermeture.

## 3. Autorisation

Avant chaque transition, le module doit vérifier :

- le rôle de l’acteur;
- la séparation des responsabilités;
- les approbations exigées;
- les exceptions encore valides;
- les règles d’arrêt;
- l’isolation multi-organisation.

## 4. Preuves et intégrité

Les décisions, preuves et événements doivent conserver une empreinte d’intégrité. Les secrets de signature demeurent côté serveur et ne sont jamais retournés au client.

## 5. Journalisation

Chaque transition acceptée ou refusée produit un événement institutionnel contenant au minimum l’organisation, l’agrégat, l’acteur, l’action, le résultat et l’horodatage.

## 6. Tests obligatoires

Chaque intégration doit exécuter :

- la suite de conformité du cycle;
- la suite de sécurité et d’isolation;
- un scénario d’idempotence;
- un scénario d’altération de preuve;
- un scénario de refus d’auto-approbation.

## 7. Critères de sortie

Une intégration est prête lorsque :

- toutes les transitions autorisées réussissent;
- toutes les transitions interdites sont refusées;
- aucune organisation ne peut lire ou modifier les données d’une autre;
- les événements sont traçables;
- les décisions demeurent humaines lorsque la politique l’exige.
