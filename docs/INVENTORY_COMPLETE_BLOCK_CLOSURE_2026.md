# Fermeture du bloc Inventaire complet

## Statut

Bloc métier fermé pour revue et validation CI.

## Portée couverte

Le bloc Inventaire couvre maintenant le registre des articles et emplacements, les entrées, sorties, ajustements et transferts, la valorisation, les seuils de réapprovisionnement, les réservations, les lots et numéros de série, les dates d’expiration, les inventaires physiques, les écarts, les preuves et la fermeture contrôlée.

## Parcours de bout en bout

1. Un article est créé et associé à un ou plusieurs emplacements.
2. Les mouvements modifient les quantités et la valeur de façon traçable et idempotente.
3. Une réservation réduit la quantité réellement disponible sans modifier artificiellement le stock physique.
4. Les lots permettent de suivre les expirations, quarantaines et dispositions.
5. Un inventaire physique compare les quantités attendues et comptées.
6. Tout écart exige une raison et une preuve avant approbation.
7. Les ajustements approuvés peuvent ensuite être comptabilisés par les mécanismes transactionnels existants.
8. La fermeture est refusée tant qu’un inventaire physique demeure non résolu, qu’un solde est négatif ou qu’un lot expiré reste disponible.

## Garde-fous

- isolation RLS par organisation;
- clés d’idempotence;
- quantités non négatives;
- réservation interdite au-delà de la disponibilité;
- preuve obligatoire pour les réservations et décisions sensibles;
- approbation distincte des écarts d’inventaire;
- justification obligatoire pour les quarantaines et dispositions;
- historique des changements d’état;
- alertes sur lots expirés, lots à échéance, réservations périmées et inventaires non résolus.

## Intégrations prévues

- achats et réceptions fournisseurs;
- maintenance et consommation de pièces;
- comptabilité et valorisation des stocks;
- documents et preuves;
- tableaux de bord décisionnels.

## Règle de fermeture

Le bloc ne peut être déclaré cohérent tant qu’il existe une quantité négative, un inventaire physique non résolu ou un lot expiré encore déclaré disponible. Une preuve explicite est exigée pour la validation finale.
