const REVIEW_TRANSITIONS = {
  draft: ['employee_input', 'cancelled'],
  employee_input: ['manager_review', 'cancelled'],
  manager_review: ['acknowledged', 'employee_input', 'cancelled'],
  acknowledged: ['closed'],
  closed: [],
  cancelled: [],
};

function transitionReview(status, action) {
  if (!REVIEW_TRANSITIONS[status]?.includes(action)) throw new Error(`transition RH invalide: ${status} -> ${action}`);
  return action;
}

function assessOffboardingReadiness(input = {}) {
  const checks = {
    payrollConfirmed: Boolean(input.payrollConfirmed),
    accessRevoked: Boolean(input.accessRevoked),
    propertyReturned: Boolean(input.propertyReturned),
    documentsCompleted: Boolean(input.documentsCompleted),
  };
  const blockers = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return { ready: blockers.length === 0, blockers, status: blockers.length ? 'blocked' : 'completed' };
}

function buildPolicyAcknowledgement(input = {}) {
  const policyCode = String(input.policyCode || '').trim();
  const policyVersion = String(input.policyVersion || '').trim();
  if (!policyCode || !policyVersion) throw Object.assign(new Error('policyCode and policyVersion are required'), { statusCode: 400 });
  return {
    policyCode,
    policyVersion,
    documentId: input.documentId || null,
    dueAt: input.dueAt || null,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
  };
}

function evaluateReviewClosure(input = {}) {
  const rating = Number(input.overallRating);
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) throw new Error('overallRating must be between 0 and 5');
  const objectives = Array.isArray(input.objectives) ? input.objectives : [];
  const competencies = Array.isArray(input.competencies) ? input.competencies : [];
  return { rating, objectives, competencies, complete: objectives.length > 0 && competencies.length > 0 };
}

module.exports = { transitionReview, assessOffboardingReadiness, buildPolicyAcknowledgement, evaluateReviewClosure };
