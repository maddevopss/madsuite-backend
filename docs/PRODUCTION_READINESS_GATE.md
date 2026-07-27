# Porte de préparation à la mise en production

## Intention

Empêcher qu'une version de MADSuite soit publiée uniquement parce que les tests unitaires sont verts. La publication exige aussi des preuves de configuration, de migration, de santé, d'isolation, de sauvegarde, de restauration, de retour arrière et de surveillance.

## Conditions obligatoires

1. Configuration de production validée.
2. Migrations exécutées et vérifiées.
3. Vérifications de santé réussies.
4. Isolation entre organisations démontrée.
5. Sauvegarde et restauration testées.
6. Retour arrière vérifié.
7. Surveillance et alertes prêtes.
8. Aucun constat critique non résolu.
9. Preuves conservées.
10. Approbation humaine explicite.

## Autorité

Les contrôles automatisés rassemblent et évaluent les preuves. Ils ne donnent jamais seuls l'autorisation finale de publier. Cette décision demeure humaine, attribuée et auditée.

## Résultat attendu

Une version n'est déclarée prête que lorsque toutes les conditions sont vraies pour la même référence de publication et la même organisation.
