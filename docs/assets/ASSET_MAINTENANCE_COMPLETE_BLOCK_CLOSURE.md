# Fermeture du bloc Maintenance

## Intention

Le bloc Maintenance est considéré complet uniquement lorsqu’un bien peut être suivi depuis son registre jusqu’à sa remise en service, avec une preuve suffisante de chaque décision.

## Parcours couvert

1. Enregistrer le bien, son emplacement, son état et sa garantie.
2. Définir les entretiens préventifs selon une date ou un niveau d’usage.
3. Recevoir et prioriser une demande d’intervention.
4. Créer et assigner un bon de travail à une personne ou à un fournisseur.
5. Documenter le diagnostic, les travaux, le temps et les pièces.
6. Conserver les coûts de main-d’œuvre, de pièces et de services externes.
7. Maintenir hors service tout bien non sécuritaire.
8. Exiger une inspection de remise en service avec preuve.
9. Fermer seulement un bon vérifié, documenté et traçable.
10. Produire les alertes d’entretien, de retard, de garantie et d’indisponibilité.

## Règles de fermeture

Un bon de travail ne peut pas être fermé lorsque :

- son état n’est pas `verified`;
- le diagnostic ou la résolution manque;
- aucune preuve de travaux n’est jointe;
- aucune vérification de remise en service n’existe;
- le bien est déclaré non sécuritaire;
- des coûts de pièces existent sans trace des pièces;
- des coûts de main-d’œuvre existent sans trace du temps.

## Intégrations

- **Installations** : emplacement, responsabilité et transfert du bien.
- **Inventaire** : pièces consommées et mouvements de stock.
- **Fournisseurs** : travaux externes, pièces et garanties.
- **Comptabilité** : coûts internes, externes et immobilisations.
- **Santé et sécurité** : biens dangereux, inspections et preuves.
- **Documents** : rapports, photos, certificats et manuels.

## Critères techniques

- isolation RLS par organisation;
- idempotence des demandes et bons de travail;
- historique des changements d’état;
- preuve obligatoire pour la fermeture;
- tests de contrat transversaux;
- migrations applicables sur une base existante;
- CI et gardes GitHub vertes.
