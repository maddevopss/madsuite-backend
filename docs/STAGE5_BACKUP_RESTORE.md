# Étage 5G — Sauvegarde et restauration

## Objectifs

- objectif de point de reprise : 24 heures au maximum;
- objectif de temps de reprise : 4 heures au maximum pour un incident majeur;
- sauvegardes chiffrées, hors du serveur applicatif et accompagnées d’une somme de contrôle;
- exercice de restauration au moins trimestriel et après toute modification majeure du schéma.

## Exercice obligatoire

1. sélectionner une sauvegarde et valider son manifeste;
2. restaurer dans une base isolée;
3. exécuter la validation complète du schéma;
4. comparer les volumes essentiels;
5. exécuter les vérifications applicatives minimales;
6. conserver la preuve `restore-evidence@1`, sa durée, ses résultats et les écarts observés.

Une sauvegarde n’est considérée fiable qu’après une restauration vérifiée. La simple présence d’un fichier ne constitue pas une preuve de reprise.
