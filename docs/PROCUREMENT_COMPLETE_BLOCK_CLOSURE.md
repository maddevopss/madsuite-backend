# Fermeture du bloc Gestion des fournisseurs et des achats

## Portée

Le bloc couvre le cycle complet : qualification des fournisseurs, demandes d'achat, demandes de prix, soumissions, commandes, réceptions, écarts, rapprochement des factures, paiements et performance fournisseur.

## Règles de fermeture

- une facture fournisseur est rapprochée avec la commande et la réception;
- tout écart exige une justification et une preuve d'approbation;
- aucun paiement n'est permis avant approbation de la facture;
- un paiement ne peut dépasser le solde restant;
- une commande ne peut être fermée avant réception complète, résolution des exceptions et preuve de fermeture;
- les qualifications expirées ou suspendues doivent apparaître dans les alertes opérationnelles;
- toutes les données demeurent isolées par organisation.

## Intégrations

Les lignes reçues peuvent alimenter l'inventaire. Les factures et paiements peuvent alimenter la comptabilité. Les fournisseurs externes peuvent être reliés aux interventions de maintenance et aux documents contractuels.

## Preuves

La migration, les règles déterministes et le contrat de test transversal constituent la preuve de fermeture technique du bloc.
