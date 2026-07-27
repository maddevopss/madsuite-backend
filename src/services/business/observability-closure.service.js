'use strict';

const REQUIRED_CONTROLS = Object.freeze([
  'module_health_visible',
  'critical_metrics_defined',
  'audit_trail_complete',
  'alerts_actionable',
  'traces_correlated',
  'retention_verified',
  'incident_diagnostics_tested',
]);

function evaluateObservabilityClosure(input = {}) {
  const controls = input.controls || {};
  const blockers = REQUIRED_CONTROLS
    .filter((key) => controls[key] !== true)
    .map((key) => ({ code: key, message: `Contrôle non satisfait: ${key}` }));

  if (!Array.isArray(input.evidence) || input.evidence.length === 0) blockers.push({ code: 'missing_evidence', message: 'Preuves d’observabilité absentes.' });
  if (!input.approvedBy) blockers.push({ code: 'missing_human_approval', message: 'Approbation humaine absente.' });

  return { closeable: blockers.length === 0, status: blockers.length === 0 ? 'validated' : 'draft', requiredControls: REQUIRED_CONTROLS, blockers };
}

module.exports = { REQUIRED_CONTROLS, evaluateObservabilityClosure };
