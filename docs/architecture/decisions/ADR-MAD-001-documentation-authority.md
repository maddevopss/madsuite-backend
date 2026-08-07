# ADR-MAD-001 — Autorité documentaire institutionnelle

- **Version :** 1.0.0
- **Statut :** active
- **Propriétaire :** gouvernance MAD
- **Date d’adoption :** 2026-08-07
- **Prochaine révision :** 2026-11-07
- **Portée :** documentation et décisions structurantes du backend

## Contexte et faits observables

Le README du backend désigne `maddevopss/SYSTEME_MAD` comme source de vérité documentaire et demande de consulter ses documents officiels avant toute décision structurante.

## Décision

Les décisions d’architecture du backend doivent rester compatibles avec `maddevopss/SYSTEME_MAD`. Le backend conserve uniquement les détails d’implémentation et les preuves propres à son dépôt.

## Alternatives écartées

- définir une gouvernance indépendante dans le backend : rejetée, car elle créerait une autorité parallèle;
- recopier intégralement SYSTEME_MAD : rejetée, car la copie deviendrait rapidement divergente.

## Conséquences

- les décisions structurantes doivent référencer l’autorité MAD;
- le backend peut documenter ses preuves sans remplacer le dépôt institutionnel;
- une divergence doit être traitée comme un risque de gouvernance.

## Preuves

- `README.md`, section « Source de vérité documentaire »;
- `docs/PLAN_MAITRE_ETAGES_8_A_12.md`;
- issue #199, PR A.

## Remplacement

Aucune.
