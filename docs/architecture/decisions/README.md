# Registre des décisions d’architecture

> **Étage :** 12 — évolution continue et transmission  
> **Bloc :** PR A — registre des décisions d’architecture  
> **Version du registre :** 1.0.0  
> **Statut :** actif  
> **Autorité :** `maddevopss/SYSTEME_MAD`

Ce registre recense les décisions structurantes retenues pour le backend. Il ne crée aucune nouvelle capacité : chaque entrée doit être rattachée à une preuve existante et révisée lorsqu’une décision est remplacée.

## Règles du registre

- Une décision possède un identifiant stable et une version.
- Les faits observables, la décision et les hypothèses sont séparés.
- Une décision remplacée reste conservée pour la traçabilité.
- Toute décision touchant l’isolation, la sécurité, les données ou la gouvernance doit référencer ses preuves.
- Une modification substantielle exige une nouvelle version ou une nouvelle décision; l’historique n’est jamais réécrit.
- Le propriétaire et la date de révision doivent être explicites.

## Schéma obligatoire

Chaque entrée doit contenir :

| Champ | Exigence |
| --- | --- |
| ID / version | Identifiant stable, version sémantique |
| Statut | proposée, active, remplacée ou retirée |
| Propriétaire | Rôle responsable de la révision |
| Date / prochaine révision | Dates ISO 8601 |
| Contexte | Problème et faits observables |
| Décision | Choix retenu, formulé impérativement |
| Alternatives | Options écartées et raison |
| Conséquences | Gains, coûts et risques |
| Preuves | Fichiers, tests, migrations ou décisions SYSTEME_MAD |
| Remplacement | ID/version de la décision successeur, si applicable |

## Inventaire initial

| ID | Version | Statut | Décision |
| --- | --- | --- | --- |
| ADR-MAD-001 | 1.0.0 | active | SYSTEME_MAD demeure l’autorité documentaire institutionnelle du backend. |
| ADR-MAD-002 | 1.0.0 | active | Les données organisationnelles sont isolées par contexte applicatif et RLS forcée. |
| ADR-MAD-003 | 1.0.0 | active | L’assistance IA approuvée reste déterministe, advisory et soumise à confirmation humaine. |
| ADR-MAD-004 | 1.0.0 | active | Une intégration externe ne devient jamais source de vérité sans décision explicite. |

Les fiches détaillées sont conservées dans ce répertoire. Toute entrée dont la preuve n’est pas encore retrouvée doit être marquée `proposée`, jamais présentée comme certifiée.

## Révision

La prochaine révision doit vérifier chaque preuve contre `main`, puis rattacher les décisions aux modules, risques et validations concernés.
