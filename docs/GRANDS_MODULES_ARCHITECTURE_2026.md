# Architecture des grands modules MADSuite

## Principes non négociables

1. Toute donnée métier porte `organisation_id` et est protégée par RLS.
2. Une écriture comptable publiée est immuable; toute correction passe par un renversement.
3. Les totaux financiers sont calculés à partir des lignes, jamais saisis comme vérité parallèle.
4. La paie conserve le jeu de règles et la trace complète de chaque calcul.
5. L'inventaire est un journal de mouvements; le stock courant est une vue calculée.
6. Les recommandations cognitives exposent leurs preuves et restent acceptables ou refusables par l'utilisateur.
7. SYSTEME_MAD entre dans l'expérience par des règles vérifiables, une traçabilité et des décisions explicables, pas par du vocabulaire décoratif.

## Séquence de livraison

- Phase A — fondations: schéma, RLS, API, journaux immuables.
- Phase B — comptabilité: plan comptable, journaux, écritures, grand livre, balance, états.
- Phase C — fournisseurs et inventaire: achats, factures fournisseurs, mouvements, seuils.
- Phase D — paie: employés, périodes, règles versionnées, calcul, approbation, écriture comptable.
- Phase E — pilotage: encaissements, dettes, marge, stocks, alertes et tendances.
- Phase F — continuité cognitive: capture de contexte, reprise de tâche, recommandations explicables.

## Phase B maintenant disponible

- plan comptable initial réexécutable sans doublons;
- journaux des ventes, achats, encaissements, décaissements, paie et général;
- périodes comptables ouvertes, fermées ou verrouillées;
- validation stricte de chaque ligne et de l'équilibre débit-crédit;
- grand livre avec solde progressif par compte;
- balance de vérification et premiers états financiers;
- renversement contrôlé d'une écriture publiée;
- protection des lignes et des périodes historiques;
- unicité d'une écriture provenant d'une même opération métier;
- tests unitaires des invariants comptables fondamentaux.

## Règle de promotion MAD

Chaque fonction passe successivement par: hypothèse → prototype → résultat vérifiable → fondation documentée. Une fonction expérimentale ne doit jamais devenir silencieusement une règle institutionnelle.
