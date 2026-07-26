function createChange(input = {}) {
  if (!input.id || !input.serviceId || !input.owner || !input.rollbackPlan) throw new Error('change.required_fields');
  if (!['low','medium','high','critical'].includes(input.risk)) throw new Error('change.risk_invalid');
  return { contract:'change-management@1', ...input, status:'requested', approvals:[], evidence:[] };
}
function approveChange(change, approval = {}) {
  if (!approval.actor) throw new Error('change.approver_required');
  if (['high','critical'].includes(change.risk) && approval.actor === change.owner) throw new Error('change.independent_approval_required');
  return { ...change, approvals:[...(change.approvals || []), approval], status:'approved' };
}
function recordExecution(change, execution = {}) {
  if (!execution.startedAt || !execution.result) throw new Error('change.execution_evidence_required');
  if (execution.result === 'failed' && !execution.rollbackExecuted) throw new Error('change.rollback_required');
  return { ...change, status: execution.result === 'succeeded' ? 'completed' : 'rolled_back', evidence:[...(change.evidence || []), execution] };
}
module.exports = { createChange, approveChange, recordExecution };
