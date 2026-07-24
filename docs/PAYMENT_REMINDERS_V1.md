# Relances de paiement V1

## Résultat utilisateur

Une facture envoyée, finalisée et échue peut recevoir une relance J+3, J+7 ou J+14, sans doublon et sans relance après paiement.

## Contrat

- statuts facturables : `sent` seulement;
- finalisation exigée : `finalized_at IS NOT NULL`;
- facture supprimée ou sans échéance exclue;
- étapes déterministes : 3, 7 et 14 jours de retard;
- unicité : `(organisation_id, invoice_id, stage)`;
- modes : manuel ou automatique;
- états : queued, sent, failed, stopped;
- lien public : généré par le service sécurisé de facture;
- montants et dates : lus depuis la facture canonique;
- aucune logique métier contradictoire dans le navigateur.

## Routes

- `GET /api/payment-reminders/settings`
- `PUT /api/payment-reminders/settings`
- `GET /api/payment-reminders/candidates`
- `GET /api/payment-reminders/history`
- `POST /api/payment-reminders/invoices/:id/send`

## Sécurité

Toutes les lectures et écritures sont limitées à l’organisation courante. Les envois et changements de réglages exigent un administrateur. Les tables possèdent une politique d’isolation PostgreSQL.
