# Architecture des phases E à L — MADSuite

## Statut

Document d’orientation et de mise en œuvre initiale. Les phases E à L prolongent le noyau financier et événementiel des phases A à D sans remplacer les mécanismes existants.

## Principe directeur

Toute capacité nouvelle doit respecter le Contrat Transactionnel MAD (CTMAD) et suivre le Cycle de Vie Transactionnel MAD (CVTM) :

1. intention;
2. validation préalable;
3. exécution atomique;
4. validation postérieure;
5. publication des événements;
6. mise à jour des projections;
7. audit;
8. constat de conformité.

Les couches dérivées ne deviennent jamais la source de vérité. Elles doivent pouvoir être reconstruites à partir des faits métier et du registre d’événements.

---

## Phase E — Moteur transactionnel MAD

### Objectif

Fournir un pipeline commun à toutes les opérations métier significatives.

### Contrat minimal

Une définition transactionnelle déclare :

- un type stable;
- une organisation;
- un acteur;
- une clé d’idempotence lorsque l’opération peut être répétée;
- des validations préalables;
- une fonction d’exécution;
- des validations postérieures;
- les événements attendus;
- les métadonnées d’audit.

### Garanties

- début, validation, exécution et inscription des preuves dans une même transaction SQL lorsque possible;
- annulation complète en cas d’échec;
- identifiant transactionnel et identifiant de corrélation;
- résultat explicite : exécuté, déjà exécuté, refusé ou échoué;
- aucune publication externe avant la validation postérieure.

---

## Phase F — Moteur de politiques métier

### Objectif

Séparer les règles déclaratives de l’orchestration technique.

Une politique décrit :

- les préconditions;
- les invariants;
- les garanties attendues;
- la version de la règle;
- la date d’entrée en vigueur;
- les raisons de refus normalisées.

Les politiques sont enregistrées dans le code et peuvent ensuite être projetées dans un registre consultable. Une transaction conserve la version exacte des politiques évaluées.

---

## Phase G — Vérification continue et MADTrust

### Objectif

Détecter les écarts entre les faits, les écritures, les événements et les projections.

Le moteur de vérification :

- exécute des contrôles déterministes;
- produit des constats immuables;
- calcule un état de confiance explicable;
- n’altère jamais silencieusement les données observées;
- propose une réparation ou un renversement sans l’exécuter automatiquement.

Exemples de contrôles :

- écritures équilibrées;
- source métier reliée à une écriture attendue;
- événement métier présent;
- projection synchronisée;
- chaîne de corrélation complète;
- absence de doublon d’idempotence.

---

## Phase H — Graphe métier explicable

### Objectif

Rendre les relations entre les faits traversables sans remplacer PostgreSQL comme source de vérité.

Le graphe est une projection composée de :

- nœuds : client, projet, temps, facture, paiement, écriture, événement, recommandation;
- relations : appartient à, découle de, règle, produit, renverse, justifie;
- provenance : table, identifiant, événement et transaction d’origine.

Toute réponse issue du graphe doit pouvoir fournir le chemin de justification complet.

---

## Phase I — Continuité cognitive

### Objectif

Préserver le contexte humain avant, pendant et après une transaction ou une interruption.

Le système peut associer à une intention :

- l’objectif courant;
- l’étape atteinte;
- les éléments ouverts;
- la prochaine action proposée;
- les interruptions et reprises;
- le niveau de charge déclaré ou inféré selon des règles transparentes.

Ces données soutiennent l’utilisateur. Elles ne modifient jamais une transaction financière ou juridique sans décision autorisée.

---

## Phase J — Agents MAD

### Objectif

Permettre à des agents spécialisés de préparer, vérifier ou proposer des actions sous contrôle institutionnel.

Un agent :

- agit sous une identité technique explicite;
- possède des permissions minimales;
- prépare une intention transactionnelle;
- fournit sa justification et ses sources;
- ne contourne jamais les politiques métier;
- ne publie pas une transaction sensible sans autorisation explicite;
- laisse une trace complète de ses propositions et décisions.

---

## Phase K — Simulation et prévision

### Objectif

Explorer des scénarios sans modifier la réalité opérationnelle.

Une simulation :

- repose sur un instantané ou une version connue des faits;
- est isolée des tables opérationnelles;
- indique clairement ses hypothèses;
- conserve le moteur, les politiques et les versions utilisés;
- ne peut pas être confondue avec une transaction réelle;
- peut être promue en intention réelle uniquement par une nouvelle validation complète.

---

## Phase L — Mémoire institutionnelle

### Objectif

Conserver les raisons, décisions, changements de politiques et enseignements qui expliquent l’évolution du système.

La mémoire institutionnelle relie :

- une décision;
- son contexte;
- les preuves disponibles;
- les politiques concernées;
- les transactions et événements touchés;
- les conséquences observées;
- les révisions futures.

Elle ne réécrit pas le passé. Une correction est une nouvelle entrée reliée à celle qu’elle complète ou remplace.

---

## Ordre de livraison

### Socle immédiat

1. moteur transactionnel et registre de politiques;
2. constats de vérification;
3. projection du graphe métier;
4. enveloppes de contexte cognitif et d’agent;
5. espaces de simulation;
6. mémoire institutionnelle.

### Intégration progressive

Les flux existants sont migrés un à un vers le moteur transactionnel. Aucun basculement global n’est exigé avant que les tests de parité démontrent que les garanties actuelles sont préservées.

## Hors portée de cette première livraison

- exécution autonome d’actions financières par un agent;
- décision automatique fondée sur un score cognitif;
- base de données graphe distincte;
- certification externe CTMAD;
- correction automatique des anomalies détectées.

## Critère de réussite

La première livraison est réussie lorsque le dépôt possède des contrats exécutables et testables pour E à L, que les nouveaux composants sont isolés, et qu’au moins un flux métier existant peut être migré sans perdre l’atomicité, la traçabilité, l’idempotence ni la reconstructibilité.