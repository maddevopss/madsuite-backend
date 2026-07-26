# Étage 5E — Santé et disponibilité

La santé est publiée en trois dimensions distinctes : disponibilité technique, dépendances et fonctionnement métier. Un service HTTP joignable n’est pas déclaré sain si PostgreSQL, la boîte de sortie ou une tâche critique ne fonctionne plus.

Le résumé public n’expose que le nom du contrôle, son état et un code de détail stable. Les chaînes de connexion, jetons, requêtes et données d’organisation sont exclus des diagnostics.
