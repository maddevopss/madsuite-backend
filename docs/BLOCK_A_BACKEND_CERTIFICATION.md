# Bloc A — Certification backend

## Portée

Cette certification rassemble les preuves déjà dispersées dans le dépôt pour les permissions, les migrations, les transactions, l’isolation entre organisations, les contrats API, les métriques et la reprise après erreur.

## Règle

La garde ne déclare pas le produit parfait. Elle refuse toutefois la certification si une famille de preuves fondamentale disparaît silencieusement.

## Preuves exécutables

- `scripts/guard-block-a-certification.js` produit une matrice PASS/FAIL;
- `src/test/blockA.certification.contract.test.js` intègre la matrice à la suite Jest complète;
- les contrôles réutilisent les gardes, migrations, tests et services de production existants.

## Décision humaine

Une CI verte constitue une preuve technique. La décision finale de certifier demeure humaine, datée et reliée au commit évalué.
