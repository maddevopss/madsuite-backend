# Bloc A — Jeux de règles et cycle exploitable

Ce bloc part de `main` et ferme le premier écart structurel du module Paie.

## Contrat cible

- activation atomique d’un jeu de règles;
- un seul jeu actif applicable par organisation, province et date;
- création idempotente d’un cycle à partir d’une période existante;
- lien durable entre `payroll_periods` et `payroll_runs`;
- refus d’un doublon de cycle non annulé;
- sélection du jeu actif applicable à la date de paie;
- isolation par `organisation_id`;
- aucune règle fiscale réelle inventée.

## Endpoints

- `POST /api/payroll/rulesets/:id/activate`
- `POST /api/payroll/periods/:id/runs`

## Preuves exigées

- tests de service;
- contrats HTTP;
- PostgreSQL réel;
- idempotence;
- concurrence;
- organisation B incapable d’utiliser les objets de A.
