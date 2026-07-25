# Encaissements et paiements partiels V1

## Résultat utilisateur

Une facture envoyée peut recevoir un ou plusieurs paiements. MADSuite conserve chaque encaissement, calcule le total reçu et le solde restant, puis marque la facture payée seulement lorsque le solde atteint exactement zéro.

## Contrat serveur

- `GET /api/invoice-payments/invoices/:id` retourne `summary` et `payments`;
- `POST /api/invoice-payments/invoices/:id` enregistre un paiement manuel;
- une clé d’idempotence de 8 à 255 caractères est obligatoire;
- les montants sont traités en cents pour éviter les dérives flottantes;
- le surpaiement est refusé;
- seules les factures finalisées et envoyées sont admissibles;
- chaque paiement produit une écriture append-only dans `ledger_entries`;
- le dernier paiement passe la facture à `paid` et arrête les relances en file;
- le navigateur ne décide jamais du solde ni du statut final.

## Méthodes prises en charge

- argent comptant;
- chèque;
- virement bancaire;
- carte;
- Stripe;
- autre.

## Isolation

La table `invoice_payments` possède une politique PostgreSQL fondée sur `app.current_organisation_id`. Toutes les lectures et écritures applicatives ajoutent aussi explicitement `organisation_id`.
