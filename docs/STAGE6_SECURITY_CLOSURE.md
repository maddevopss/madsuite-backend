# Étage 6 — Constat de fermeture sécurité

## Périmètre

L’étage couvre les autorisations, l’isolation par organisation, les transitions sensibles, les données protégées, les sessions, la chaîne de construction et les protections contre l’abus.

## Preuves attendues

- aucune route sensible sans rôle explicite;
- aucune référence inter-organisation acceptée;
- aucune auto-approbation ni autorité fournie par le client;
- aucun secret retourné ou journalisé en clair;
- aucun jeton expiré, révoqué ou rejoué accepté;
- aucune dépendance publiée sans identité, résolution et intégrité;
- aucune route coûteuse sans budget réduit;
- campagne transversale verte.

## Risques résiduels

Les contrôles contractuels doivent être reliés progressivement aux inventaires réels de routes, aux données de production et aux rapports périodiques de dépendances. Toute exception doit être documentée, datée, approuvée et assortie d’une échéance.

## Fermeture

L’étage est fermé lorsque les PR 6A à 6H sont fusionnées dans l’ordre et que leurs validations demeurent vertes sur `main`.