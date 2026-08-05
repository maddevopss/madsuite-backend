#!/usr/bin/env node
// Issue #171 (Étage 3) PR D — « standardiser les liens aggregate_type /
// aggregate_id ; relier [les modules institutionnels] à des preuves
// versionnées ; vérifier qu'aucun module ne stocke silencieusement une
// preuve non référencée. »
//
// Constat (voir docs/PR-D-EVIDENCE-REFERENCE-STANDARD.md) : 59 tables
// institutionnelles stockent leurs preuves comme une colonne JSONB locale
// ("evidence JSONB"), opaque et non versionnée, plutôt que via le système
// central déjà en place (document_evidence_references, sous
// /api/document-governance/evidence-references — documents gouvernés,
// versionnés, avec rôle de preuve et idempotence). Migrer les 59 tables
// existantes est un chantier à part entière, hors de portée d'un seul
// changement — cette garde ne prétend pas le faire. Son rôle est plus
// modeste et immédiatement utile : empêcher que la dette grossisse en
// silence. Toute NOUVELLE colonne "evidence JSONB" doit être un choix
// délibéré (ajouté à la liste ci-dessous avec une justification en
// commentaire de migration), pas une réintroduction par défaut du même
// raccourci que ce constat documente.
//
// Ne bloque QUE l'ajout de colonnes "evidence JSONB" hors de la liste
// connue. Ne touche à aucun schéma existant.

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(repoRoot, "db", "migrations");

// Baseline gelée au 2026-08-05 (avant cette garde). Toute évolution de
// cette liste doit être volontaire et documentée dans le commit qui la
// modifie — jamais un ajout silencieux.
const KNOWN_LEGACY_EVIDENCE_COLUMNS = new Set([
  "058_core_business_modules.sql",
  "065_madtrust_graph_persistence.sql",
  "072_payroll_periods_inputs.sql",
  "073_hr_transactional_core.sql",
  "074_sst_transactional_core.sql",
  "075_legal_compliance_transactional_core.sql",
  "076_document_proof_transactional_core.sql",
  "077_asset_maintenance_transactional_core.sql",
  "078_procurement_transactional_core.sql",
  "079_quality_transactional_core.sql",
  "080_enterprise_risk_transactional_core.sql",
  "081_enterprise_business_continuity_core.sql",
  "082_cybersecurity_governance_core.sql",
  "083_data_privacy_governance_core.sql",
  "084_internal_audit_core.sql",
  "085_organizational_performance_core.sql",
  "086_organizational_governance_core.sql",
  "087_advanced_financial_management_core.sql",
  "088_facilities_management_core.sql",
  "089_environmental_management_core.sql",
  "090_advanced_document_governance_core.sql",
  "091_external_partner_management_core.sql",
  "093_risk_continuity_links.sql",
  "094_risk_security_privacy_links.sql",
  "098_facilities_maintenance_links.sql",
  "099_procurement_finance_links.sql",
  "100_governance_authority_validations.sql",
  "20260727164000_supplier_invoice_matching.sql",
  "20260727170000_supplier_approvals_payment_batches.sql",
  "20260727173000_supplier_performance_incidents.sql",
  "20260727183000_accounting_close_controls.sql",
  "20260727185000_accounting_consolidation.sql",
  "20260727190000_payroll_remittances.sql",
  "20260727200000_inventory_lot_serial_traceability.sql",
  "20260727201000_inventory_cycle_counts.sql",
  "20260727202000_payroll_approval_controls.sql",
  "20260727203000_inventory_cogs_accounting.sql",
  "20260727203000_payroll_reconciliation_audit.sql",
  "20260727203000_supplier_qualification_risk.sql",
  "20260727204000_procurement_budget_commitments.sql",
  "20260727210000_procurement_returns_nonconformance.sql",
  "20260727213000_decision_risk_alerts.sql",
  "20260727213000_explainable_recommendations.sql",
  "20260727220000_asset_maintenance_complete_block.sql",
  "20260727221500_procurement_complete_block.sql",
  "20260727222000_inventory_complete_block.sql",
  "20260727223000_accounting_complete_block.sql",
  "20260727224500_cognitive_assistance_complete_block.sql",
  "20260727224500_decision_dashboard_complete_block.sql",
  "20260727230000_business_orchestration_closure.sql",
  "20260727231000_observability_closure.sql",
  "20260727232000_systeme_mad_foundation_closure.sql",
  "20260727233000_backend_global_closures.sql",
  "20260727233000_create_controlled_publication_operations.sql",
  "20260727240000_hr_complete_block_closure.sql",
  "20260727241000_sst_complete_block_closure.sql",
  "20260727242000_document_management_complete_block.sql",
  "20260727_1500_create_production_readiness_gates.sql",
  "20260802_sst_emergency_plans.sql",
  "202607280001_public_api_complete_block.sql",
  "202607280002_integration_ecosystem_complete_block.sql",
  "202607280003_saas_platform_complete_block.sql",
  "202607280004_v1_certification_complete_block.sql",
]);

const EVIDENCE_COLUMN_PATTERN = /evidence\s+JSONB/i;

function findMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function main() {
  const files = findMigrationFiles();
  const withEvidenceColumn = files.filter((file) => {
    const source = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    return EVIDENCE_COLUMN_PATTERN.test(source);
  });

  const unknown = withEvidenceColumn.filter((file) => !KNOWN_LEGACY_EVIDENCE_COLUMNS.has(file));
  const missingFromDisk = [...KNOWN_LEGACY_EVIDENCE_COLUMNS].filter((file) => !fs.existsSync(path.join(migrationsDir, file)));

  if (unknown.length > 0) {
    console.error("Nouvelle(s) colonne(s) 'evidence JSONB' non déclarée(s) dans la liste connue (guard-evidence-reference-standard.js):");
    for (const file of unknown) console.error(`  - ${file}`);
    console.error("\nUtiliser document_evidence_references (/api/document-governance/evidence-references) pour toute nouvelle preuve institutionnelle.");
    console.error("Si une colonne JSONB locale reste justifiée, l'ajouter explicitement à KNOWN_LEGACY_EVIDENCE_COLUMNS avec la raison en commentaire.");
    process.exitCode = 1;
    return;
  }

  if (missingFromDisk.length > 0) {
    console.error("Fichier(s) de la liste connue introuvables sur disque (migration renommée/supprimée ?):");
    for (const file of missingFromDisk) console.error(`  - ${file}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Garde preuve/evidence : dette connue et gelée à ${withEvidenceColumn.length} table(s), aucune nouvelle colonne non référencée.`);
}

main();
