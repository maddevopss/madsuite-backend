# Étage 5B — Registre des tâches planifiées

Chaque tâche périodique déclare un nom stable, un propriétaire, une fréquence, une clé de verrou distribué et un délai maximal. Le registre refuse les noms ou verrous en double.

Une exécution doit acquérir son verrou avant le travail, respecter son échéance et consigner son résultat. Une seconde instance qui ne peut pas obtenir le verrou quitte sans exécuter le travail en double.
