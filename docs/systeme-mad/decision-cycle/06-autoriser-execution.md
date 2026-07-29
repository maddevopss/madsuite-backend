# Étape 6 — Autoriser l’exécution

## Intention

Transformer une décision humaine valide en action autorisée, sans confondre décision et exécution.

## Données minimales

- décision source et version;
- personne autorisant l’exécution;
- exécutant prévu;
- périmètre exact;
- paramètres et limites;
- date de début et échéance;
- préconditions;
- plan de retour arrière;
- conditions d’arrêt;
- identifiant d’idempotence.

## Règles

- refuser toute décision expirée, remplacée ou incomplète;
- vérifier les approbations et permissions avant l’action;
- empêcher une exécution hors périmètre;
- journaliser chaque tentative et son résultat;
- suspendre automatiquement si une condition d’arrêt devient vraie.

## Sortie

Une autorisation d’exécution limitée, traçable et révocable.