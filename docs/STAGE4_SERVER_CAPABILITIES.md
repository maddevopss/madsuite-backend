# Étage 4C — Capacités calculées côté serveur

## Contrat

Les réponses de listes et de ressources peuvent inclure `meta.contract = server-capabilities@1` ainsi qu’une propriété `meta.capabilities`.

Chaque action (`read`, `create`, `update`, `approve`, `close`) expose :

- `allowed` : décision serveur;
- `reason` : code stable et message lorsque l’action est indisponible.

## Règles initiales

- lecture et création accessibles aux membres authentifiés;
- modification et fermeture réservées aux gestionnaires et rôles supérieurs;
- approbation réservée aux administrateurs et rôles supérieurs;
- auto-approbation refusée;
- modification refusée après un état final;
- une politique de module peut désactiver explicitement une action.

Le frontend utilise ces capacités pour présenter l’interface, mais le serveur continue d’appliquer ses gardes et politiques lors de chaque commande. Une capacité positive n’est jamais un jeton d’autorisation réutilisable.

<!-- Relance CI après réalignement de la branche sur main. -->
