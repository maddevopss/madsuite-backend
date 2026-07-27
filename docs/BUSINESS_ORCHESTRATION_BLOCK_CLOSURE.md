# Fermeture du bloc Orchestration métier

Le bloc est considéré fermé lorsque les processus sont versionnés, idempotents, auditables, récupérables après interruption et compensables en cas d'échec métier.

## Parcours de référence

Bon de commande → réception → inventaire → facture fournisseur → paiement → comptabilité → tableau de bord.

## Garde-fous

- aucune étape critique sans clé d'idempotence;
- aucune approbation contournable;
- tout événement produit une trace vérifiable;
- reprise et compensation testées;
- contrats inter-modules validés;
- décision finale de fermeture approuvée par une personne.
