'use strict';

const REQUIRED_BLOCKS = Object.freeze([
  'human_resources',
  'health_and_safety',
  'documents_and_evidence',
  'asset_maintenance',
  'procurement',
  'inventory',
  'accounting',
  'decision_dashboard',
  'cognitive_assistance',
  'business_orchestration',
  'observability',
  'systeme_mad_foundation',
]);

function evaluateBackendGlobalClosure(input = {}) {
  const blockStatus = input.blockStatus || {};
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const unresolvedDependencies = Array.isArray(input.unresolvedDependencies)
    ? input.unresolvedDependencies
    : [];

  const missingBlocks = REQUIRED_BLOCKS.filter(
    (block) => blockStatus[block] !== 'closed'
  );

  const reasons = [];
  if (missingBlocks.length > 0) reasons.push('required_blocks_not_closed');
  if (unresolvedDependencies.length > 0) reasons.push('unresolved_dependencies');
  if (evidence.length === 0) reasons.push('missing_evidence');
  if (input.humanApproved !== true) reasons.push('missing_human_approval');
  if (input.migrationsValidated !== true) reasons.push('migrations_not_validated');
  if (input.securityValidated !== true) reasons.push('security_not_validated');
  if (input.contractTestsValidated !== true) reasons.push('contract_tests_not_validated');

  return {
    closable: reasons.length === 0,
    reasons,
    missingBlocks,
    requiredBlocks: REQUIRED_BLOCKS,
  };
}

module.exports = {
  REQUIRED_BLOCKS,
  evaluateBackendGlobalClosure,
};
