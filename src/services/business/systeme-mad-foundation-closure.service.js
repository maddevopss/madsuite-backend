'use strict';

const REQUIRED_CONTROLS = Object.freeze([
  'governance_traceable',
  'decisions_explainable',
  'evidence_verifiable',
  'human_authority_preserved',
  'cognitive_continuity_supported',
  'institutional_references_linked',
  'trust_metrics_defined',
]);

function evaluateSystemeMadFoundationClosure(input = {}) {
  const controls = input.controls || {};
  const blockers = REQUIRED_CONTROLS
    .filter((key) => controls[key] !== true)
    .map((key) => ({ code: key, message: `Contrôle non satisfait: ${key}` }));

  if (!Array.isArray(input.evidence) || input.evidence.length === 0) blockers.push({ code: 'missing_evidence', message: 'Preuves institutionnelles absentes.' });
  if (!input.approvedBy) blockers.push({ code: 'missing_human_approval', message: 'Autorité humaine absente.' });

  return { closeable: blockers.length === 0, status: blockers.length === 0 ? 'validated' : 'draft', requiredControls: REQUIRED_CONTROLS, blockers };
}

module.exports = { REQUIRED_CONTROLS, evaluateSystemeMadFoundationClosure };
