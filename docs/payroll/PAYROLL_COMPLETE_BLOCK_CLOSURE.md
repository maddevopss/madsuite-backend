# Bloc Paie complet — critères de fermeture

## Objectif

Livrer un cycle de paie exploitable de bout en bout, multi-entreprise, vérifiable et relié à la comptabilité. Le bloc n'est pas considéré terminé par la seule présence de tables ou de services isolés.

## Parcours obligatoire

1. Créer et maintenir le dossier d'un employé.
2. Créer, approuver et activer ses conditions d'emploi.
3. Ouvrir une période de paie.
4. Importer ou saisir les heures, congés, primes, commissions, avantages et ajustements.
5. Sélectionner un jeu de règles versionné et actif.
6. Calculer le brut, les retenues, les cotisations employeur et le net.
7. Produire une trace de calcul par employé.
8. Faire approuver le traitement par une personne autorisée distincte lorsque requis.
9. Verrouiller les entrées et empêcher les modifications silencieuses.
10. Produire les talons de paie et le registre de paie.
11. Préparer les écritures comptables équilibrées et idempotentes.
12. Marquer le paiement, préparer les dépôts directs et les remises.
13. Réconcilier le traitement, conserver les écarts et les preuves.
14. Fermer la période avec un journal d'audit complet.

## Composants couverts

- employés et historique de rémunération;
- contrats et conditions d'emploi;
- périodes et entrées variables;
- jeux de règles versionnés;
- calcul transactionnel;
- approbation et séparation des responsabilités;
- verrouillage et immutabilité;
- talons, registre et empreintes documentaires;
- comptabilisation;
- dépôts directs;
- remises gouvernementales;
- vacances et indemnités;
- cessation d'emploi et relevé d'emploi;
- feuillets de fin d'année;
- réconciliation et audit;
- isolation RLS par organisation.

## Conditions de production

Le bloc est fermé uniquement lorsque :

- les migrations s'appliquent sur une base vide et une base existante;
- toutes les tables sensibles utilisent l'isolation par organisation;
- l'API couvre le parcours complet;
- les transitions invalides sont refusées;
- les traitements approuvés ou payés ne peuvent plus être réécrits;
- les calculs et documents sont reproductibles à partir des preuves conservées;
- les écritures comptables sont équilibrées et protégées contre les doublons;
- les tests unitaires, d'intégration, de sécurité et de contrat sont verts;
- la documentation décrit les entrées, sorties, erreurs et responsabilités.

## Principe MAD

La paie ne doit jamais produire un montant opaque. Chaque résultat doit pouvoir être expliqué par les données sources, la version des règles, les décisions humaines et la trace de calcul conservée.
