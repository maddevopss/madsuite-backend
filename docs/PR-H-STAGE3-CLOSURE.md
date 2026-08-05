# PR H — Fermeture de l'Étage 3 (issue #171)

« Intégrer les modules entre eux sans perdre leurs responsabilités. »

## Matrice des propriétaires de données

| Domaine | Source de vérité | Table(s) | Lien(s) intermodule | Propriétaire des données |
|---|---|---|---|---|
| Risques d'entreprise | `enterprise_risk` | `enterprise_risks` | référencé par PR A, B | Module risque |
| Continuité d'activité | `business_continuity` | `enterprise_business_processes`, `enterprise_continuity_plans` | `enterprise_risk_continuity_links` (PR A) | Module continuité |
| Cybersécurité | — | `cybersecurity_vulnerabilities`, `cybersecurity_incidents` | `institutional_risk_links`, `audit_corrective_action_links` (PR B, E) | Module cybersécurité |
| Vie privée | — | `privacy_incidents`, `privacy_retention_actions` | `institutional_risk_links`, `audit_corrective_action_links` (PR B, E) | Module vie privée |
| Gouvernance transversale | noyau de gouvernance | `governance_cases/commands/approvals/events` | `governanceOrchestrator` + 8 évaluateurs de domaine (PR C, #742) | Module gouvernance |
| Documents / preuves | `document_evidence_references` (nouveau standard) | `governed_documents`, `governed_document_versions`, `document_evidence_references` | tout module institutionnel désormais orienté vers ce standard (PR D, #743) ; `document_records`/`document_links` reste un dépôt général distinct, non déprécié | Module gouvernance documentaire |
| Audit interne | `internal_audit` | `internal_audit_findings` | `audit_corrective_action_links` (PR E) | Module audit — **vérificateur indépendant, jamais propriétaire des cibles qu'il lie** (prouvé par test e2e, voir plus bas) |
| Installations / actifs | — | `facilities_*` | `facilities-maintenance-links` (PR F) | Module installations |
| Finance / comptabilité / achats | `accounting` | `accounting_*`, `supplier_*`, `procurement_*` | `supplier-bill-lifecycle`, `supplierAccounting`, `procurement-budget-commitment`, `accounting-budget-variance` (PR G) | Module comptabilité |

Aucune duplication de source de vérité constatée dans les tables auditées : chaque table de liaison référence deux enregistrements par identifiant (`risk_id`/`target_id`, `finding_id`/`target_id`, etc.) sans copier leurs champs.

## Tests de références cassées et d'isolation interorganisation

Les tests contractuels existants (`institutional-risk-links.contract.test.js`, `risk-continuity-links.contract.test.js`, `audit-corrective-action-links.contract.test.js`) ne lisaient que le texte source. `src/test/institutionalLinkRoutes.evidence.e2e.test.js` (nouveau) exécute les 3 routes de liaison contre une vraie base PostgreSQL et prouve, pour chacune :

- une référence source inexistante est refusée (404) ;
- une cible appartenant à une autre organisation est refusée (404) — preuve directe d'isolation interorganisation, pas seulement de la présence d'un `WHERE organisation_id`;
- le chemin heureux persiste correctement et **est réellement idempotent** (une relance avec la même clé ne provoque plus d'erreur de contrainte d'unicité).

**Bug trouvé et corrigé pendant l'écriture de cette preuve** : les trois routes (`institutional-risk-links`, `risk-continuity-links`, `audit-corrective-action-links`) déclaraient une clé d'idempotence obligatoire mais ne géraient pas réellement une relance — l'`INSERT` échouait sur la contrainte d'unicité métier (ex. `institutional_risk_links_organisation_id_risk_id_target_typ_key`) au lieu de renvoyer l'enregistrement existant. Corrigé par `ON CONFLICT (organisation_id, idempotency_key) DO NOTHING` + repli `SELECT`, motif déjà utilisé ailleurs dans le repo (`document-proof.routes.js`). Aucun test contractuel existant n'aurait détecté ce bug — seule l'exécution réelle contre PostgreSQL le pouvait.

## Constat des frontières intermodules

- **PR A, B, E, F, G** : implémentés, testés contractuellement, et désormais aussi testés en exécution réelle (références cassées, isolation, idempotence) pour A/B/E.
- **PR C** : noyau de gouvernance réparé (bug de type UUID/INTEGER, #742) et testé (56 tests), non encore branché dans un flux métier réel — décision volontaire pour ne pas risquer une régression sur la paie (#363) tout juste fermée.
- **PR D** : décision tranchée (#743) — `document_evidence_references` devient le standard, `document_links` reste un module distinct, 63 colonnes `evidence JSONB` legacy gelées et surveillées par `guard-evidence-reference-standard.js`.

## Critère de fermeture (texte de l'issue)

> « L'Étage 3 est terminé lorsque chaque relation intermodule critique possède une source de vérité déclarée, une liaison testée et aucune duplication silencieuse. »

Satisfait pour les relations couvertes par PR A, B, C, D, E, F, G ci-dessus. Non couvert : migration des 63 tables `evidence JSONB` legacy vers le standard PR D (hors de portée, suivi par la garde CI plutôt que résolu ici).
