'use strict';

const REQUIRED_CONTROLS = Object.freeze([
  'process_definition_versioned',
  'steps_idempotent',
  'approvals_enforced',
  'events_audited',
  'recovery_tested',
  'compensation_tested',
  'cross_module_contracts_verified',
]);

function evaluateBusinessOrchestrationClosure(input = {}) {
  const controls = input.controls || {};
  const failedControls = REQUIRED_CONTROLS.filter((key) => controls[key] !== true);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const blockers = failedControls.map((key) => ({ code: key, message: `Contrôle non satisfait: ${key}` }));

  if (evidence.length === 0) blockers.push({ code: 'missing_evidence', message: 'Aucune preuve de fermeture.' });
  if (!input.approvedBy) blockers.push({ code: 'missing_human_approval', message: 'Approbation humaine absente.' });

  return {
    closeable: blockers.length === 0,
    status: blockers.length === 0 ? 'validated' : 'draft',
    requiredControls: REQUIRED_CONTROLS,
    blockers,
  };
}

module.exports = { REQUIRED_CONTROLS, evaluateBusinessOrchestrationClosure };
