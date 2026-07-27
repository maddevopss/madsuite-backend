# Audit de reprise livrable — Bloc comptabilité #310

## Verdict

Le socle actuellement fusionné dans `main` est utile, mais la fermeture précédente était trop large par rapport aux preuves réelles. Le bloc demeure ouvert jusqu'à validation d'un cycle comptable complet, transactionnel, isolé et utilisable depuis l'interface.

## Revue PR par PR

### PR #311 — rapports et exports

Conserve une valeur fonctionnelle réelle : routes de flux de trésorerie, exports CSV du journal et de la balance, service dédié et tests unitaires. Lacunes : aucun export PDF, comparatifs incomplets et validation de traçabilité limitée.

### PR #312 — fondations

Ajoute uniquement un test contractuel. Elle ne livre ni migration, ni route, ni service. Les fondations proviennent de migrations antérieures et doivent être validées en PostgreSQL réel.

### PR #313 — journal en partie double

Ajoute uniquement un test contractuel. Les invariants existent dans `accounting.service.js`, mais la publication doit encore être durcie transactionnellement et validée contre les comptes et périodes de la même organisation.

### PR #314 — réconciliation

Ajoute un service utile de réconciliation et ses tests. Il faut encore le raccorder aux opérations métier réelles et exposer un rapport exploitable.

### PR #315 — intégrations métier

Ajoute uniquement un test de présence de chaînes et de contrats. Cela ne prouve pas qu'une facture, un paiement, une dépense, un fournisseur ou une paie publient réellement une écriture équilibrée et idempotente.

### PR #316 — cycle financier

Ajoute uniquement un scénario contractuel en mémoire. Aucun scénario HTTP/PostgreSQL complet ne prouve facture → paiement → journal → grand livre → états financiers.

### PR #317 — fermeture

Modifie uniquement le document de fermeture. Cette PR ne pouvait pas démontrer que le module était livrable.

### Frontend PR #89

Livre une première page comptable et un client API. La portée doit être élargie pour gérer réellement les comptes, périodes, écritures, publication, contrepassation, grand livre, balance, états financiers et exports.

## Lacunes bloquantes

1. affectation et validation explicites de la période lors de la création d'une écriture;
2. validation que tous les comptes appartiennent à l'organisation et sont actifs;
3. publication transactionnelle avec verrouillage de l'écriture;
4. filtres du grand livre par source, projet, client et fournisseur;
5. comparatifs de périodes pour balance et états financiers;
6. automatisations réelles pour factures, paiements, dépenses, fournisseurs et paie;
7. export PDF contrôlé;
8. interface complète de saisie et de consultation;
9. tests PostgreSQL, multi-organisation et bout en bout;
10. documentation d'exploitation et preuve de migration.

## Règle de fermeture

Aucune fermeture de #310 avant que le scénario complet soit reproductible sur PostgreSQL et depuis l'interface, avec équilibre, idempotence, contrepassation, traçabilité et isolation démontrés.
