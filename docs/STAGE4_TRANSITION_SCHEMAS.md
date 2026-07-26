# Étage 4E — Schémas de transition

## Contrat commun

Toute transition sensible doit valider avant l’ouverture de la transaction :

- une justification non vide et bornée;
- les preuves exigées par la politique du module;
- une clé d’idempotence comprise entre 8 et 200 caractères;
- les champs spécialisés de la commande.

Les erreurs utilisent des codes stables sous `transition.*`, un statut HTTP 400 pour une entrée invalide et des détails ne contenant aucune donnée d’une autre organisation.

## Rejeu

La validation normalise l’entrée et la clé d’idempotence avant leur remise au moteur transactionnel. Le moteur demeure responsable du rejeu atomique et de la restitution du résultat déjà produit.

## Capacités après transition

Une route doit retourner la ressource résultante avec `server-capabilities@1`. L’interface peut ainsi masquer ou désactiver les commandes devenues impossibles sans recalculer les règles métier.

<!-- Synchronisation de la PR après réalignement de sa branche parente. -->
