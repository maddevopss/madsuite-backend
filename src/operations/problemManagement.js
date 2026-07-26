function createProblem(input = {}) {
  if (!input.id || !input.serviceId || !(input.incidentIds || []).length) throw new Error('problem.required_fields');
  return { contract:'problem-management@1', id:input.id, serviceId:input.serviceId, incidentIds:[...new Set(input.incidentIds)], rootCause:null, correctiveActions:[], recurrenceCount:input.incidentIds.length, knownError:false, status:'open' };
}
function recordRootCause(problem, analysis = {}) {
  if (!analysis.cause || !analysis.evidence) throw new Error('problem.root_cause_evidence_required');
  return { ...problem, rootCause:{ cause:analysis.cause, evidence:analysis.evidence, verifiedBy:analysis.verifiedBy || null }, knownError:Boolean(analysis.knownError), status:'analyzed' };
}
function verifyCorrectiveAction(problem, action = {}) {
  if (!action.id || !action.owner || !action.verification) throw new Error('problem.corrective_action_invalid');
  return { ...problem, correctiveActions:[...(problem.correctiveActions || []), { ...action, verified:true }], status:'verified' };
}
module.exports = { createProblem, recordRootCause, verifyCorrectiveAction };
