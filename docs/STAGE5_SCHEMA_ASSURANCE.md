# Étage 5A — Migrations et validation de schéma

Le démarrage doit inspecter les tables, index, contraintes et politiques attendus après l’exécution ordonnée des migrations.

Le contrat `schema-assurance@1` sépare les écarts réparables automatiquement des écarts bloquants. Une politique d’isolation manquante est bloquante par défaut : le service ne doit jamais démarrer en prétendant être sain lorsqu’une garantie d’organisation est absente.

La validation finale est obligatoire après toute réparation. Les essais doivent couvrir une base vide, une base partielle et un schéma complet.
