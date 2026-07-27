function evaluateAssistanceClosure(input = {}) {
  const controls = [];
  const add = (code, ok, details = {}) => controls.push({ code, status: ok ? 'pass' : 'fail', details });

  add('authorized_use_cases', Number(input.authorizedUseCases || 0) > 0, { authorizedUseCases: Number(input.authorizedUseCases || 0) });
  add('controlled_context', Number(input.uncontrolledContextCount || 0) === 0, { uncontrolledContextCount: Number(input.uncontrolledContextCount || 0) });
  add('explainable_recommendations', Number(input.unexplainedRecommendations || 0) === 0, { unexplainedRecommendations: Number(input.unexplainedRecommendations || 0) });
  add('human_confirmations', Number(input.pendingHumanConfirmations || 0) === 0, { pendingHumanConfirmations: Number(input.pendingHumanConfirmations || 0) });
  add('audit_evidence', Number(input.missingAuditEvidence || 0) === 0, { missingAuditEvidence: Number(input.missingAuditEvidence || 0) });
  add('evaluation_quality', Number(input.failedEvaluations || 0) === 0, { failedEvaluations: Number(input.failedEvaluations || 0) });
  add('drift_and_costs', Number(input.openDriftAlerts || 0) === 0 && Number(input.costOverruns || 0) === 0, { openDriftAlerts: Number(input.openDriftAlerts || 0), costOverruns: Number(input.costOverruns || 0) });
  add('stop_controls', Boolean(input.stopMechanismVerified), { stopMechanismVerified: Boolean(input.stopMechanismVerified) });
  add('closure_evidence', Array.isArray(input.evidence) && input.evidence.length > 0, { evidenceCount: Array.isArray(input.evidence) ? input.evidence.length : 0 });
  add('human_approval', Boolean(input.approvedBy), { approvedBy: input.approvedBy || null });

  const failures = controls.filter((control) => control.status === 'fail');
  return {
    eligible: failures.length === 0,
    status: failures.length === 0 ? 'approved' : 'blocked',
    controls,
    blockers: failures.map((control) => control.code),
  };
}

module.exports = { evaluateAssistanceClosure };