# Étage 9 — Limites connues et décisions explicites

> Référence : issue #195 — Introduire une intelligence assistée vérifiable  
> Version : 1.0  
> Statut : décision de fermeture proposée par la PR H

## Portée approuvée

Le seul cas d’usage actuellement approuvé est :

- **Identifiant :** `incident-known-error-suggestion`
- **Objet :** suggérer un contournement documenté pour un incident opérationnel;
- **Sources :** erreurs connues de la même organisation, identifiées par le service;
- **Autonomie :** advisory;
- **Risque déclaré :** low;
- **Moteur :** déterministe, sans appel de modèle externe;
- **Activation :** explicite par organisation;
- **Exécution :** impossible sans confirmation humaine d’un administrateur.

Aucun autre cas d’usage n’est considéré comme activé par cette décision.

## Capacités interdites par la portée actuelle

La capacité ne doit pas :

- diagnostiquer une cause réelle;
- prendre une décision métier;
- exécuter une action sans confirmation humaine;
- utiliser une source externe ou une donnée d’une autre organisation;
- transformer une consigne contenue dans une donnée métier en instruction système;
- présenter une hypothèse comme un fait;
- fabriquer une recommandation sans source interne identifiable;
- être utilisée pour une décision médicale, juridique, financière ou de sécurité des personnes.

Toute nouvelle capacité doit recevoir une nouvelle entrée versionnée au registre et une approbation explicite avant activation.

## Limites connues

- La similarité de service ne prouve pas que la cause actuelle est identique à une erreur passée.
- La confiance est une classification déterministe de couverture et de récence; ce n’est pas une probabilité de justesse.
- Les résultats expirent et doivent être régénérés avant une nouvelle décision.
- Le coût est déclaré à zéro uniquement parce que ce cas d’usage n’appelle aucun fournisseur externe.
- Les tests d’abus couvrent l’injection dans les champs reçus comme données; ils ne remplacent pas une campagne de sécurité complète avant l’ajout d’un modèle externe.
- Les seuils de surveillance sont des garde-fous opérationnels, pas une preuve de qualité métier.

## Décisions de fermeture

| Décision | Résultat |
| --- | --- |
| Portée approuvée | `incident-known-error-suggestion` seulement |
| Activation implicite | Interdite |
| Confirmation humaine | Obligatoire avant toute liaison ou transition |
| Provenance | Requise et limitée à la même organisation |
| Évaluation reproductible | 100 % des scénarios de référence requis |
| Injection de consignes | Les données reçues restent des données, jamais une autorité |
| Arrêt contrôlé | Kill-switch disponible et journalisé |
| Modèle externe | Non utilisé; toute intégration future exige une nouvelle revue |
| Limites connues | Documentées dans ce registre |

## Décision d’exploitation

La capacité peut être activée uniquement pour une organisation après décision de son administrateur. La PR H ne crée aucune activation et n’autorise aucune transition automatique. Elle ferme le socle de gouvernance vérifiable de l’Étage 9; toute extension est un nouveau changement versionné.
