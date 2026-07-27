# Bloc B — Cycle comptable complet

Issue : #337

## Résultat attendu

Le cycle de vie des écritures et des périodes est utilisable, contrôlé et auditable.

## Portée obligatoire

- création et modification des brouillons;
- validation des lignes et comptes;
- publication transactionnelle;
- ajustements;
- contrepassations idempotentes;
- correction sans mutation de l’historique;
- clôture de période;
- réouverture motivée et journalisée;
- immutabilité en base des écritures publiées;
- permissions administratives.

## Preuves avant fusion

- tests PostgreSQL des verrous et contraintes;
- tests HTTP pour chaque transition;
- refus des périodes fermées;
- refus des écritures déséquilibrées;
- audit complet des acteurs, dates et motifs.

Cette PR reste en brouillon jusqu’à satisfaction complète.