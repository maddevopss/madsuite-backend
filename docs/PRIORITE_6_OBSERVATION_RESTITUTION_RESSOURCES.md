# Priorité 6 — Observation de la restitution des ressources

## Intention

Traduire dans MADSuite les travaux de SYSTEME_MAD sur la restitution des ressources, sans transformer une hypothèse émergente en promesse commerciale ou en score absolu.

Ce contrat ne certifie aucun bénéfice. Il définit comment recueillir des observations utiles, minimales, explicables et révocables.

## Principes

- aucune affirmation de gain sans situation de référence;
- distinction entre gain brut, coûts créés, coûts déplacés et bilan net;
- distinction entre mesure observée, estimation, déclaration utilisateur et inférence;
- aucune note globale obligatoire;
- aucune comparaison publique entre personnes ou organisations;
- consentement et contrôle humain;
- minimisation des données;
- possibilité de désactiver la collecte;
- conservation des résultats neutres ou négatifs;
- versionnement de toute méthode de calcul.

## Dimensions candidates

### Temps

Observations possibles :

- durée d’un parcours;
- temps de reprise après interruption;
- temps de vérification;
- temps de correction;
- étapes manuelles évitées;
- temps déplacé vers une autre personne ou un autre moment.

Le « temps économisé » ne doit jamais être déduit uniquement du nombre de clics évités.

### Attention

Observations possibles :

- interruptions produites par le système;
- alertes ignorées;
- sollicitations regroupées;
- changements de contexte;
- reprises abandonnées;
- notifications désactivées.

### Charge cognitive

Observations possibles :

- nombre d’éléments ouverts;
- nombre de décisions simultanées;
- erreurs de séquence;
- retours en arrière;
- besoin d’aide;
- difficulté déclarée par la personne.

Aucun diagnostic médical ou psychologique ne peut être inféré.

### Confiance

Observations possibles :

- provenance consultée;
- explication ouverte;
- recommandation acceptée, refusée ou modifiée;
- correction après acceptation;
- écart entre confiance annoncée et résultat observé;
- confiance déclarée par la personne.

L’acceptation d’une recommandation n’est pas une preuve de confiance justifiée.

### Autonomie

Observations possibles :

- décision humaine conservée;
- capacité de refuser;
- capacité de modifier;
- capacité de comprendre la source;
- recours à une correction manuelle;
- dépendance à une fonction indisponible.

## Événements minimaux proposés

Chaque événement d’observation devrait contenir :

- `organisation_id`;
- `actor_id` pseudonymisable;
- `session_id`;
- `module`;
- `journey_type`;
- `entity_type` et `entity_id` lorsque nécessaires;
- `event_type`;
- `observed_at`;
- `method_version`;
- `evidence_level`;
- `measurement_kind` : observed, estimated, self_reported ou inferred;
- `value` et `unit` lorsque mesurables;
- `baseline_reference` lorsque requise;
- `source_event_id`;
- `consent_scope`;
- `metadata` limitée et filtrée.

## Événements candidats

- `journey.started`;
- `journey.completed`;
- `journey.abandoned`;
- `context.saved`;
- `context.resumed`;
- `context.corrected`;
- `context.stale`;
- `recommendation.presented`;
- `recommendation.accepted`;
- `recommendation.rejected`;
- `recommendation.modified`;
- `recommendation.corrected_after_use`;
- `evidence.opened`;
- `explanation.opened`;
- `notification.presented`;
- `notification.dismissed`;
- `error.prevented` seulement lorsqu’un contrefactuel vérifiable existe;
- `user.resource_feedback`.

## Méthode de bilan

Pour une dimension donnée :

1. définir la situation de référence;
2. observer le parcours avec MADSuite;
3. identifier les gains possibles;
4. identifier les coûts créés;
5. identifier les coûts déplacés;
6. documenter les inconnues;
7. produire un résultat par dimension;
8. conserver le niveau de preuve;
9. interdire l’agrégation lorsque les dimensions sont incompatibles ou incomplètes.

## Niveaux de preuve proposés

- `E0` : hypothèse sans observation;
- `E1` : déclaration subjective isolée;
- `E2` : observation instrumentée sans groupe ou référence robuste;
- `E3` : comparaison répétée avec référence explicite;
- `E4` : protocole évalué et reproduit;
- `E5` : résultat suffisamment robuste pour une affirmation encadrée.

Ces niveaux sont provisoires et doivent rester alignés avec SYSTEME_MAD.

## Protection contre les faux gains

Le système doit signaler :

- temps gagné mais vérification accrue;
- automatisation rapide mais correction fréquente;
- réduction des étapes au prix d’une perte de compréhension;
- alertes évitées mais risque masqué;
- confiance déclarée sans provenance;
- dépendance accrue;
- bénéfice pour l’organisation obtenu par transfert de charge vers l’employé ou le client.

## Restitution à la personne

Les observations doivent être rendues accessibles à la personne concernée sous une forme compréhensible :

- ce qui a été mesuré;
- comment;
- pourquoi;
- avec quelles limites;
- pendant quelle période;
- comment corriger ou contester;
- comment désactiver la collecte.

## Critères d’implantation

Avant toute collecte en production :

- revue de confidentialité;
- analyse de minimisation;
- politique de conservation;
- tests d’isolation;
- documentation de la méthode;
- version du calcul;
- scénario de suppression ou anonymisation;
- validation humaine;
- interdiction d’usage disciplinaire ou de classement individuel.

## Porte de fermeture

La priorité 6 est fermée lorsqu’un pilote volontaire mesure au moins le temps de reprise et une seconde dimension, conserve les coûts créés et déplacés, affiche les limites à la personne, produit des résultats neutres ou négatifs sans les masquer et ne formule aucune affirmation dépassant son niveau de preuve.