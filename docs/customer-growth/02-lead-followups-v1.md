# Suivis de prospects — activités et rappels V1

## Intention

Permettre de conserver ce qui a été fait avec un prospect et ce qui doit être fait ensuite, sans transformer MADSuite en outil commercial surchargé.

## Portée d’implantation

- ajouter une table d’activités de prospect;
- types initiaux : note, appel, courriel, rencontre, rappel;
- associer chaque activité à une organisation et à un prospect;
- conserver auteur, date de création, contenu et échéance facultative;
- permettre de terminer ou annuler un rappel;
- exposer une chronologie ordonnée du plus récent au plus ancien;
- empêcher toute lecture ou écriture entre organisations;
- journaliser les changements de statut importants.

## Routes visées

- `GET /api/customer-growth/leads/:id/activities`;
- `POST /api/customer-growth/leads/:id/activities`;
- `PATCH /api/customer-growth/leads/:id/activities/:activityId`;
- `DELETE /api/customer-growth/leads/:id/activities/:activityId`;
- `GET /api/customer-growth/follow-ups?due_before=...&status=open`.

## Données minimales

- `id`;
- `organisation_id`;
- `lead_id`;
- `type`;
- `content`;
- `due_at` facultatif;
- `completed_at` facultatif;
- `created_by`;
- `created_at`;
- `updated_at`.

## Tests attendus

- migration et contraintes;
- politiques d’isolation par organisation;
- refus d’un prospect d’une autre organisation;
- validation des types et longueurs;
- création et lecture chronologique;
- clôture idempotente d’un rappel;
- suppression contrôlée;
- absence de fuite dans les listes d’échéances.

## Dépendance

À traiter après le cycle de vie des prospects.

## Hors portée

- envoi automatique de courriels;
- notifications externes;
- synchronisation de calendrier;
- intelligence artificielle de relance.
