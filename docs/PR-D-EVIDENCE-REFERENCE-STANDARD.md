# PR D — Standard de référencement des preuves institutionnelles

Issue #171 (Étage 3), PR D : « standardiser les liens `aggregate_type`/`aggregate_id` ; relier politiques, contrats, audits, incidents, actifs et décisions à des preuves versionnées ; vérifier qu'aucun module ne stocke silencieusement une preuve non référencée. »

Décision tranchée le 2026-08-05, sans revue humaine préalable (autorisé explicitement par le propriétaire du dépôt — « on verra demain »). À revalider en revue.

## Constat

Deux systèmes de liaison document/preuve coexistent, tous deux montés et actifs :

| | `document_records` / `document_versions` / `document_links` | `governed_documents` / `governed_document_versions` / `document_evidence_references` |
|---|---|---|
| Module | `document_proof` (`/api/documents`) | `advanced_document_governance` (`/api/document-governance`) |
| `aggregate_id` | `TEXT` | `BIGINT` |
| Idempotence | non | oui (`idempotency_key`, `executeTransaction`) |
| Rôle de preuve | non (relation libre : `evidence_for`, etc.) | oui (`evidence_role`) |
| Versionné | oui (`document_versions`) | oui (`governed_document_versions`) |
| Tests | 2 fichiers | 3 fichiers |

Aucun des deux ne référence l'autre. Rien dans le code ou les migrations n'explique l'intention.

Constat plus large, et plus important : **63 tables institutionnelles** (audit, risque, continuité, cybersécurité, vie privée, paie, RH, SST, achats, fournisseurs, comptabilité, qualité, environnement, gouvernance organisationnelle, etc. — voir `scripts/guard-evidence-reference-standard.js` pour la liste complète) stockent leurs preuves comme une colonne `evidence JSONB` **locale et opaque**, sans passer par aucun des deux systèmes centraux. C'est la vraie lacune que cette PR décrit : la plupart des preuves institutionnelles ne sont pas gouvernées du tout, quel que soit le système choisi.

## Décision

1. **`document_evidence_references` (sous `/api/document-governance/evidence-references`) est le standard** pour toute nouvelle preuve institutionnelle attachée à une décision, un contrôle ou une transition sensible (audit, incident, risque, conformité, décision de gouvernance). Raisons : idempotent, versionné via `governed_document_versions`, porte un `evidence_role` explicite, déjà branché sur `executeTransaction`. C'est la forme la plus proche de ce que PR D demande explicitement.
2. **`document_links` / `document_proof` reste tel quel**, non déprécié. Ce n'est pas un doublon accidentel mais un module distinct : dépôt documentaire général (n'importe quel document lié à n'importe quel objet, sans notion de preuve gouvernée). Conservé pour son usage actuel, non recommandé comme modèle pour une nouvelle intégration de preuve.
3. **`aggregate_id BIGINT`** est le type standard pour toute nouvelle table de liaison institutionnelle (déjà la convention majoritaire : `institutional_risk_links`, `risk_continuity_links`, `audit_corrective_action_links`, `document_evidence_references`). `document_links.aggregate_id TEXT` est un écart connu, conservé sans modification — le convertir en `BIGINT` toucherait un module en production sans preuve que ses valeurs stockées sont bien numériques ; hors de portée d'une décision d'architecture prise sans revue.
4. **Les 63 colonnes `evidence JSONB` existantes ne sont pas migrées ce soir.** C'est un chantier propre, module par module, qui dépasse largement une PR — le documenter et le figer est le contenu réaliste de cette PR D. `scripts/guard-evidence-reference-standard.js` (branché dans `npm run check:backend`) gèle la liste actuelle : toute **nouvelle** colonne `evidence JSONB` hors de cette liste fait échouer la vérification, forçant un choix délibéré (utiliser `document_evidence_references`, ou justifier l'exception) plutôt qu'une reconduction par défaut.

## Prochaine étape (non faite ici)

Migrer les modules à plus fort enjeu (audit interne, risque d'entreprise, cybersécurité, vie privée) de leur colonne `evidence JSONB` locale vers `document_evidence_references`, un module à la fois, avec preuve de non-régression pour chacun. Candidat naturel pour une PR I dédiée si l'étage est repris.
