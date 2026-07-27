# Réservations et inventaires physiques

## Quantités

- **En main** : quantité réellement enregistrée dans un emplacement.
- **Réservée** : quantité active promise à une source métier et non expirée.
- **Disponible** : quantité en main moins quantité réservée.

Les trois valeurs sont calculées par PostgreSQL. Le navigateur ne recalcule jamais la disponibilité.

## Réservation

Une réservation exige :

- un article;
- un emplacement;
- une quantité positive;
- un type et un identifiant de source;
- une clé d’idempotence d’au moins huit caractères.

La création verrouille le solde de l’article et additionne les réservations actives avant d’accepter la demande. Deux requêtes concurrentes ne peuvent donc pas allouer silencieusement la même quantité.

États possibles : `active`, `released`, `consumed`, `expired`, `cancelled`.

## Inventaire physique

Une session cible un emplacement et capture les quantités attendues et le coût moyen au moment de son ouverture.

Cycle :

1. `counting` — saisie ou recomptage;
2. `review` — toutes les lignes sont comptées;
3. `approved` — les écarts deviennent des ajustements d’inventaire;
4. `cancelled` — aucun ajustement.

La personne qui soumet un comptage ne peut pas l’approuver. Chaque ligne en écart génère un mouvement idempotent lié à `inventory_count_session` et conserve l’écriture comptable produite par le moteur d’inventaire.

## Routes

- `GET /api/inventory/availability`
- `GET|POST /api/inventory/reservations`
- `POST /api/inventory/reservations/:id/release`
- `POST /api/inventory/reservations/:id/consume`
- `POST /api/inventory/reservations/:id/cancel`
- `GET|POST /api/inventory/counts`
- `GET /api/inventory/counts/:id`
- `PUT /api/inventory/counts/:id/items/:itemId`
- `POST /api/inventory/counts/:id/submit`
- `POST /api/inventory/counts/:id/approve`

## Validation

```bash
npm test -- --runInBand src/test/inventory-control.service.test.js
npm run migrate
```

La preuve finale doit aussi couvrir deux organisations, deux réservations concurrentes et un ajustement de comptage produisant une écriture équilibrée.