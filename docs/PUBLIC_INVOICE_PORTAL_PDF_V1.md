# Portail public de facture et PDF V1

## Autorité publique

Une facture est publiée par un jeton aléatoire de 256 bits. Seule son empreinte SHA-256 est conservée dans `invoice_public_links`.

Le champ historique `invoices.public_token` n'est plus une autorité d'accès aux factures.

## Cycle du lien

```text
facture finalisée
→ POST /api/portal/manage/invoices/:invoiceId
→ rotation du lien actif
→ consultation GET /api/portal/:token
→ PDF GET /api/portal/:token/pdf
→ révocation DELETE /api/portal/manage/invoices/:invoiceId
```

- durée autorisée : 1 à 365 jours;
- durée par défaut : 30 jours;
- une seule liaison active par facture et organisation;
- une rotation révoque immédiatement le lien précédent;
- un lien inconnu, expiré ou révoqué reçoit la même réponse 404;
- aucune route publique de liste n'existe.

## Données publiques

La réponse publique contient seulement :

- numéro, état, dates et notes de la facture;
- nom du client;
- lignes, quantités, taux et montants;
- sous-total, taxes et total;
- nom de l'entreprise et disponibilité du paiement en ligne.

Aucun identifiant interne d'organisation, client, projet, entrée de temps ou facture n'est exposé.

## PDF

Le PDF est généré depuis le même objet de facture que la réponse publique. Il est servi avec un nom neutralisé, `Content-Disposition: attachment`, `Cache-Control: private, no-store` et une interdiction d'indexation.

## Sécurité

- aucun jeton brut en base ou dans les journaux;
- lien limité aux états `finalized`, `sent` et `paid`;
- facture brouillon, annulée ou supprimée non publiable;
- opérations de création et révocation authentifiées, administrateur seulement et limitées à l'organisation courante;
- accès public borné par le limiteur général du portail.
