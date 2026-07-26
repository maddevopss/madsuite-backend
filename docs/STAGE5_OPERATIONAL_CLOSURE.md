# Étage 5H — Fermeture opérationnelle

## Périmètre validé

- migrations et schéma inspectables;
- tâches planifiées inventoriées, bornées et verrouillées;
- reprises progressives et quarantaine traçable;
- événements différés dédupliqués et réconciliables;
- santé technique, dépendances et fonctionnement métier séparés;
- corrélation de bout en bout et masquage des secrets;
- sauvegardes accompagnées d’une preuve de restauration.

## Exercices de panne minimaux

1. indisponibilité PostgreSQL : santé `unavailable`, aucune réponse trompeuse;
2. tâche déjà verrouillée : seconde exécution abandonnée sans doublon;
3. livraison distante en échec : reprise bornée puis quarantaine;
4. événement livré mais accusé perdu : réconciliation sans seconde conséquence métier;
5. sauvegarde inutilisable : échec explicite de l’exercice, aucune déclaration de reprise réussie.

## Seuils initiaux

- tâche critique en retard au-delà de deux fenêtres : alerte;
- événement différé en attente depuis plus de 15 minutes : dégradation;
- quarantaine non traitée après 24 heures : alerte d’exploitation;
- dépendance critique indisponible : alerte immédiate;
- dernier exercice de restauration âgé de plus de 90 jours : non-conformité.

L’Étage 5 est fermé lorsque la chaîne complète permet de détecter, expliquer, contenir et récupérer les pannes principales avec des preuves conservées. Les contrats de ce bloc n’autorisent jamais l’exposition de secrets ni le contournement des politiques d’organisation.
