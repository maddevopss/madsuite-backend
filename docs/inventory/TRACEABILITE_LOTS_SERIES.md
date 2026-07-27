# Inventaire — traçabilité par lot et numéro de série

## Portée

Ce bloc ajoute la traçabilité fine aux mouvements quantitatifs déjà présents. Le moteur principal demeure l’autorité sur les quantités et la comptabilité. Les lots et numéros de série ajoutent l’identité, l’état sanitaire et la chaîne de preuve.

## Modes de suivi

Chaque article utilise un seul mode :

- `quantity` : quantité simple;
- `lot` : quantité regroupée sous un numéro de lot;
- `serial` : une identité unique pour chaque unité.

Le mode est choisi sur l’article. Une réception suivie est refusée lorsque les renseignements ne correspondent pas à ce mode.

## Réception suivie

Une réception exige :

- l’article;
- l’emplacement;
- la quantité;
- une clé d’idempotence;
- un numéro de lot pour un article suivi par lot;
- exactement un numéro de série distinct par unité pour un article suivi par série.

La réception peut conserver :

- le fournisseur;
- la réception d’achat source;
- la date de fabrication;
- la date d’expiration;
- le coût unitaire.

Une nouvelle tentative avec la même clé d’idempotence retourne la première preuve sans créer de doublon.

## Sortie suivie

Une sortie par lot exige le lot exact. Elle est refusée lorsque :

- le lot n’est pas disponible;
- le lot est en quarantaine;
- le lot est rappelé;
- le lot est expiré;
- la quantité disponible est insuffisante.

Une sortie par série exige les numéros exacts. Une unité déjà sortie, réservée, rappelée, mise en quarantaine ou expirée ne peut pas être sortie de nouveau.

## Quarantaine

La quarantaine bloque immédiatement :

- le lot;
- les unités sérialisées encore disponibles dans le lot;
- toute nouvelle sortie liée à ce lot.

La levée de quarantaine exige une raison et crée un événement de preuve distinct.

## Rappel

Un rappel possède :

- un numéro unique par organisation;
- un article;
- facultativement un lot ciblé;
- une raison obligatoire;
- un état ouvert, contenu, fermé ou annulé;
- l’auteur et les dates importantes.

Lorsqu’un lot est ciblé, le lot et ses unités encore contrôlées passent à l’état `recalled`.

## Expiration

Les dates d’expiration ne sont pas seulement informatives. Le service bloque les sorties expirées. L’API d’alertes retourne les lots arrivant à échéance dans un horizon configurable de 0 à 365 jours.

## Chaîne de preuve

Chaque action importante crée un événement dans `inventory_trace_events` :

- réception;
- sortie;
- quarantaine;
- levée de quarantaine;
- rappel;
- expiration;
- retour;
- transfert ou ajustement lorsqu’ils seront reliés aux blocs suivants.

Chaque événement conserve l’organisation, l’article, le lot, la série, l’emplacement, la source métier, l’auteur, la date et la clé d’idempotence.

## Isolation

Toutes les nouvelles tables :

- portent `organisation_id`;
- utilisent des clés étrangères composites;
- activent les politiques d’isolation PostgreSQL;
- empêchent les liens entre données de deux organisations.

## Preuves attendues avant fusion

- migration complète sur une base PostgreSQL vierge;
- réception d’un lot;
- réception d’unités sérialisées;
- refus d’un doublon de série;
- refus d’un lot expiré;
- refus d’un lot en quarantaine;
- rappel et fermeture;
- isolation entre deux organisations;
- CI complète verte.
