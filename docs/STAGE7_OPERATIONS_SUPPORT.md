# Étage 7H — Exploitation et soutien

## Incidents fréquents

- migration incomplète : bloquer le démarrage, inspecter puis réparer seulement les écarts autorisés;
- tâche planifiée en retard : vérifier le verrou, la dernière exécution et la quarantaine;
- événements non livrés : examiner la boîte de sortie, les tentatives et la déduplication;
- erreur interorganisation : suspendre l’action, conserver les preuves et escalader immédiatement;
- hausse de latence : comparer pagination, synthèses, base de données et taux d’erreur.

## Responsabilités

L’exploitation constate et contient. Le responsable du module qualifie l’impact métier. La sécurité traite toute suspicion d’isolement ou de compromission. La personne autorisant la mise en service accepte explicitement les risques résiduels.

## Escalade

Critique : indisponibilité, fuite possible ou corruption — intervention immédiate et gel des changements. Majeur : fonctionnalité essentielle dégradée — traitement prioritaire. Mineur : contournement sûr disponible — inscription au registre et planification.

## Limites connues

Les seuils initiaux doivent être recalibrés à partir de mesures réelles. Les exercices destructifs demeurent interdits en production. Une sauvegarde n’est considérée valide qu’après restauration vérifiée.
